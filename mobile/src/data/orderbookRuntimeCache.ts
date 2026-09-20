/**
 * RN-compatible orderbook memory cache。
 * 不依赖 fs/path/process；持久化由上层现有 app cache/SQLite hydration 负责。
 */
export type OrderbookCacheStatus = 'missing' | 'fresh' | 'stale' | 'expired';

export interface OrderbookRuntimeCacheRead<T> {
  status: OrderbookCacheStatus;
  value?: T;
  fetchedAt?: number;
  ageMs?: number;
  schemaVersion?: string;
}

export interface OrderbookRuntimeCacheOptions {
  freshTtlMs?: number;
  staleTtlMs?: number;
  schemaVersion?: string;
  now?: () => number;
}

interface Entry<T> {
  value: T;
  fetchedAt: number;
  schemaVersion: string;
}

export class OrderbookRuntimeCache<T = unknown> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly freshTtlMs: number;
  private readonly staleTtlMs: number;
  private readonly schemaVersion: string;
  private readonly now: () => number;

  constructor(options: OrderbookRuntimeCacheOptions = {}) {
    this.freshTtlMs = Math.max(0, options.freshTtlMs ?? 2 * 60 * 1000);
    this.staleTtlMs = Math.max(this.freshTtlMs, options.staleTtlMs ?? 10 * 60 * 1000);
    this.schemaVersion = options.schemaVersion ?? 'orderbook:v1';
    this.now = options.now ?? (() => Date.now());
  }

  set(key: string, value: T, fetchedAt = this.now(), schemaVersion = this.schemaVersion): void {
    if (!key || !Number.isFinite(fetchedAt)) return;
    this.entries.set(key, { value, fetchedAt, schemaVersion });
  }

  get(key: string): OrderbookRuntimeCacheRead<T> {
    const entry = this.entries.get(key);
    if (!entry) return { status: 'missing' };
    if (entry.schemaVersion !== this.schemaVersion) {
      return { status: 'expired', fetchedAt: entry.fetchedAt, schemaVersion: entry.schemaVersion };
    }
    const ageMs = Math.max(0, this.now() - entry.fetchedAt);
    if (ageMs <= this.freshTtlMs) {
      return { status: 'fresh', value: entry.value, fetchedAt: entry.fetchedAt, ageMs, schemaVersion: entry.schemaVersion };
    }
    if (ageMs <= this.staleTtlMs) {
      return { status: 'stale', value: entry.value, fetchedAt: entry.fetchedAt, ageMs, schemaVersion: entry.schemaVersion };
    }
    return { status: 'expired', fetchedAt: entry.fetchedAt, ageMs, schemaVersion: entry.schemaVersion };
  }

  delete(key: string): boolean { return this.entries.delete(key); }
  clear(): void { this.entries.clear(); }
  size(): number { return this.entries.size; }
}

