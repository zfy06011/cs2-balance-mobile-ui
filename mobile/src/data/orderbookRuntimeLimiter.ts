/**
 * RN-compatible orderbook runtime limiter。
 * 只保留 3B.3 的行为语义：key singleflight、全局并发、最小请求间隔、
 * 429/5xx retry、Retry-After/backoff、circuit breaker。
 */
export type OrderbookCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface OrderbookRuntimeLimiterOptions {
  maxConcurrency?: number;
  minIntervalMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface OrderbookLimiterDiagnostics {
  active: number;
  queued: number;
  inFlightKeys: number;
  circuitState: OrderbookCircuitState;
  consecutiveFailures: number;
  openUntil: number;
  liveAttempts: number;
  retryCount: number;
}

function errorWithCode(code: string): Error & { code: string } {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { status?: unknown }).status;
  const status = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(status) ? status : undefined;
}

function retryAfterOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const raw = (error as { retryAfterMs?: unknown; retryAfter?: unknown }).retryAfterMs
    ?? (error as { retryAfter?: unknown }).retryAfter;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  // Retry-After from a provider is normally seconds; an explicit Ms field is already ms.
  return (error as { retryAfterMs?: unknown }).retryAfterMs != null ? value : value * 1000;
}

function isRetryable(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 429 || (status != null && status >= 500 && status <= 599)) return true;
  const code = String((error as { code?: unknown } | undefined)?.code ?? '').toLowerCase();
  return code === 'timeout' || code === 'network_error' || code === 'retryable';
}

export class OrderbookRuntimeLimiter {
  private readonly maxConcurrency: number;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitCooldownMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly waiters: Array<() => void> = [];
  private active = 0;
  private lastStartedAt = 0;
  private startSerial: Promise<void> = Promise.resolve();
  private circuitState: OrderbookCircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openUntil = 0;
  private halfOpenProbe = false;
  private liveAttempts = 0;
  private retryCount = 0;

  constructor(options: OrderbookRuntimeLimiterOptions = {}) {
    this.maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 2));
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 400);
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2));
    this.baseBackoffMs = Math.max(0, options.baseBackoffMs ?? 250);
    this.circuitFailureThreshold = Math.max(1, Math.floor(options.circuitFailureThreshold ?? 5));
    this.circuitCooldownMs = Math.max(0, options.circuitCooldownMs ?? 30_000);
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    if (!this.permitNewRequest()) return Promise.reject(errorWithCode('circuit_open'));
    const promise = this.execute(task).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, promise);
    return promise;
  }

  diagnostics(): OrderbookLimiterDiagnostics {
    return {
      active: this.active,
      queued: this.waiters.length,
      inFlightKeys: this.inFlight.size,
      circuitState: this.circuitState,
      consecutiveFailures: this.consecutiveFailures,
      openUntil: this.openUntil,
      liveAttempts: this.liveAttempts,
      retryCount: this.retryCount,
    };
  }

  private permitNewRequest(): boolean {
    if (this.circuitState === 'OPEN') {
      if (this.now() < this.openUntil) return false;
      this.circuitState = 'HALF_OPEN';
      this.halfOpenProbe = false;
    }
    if (this.circuitState === 'HALF_OPEN') {
      if (this.halfOpenProbe) return false;
      this.halfOpenProbe = true;
    }
    return true;
  }

  private async execute<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        if (attempt > 0 && !this.permitNewRequest()) throw errorWithCode('circuit_open');
        await this.waitForStartSlot();
        this.liveAttempts++;
        try {
          const value = await task();
          this.onSuccess();
          return value;
        } catch (error) {
          if (!isRetryable(error) || attempt >= this.maxRetries) {
            this.onFailure();
            throw error;
          }
          this.retryCount++;
          const retryAfter = retryAfterOf(error);
          const jitter = Math.max(0, Math.min(1, this.random()));
          const backoff = this.baseBackoffMs * (2 ** attempt) * (0.75 + jitter * 0.5);
          await this.sleep(Math.max(retryAfter ?? 0, backoff));
        }
      }
      throw errorWithCode('retry_exhausted');
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(() => { this.active++; resolve(); }));
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  private async waitForStartSlot(): Promise<void> {
    let release!: () => void;
    const previous = this.startSerial;
    this.startSerial = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const waitMs = Math.max(0, this.lastStartedAt + this.minIntervalMs - this.now());
      if (waitMs > 0) await this.sleep(waitMs);
      this.lastStartedAt = this.now();
    } finally {
      release();
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitState = 'CLOSED';
    this.openUntil = 0;
    this.halfOpenProbe = false;
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    if (this.circuitState === 'HALF_OPEN' || this.consecutiveFailures >= this.circuitFailureThreshold) {
      this.circuitState = 'OPEN';
      this.openUntil = this.now() + this.circuitCooldownMs;
      this.halfOpenProbe = false;
    }
  }
}

