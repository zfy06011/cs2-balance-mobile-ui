/**
 * Steam Market orderbook Spike。
 *
 * 这是隔离实验 Provider，不接入现有 collector/UI。
 * 当前主路径使用 Steam Community Market 的 name-based /market/orderbook；
 * 旧的 itemordershistogram 仅保留兼容解析与诊断，避免业务层依赖已变化的 HTML。
 */

export const STEAM_ORDERBOOK_SOURCE_KIND = 'steam_first_party_web' as const;
export const STEAM_ORDERBOOK_REQUEST_VERSION = 'v3-phase-1-name-orderbook-2026-09';

const DEFAULT_APP_ID = 730;
const DEFAULT_CURRENCY = 23; // CNY
const DEFAULT_COUNTRY = 'CN';
const DEFAULT_LANGUAGE = 'schinese';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 800;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 1_200;

export interface OrderbookLevel {
  price: number;
  quantity: number;
  cumulativeQuantity: number;
}

export interface SteamOrderbook {
  item: string;
  /** 旧 itemordershistogram 链路解析到时才有值；当前 name-based 路径不需要它。 */
  itemNameId?: string;
  highestBuy: number;
  lowestSell: number;
  /** 绝对价差，单位与 price 相同。 */
  spread: number;
  /** 相对价差，spread / highestBuy。 */
  spreadPct: number;
  buyLevels: OrderbookLevel[];
  sellLevels: OrderbookLevel[];
  fetchedAt: number;
  sourceKind: typeof STEAM_ORDERBOOK_SOURCE_KIND;
  requestVersion: string;
}

export type ProviderErrorCode =
  | 'http'
  | 'network'
  | 'timeout'
  | 'malformed_response'
  | 'steam_rejected'
  | 'missing_item_nameid';

export class SteamOrderbookError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly attempts: number;
  readonly url?: string;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: { status?: number; attempts?: number; url?: string } = {},
  ) {
    super(message);
    this.name = 'SteamOrderbookError';
    this.code = code;
    this.status = options.status;
    this.attempts = options.attempts ?? 1;
    this.url = options.url;
  }
}

export interface ProviderHealth {
  provider: string;
  ok: boolean;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  consecutiveFailures: number;
  latencyMs?: number;
  status?: number;
  reason?: string;
}

export interface SteamOrderbookProviderOptions {
  appId?: number;
  currency?: number;
  country?: string;
  language?: string;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  minRequestIntervalMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
}

interface ProviderConfig {
  appId: number;
  currency: number;
  country: string;
  language: string;
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  minRequestIntervalMs: number;
  baseUrl: string;
  fetchImpl: typeof fetch;
  now: () => number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null && Number.isInteger(number) && number > 0 ? number : null;
}

function parseMinorPrice(value: unknown): number | null {
  const number = positiveNumber(value);
  return number == null ? null : number / 100;
}

function parseGraphPrice(value: unknown): number | null {
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.+-]/g, '');
    return positiveNumber(cleaned);
  }
  return positiveNumber(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapOrderbookData(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  if (!root) throw new SteamOrderbookError('malformed_response', 'Steam 盘口响应不是对象');

  // 当前 name-based endpoint: { data: { success: true, data: { ... } } }
  const outer = asRecord(root.data);
  if (outer && ('success' in outer || 'data' in outer)) {
    if (outer.success === false || outer.success === 0) {
      throw new SteamOrderbookError('steam_rejected', 'Steam 盘口接口返回 success=false');
    }
    const nested = asRecord(outer.data);
    if (nested) return nested;
  }

  // 兼容旧 itemordershistogram 的直接对象或 { success, ...fields }。
  if (root.success === false || root.success === 0) {
    throw new SteamOrderbookError('steam_rejected', 'Steam itemordershistogram 返回 success=false');
  }
  return root;
}

function parseCompactLevels(value: unknown, direction: 'buy' | 'sell'): OrderbookLevel[] {
  if (!Array.isArray(value) || value.length % 2 !== 0) {
    throw new SteamOrderbookError('malformed_response', `${direction} compact orderbook 不是偶数对`);
  }
  const levels: OrderbookLevel[] = [];
  let cumulative = 0;
  for (let i = 0; i < value.length; i += 2) {
    const price = parseMinorPrice(value[i]);
    const quantity = positiveInteger(value[i + 1]);
    if (price == null || quantity == null) {
      throw new SteamOrderbookError('malformed_response', `${direction} compact orderbook 含非法价量`);
    }
    cumulative += quantity;
    levels.push({ price, quantity, cumulativeQuantity: cumulative });
  }
  return levels;
}

function parseGraphLevels(value: unknown, direction: 'buy' | 'sell'): OrderbookLevel[] {
  if (!Array.isArray(value)) {
    throw new SteamOrderbookError('malformed_response', `${direction} order graph 不是数组`);
  }
  const raw: Array<{ price: number; cumulative: number }> = [];
  for (const row of value) {
    const record = asRecord(row);
    const price = record ? parseGraphPrice(record.price) : null;
    const cumulative = record ? positiveInteger(record.volume) : null;
    if (price == null || cumulative == null) {
      throw new SteamOrderbookError('malformed_response', `${direction} order graph 含非法价量`);
    }
    raw.push({ price, cumulative });
  }

  raw.sort((a, b) => direction === 'buy' ? b.price - a.price : a.price - b.price);
  const levels: OrderbookLevel[] = [];
  let previous = 0;
  for (const row of raw) {
    const quantity = row.cumulative - previous;
    if (quantity <= 0) continue;
    levels.push({ price: row.price, quantity, cumulativeQuantity: row.cumulative });
    previous = row.cumulative;
  }
  return levels;
}

function firstPrice(levels: OrderbookLevel[]): number | null {
  return levels.length > 0 ? levels[0].price : null;
}

function chooseMinorPrice(data: Record<string, unknown>, keys: string[], fallback: number | null): number | null {
  for (const key of keys) {
    if (!(key in data)) continue;
    const price = parseMinorPrice(data[key]);
    if (price != null) return price;
  }
  return fallback;
}

/**
 * 解析当前 /market/orderbook 或旧 itemordershistogram 响应。
 * 纯函数可离线测试，不发网络请求。
 */
export function parseSteamOrderbookPayload(
  payload: unknown,
  item: string,
  fetchedAt = Date.now(),
  itemNameId?: string,
): SteamOrderbook {
  const data = unwrapOrderbookData(payload);
  const compactBuy = data.rgCompactBuyOrders;
  const compactSell = data.rgCompactSellOrders;
  const buyLevels = compactBuy != null
    ? parseCompactLevels(compactBuy, 'buy')
    : parseGraphLevels(data.buy_order_graph, 'buy');
  const sellLevels = compactSell != null
    ? parseCompactLevels(compactSell, 'sell')
    : parseGraphLevels(data.sell_order_graph, 'sell');

  const highestBuy = chooseMinorPrice(data, ['amtMaxBuyOrder', 'highest_buy_order'], firstPrice(buyLevels));
  const lowestSell = chooseMinorPrice(data, ['amtMinSellOrder', 'lowest_sell_order'], firstPrice(sellLevels));
  if (highestBuy == null || lowestSell == null) {
    throw new SteamOrderbookError('malformed_response', 'Steam 盘口缺少最高买单或最低卖单');
  }

  const spread = lowestSell - highestBuy;
  return {
    item,
    ...(itemNameId ? { itemNameId } : {}),
    highestBuy,
    lowestSell,
    spread,
    spreadPct: highestBuy > 0 ? spread / highestBuy : Number.POSITIVE_INFINITY,
    buyLevels,
    sellLevels,
    fetchedAt,
    sourceKind: STEAM_ORDERBOOK_SOURCE_KIND,
    requestVersion: STEAM_ORDERBOOK_REQUEST_VERSION,
  };
}

/** 从旧版 listings HTML 中提取 item_nameid；当前 SSR 页面可能不再包含该调用。 */
export function resolveItemNameIdFromListingHtml(html: string): string | null {
  const patterns = [
    /Market_LoadOrderSpread\s*\(\s*([0-9]+)\s*\)/i,
    /marketLoadOrderSpread\s*\[\s*['"]?item_nameid['"]?\s*,\s*['"]?([0-9]+)\s*['"]?\s*\]/i,
    /(?:item_nameid|itemNameId)\s*[:=]\s*['"]?([0-9]+)['"]?/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function buildNameOrderbookUrl(config: ProviderConfig, item: string): string {
  const params = new URLSearchParams({
    q: 'Load',
    cc: config.country,
    l: config.language,
    currency: String(config.currency),
    qp: JSON.stringify([config.appId, item]),
  });
  return `${config.baseUrl}/orderbook?${params.toString()}`;
}

function buildListingUrl(config: ProviderConfig, item: string): string {
  return `${config.baseUrl}/listings/${config.appId}/${encodeURIComponent(item)}`;
}

function buildHistogramUrl(config: ProviderConfig, itemNameId: string): string {
  const params = new URLSearchParams({
    country: config.country,
    language: config.language,
    currency: String(config.currency),
    item_nameid: itemNameId,
    two_factor: '0',
    norender: '1',
  });
  return `${config.baseUrl}/itemordershistogram?${params.toString()}`;
}

function errorFromUnknown(error: unknown, url: string, attempts: number): SteamOrderbookError {
  if (error instanceof SteamOrderbookError) {
    return new SteamOrderbookError(error.code, error.message, {
      status: error.status,
      attempts,
      url,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SteamOrderbookError('network', `Steam 盘口网络错误：${message}`, { attempts, url });
}

export class SteamOrderbookProvider {
  private readonly config: ProviderConfig;
  private lastRequestAt = 0;
  private currentHealth: ProviderHealth = {
    provider: 'steam-market-orderbook',
    ok: false,
    consecutiveFailures: 0,
  };

  constructor(options: SteamOrderbookProviderOptions = {}) {
    this.config = {
      appId: options.appId ?? DEFAULT_APP_ID,
      currency: options.currency ?? DEFAULT_CURRENCY,
      country: options.country ?? DEFAULT_COUNTRY,
      language: options.language ?? DEFAULT_LANGUAGE,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: options.retries ?? DEFAULT_RETRIES,
      backoffMs: options.backoffMs ?? DEFAULT_BACKOFF_MS,
      minRequestIntervalMs: options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS,
      baseUrl: (options.baseUrl ?? 'https://steamcommunity.com/market').replace(/\/$/, ''),
      fetchImpl: options.fetchImpl ?? fetch,
      now: options.now ?? (() => Date.now()),
    };
  }

  health(): ProviderHealth {
    return { ...this.currentHealth };
  }

  async getOrderbook(item: string): Promise<SteamOrderbook> {
    const name = item.trim();
    if (!name) throw new SteamOrderbookError('malformed_response', 'marketHashName 不能为空');
    const url = buildNameOrderbookUrl(this.config, name);
    const startedAt = this.config.now();
    try {
      const payload = await this.fetchJson(url, {
        timeoutMs: this.config.timeoutMs,
        retries: this.config.retries,
      }, {
        Accept: 'application/json, text/plain, */*',
        'x-valve-request-type': 'queryAction',
        Referer: buildListingUrl(this.config, name),
      });
      const result = parseSteamOrderbookPayload(payload, name, this.config.now());
      this.markSuccess(startedAt);
      return result;
    } catch (error) {
      const normalized = errorFromUnknown(error, url, error instanceof SteamOrderbookError ? error.attempts : 1);
      this.markFailure(normalized);
      throw normalized;
    }
  }

  /** 批量验证使用串行请求，默认间隔用于降低 Steam 限流风险。 */
  async getOrderbooks(items: string[]): Promise<SteamOrderbook[]> {
    const out: SteamOrderbook[] = [];
    for (const item of items) out.push(await this.getOrderbook(item));
    return out;
  }

  /** 旧链路的 market_hash_name → item_nameid 解析，仅供 Spike/兼容诊断。 */
  async resolveItemNameId(item: string): Promise<string> {
    const name = item.trim();
    const url = buildListingUrl(this.config, name);
    const response = await this.fetchText(url, {
      timeoutMs: this.config.timeoutMs,
      retries: this.config.retries,
    }, {
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': this.config.language === 'schinese' ? 'zh-CN,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.8',
    });
    const itemNameId = resolveItemNameIdFromListingHtml(response);
    if (!itemNameId) {
      const error = new SteamOrderbookError(
        'missing_item_nameid',
        `listing 页面未找到 item_nameid：${name}；当前应使用 name-based /market/orderbook`,
        { attempts: 1, url },
      );
      this.markFailure(error);
      throw error;
    }
    return itemNameId;
  }

  /** 旧 itemordershistogram 兼容路径；不作为当前默认路径。 */
  async getLegacyOrderbook(item: string, itemNameId?: string): Promise<SteamOrderbook> {
    const name = item.trim();
    const id = itemNameId ?? await this.resolveItemNameId(name);
    const url = buildHistogramUrl(this.config, id);
    const startedAt = this.config.now();
    try {
      const payload = await this.fetchJson(url, {
        timeoutMs: this.config.timeoutMs,
        retries: this.config.retries,
      }, {
        Accept: 'application/json, text/plain, */*',
        Referer: buildListingUrl(this.config, name),
      });
      const result = parseSteamOrderbookPayload(payload, name, this.config.now(), id);
      this.markSuccess(startedAt);
      return result;
    } catch (error) {
      const normalized = errorFromUnknown(error, url, error instanceof SteamOrderbookError ? error.attempts : 1);
      this.markFailure(normalized);
      throw normalized;
    }
  }

  private async pace(): Promise<void> {
    const wait = this.lastRequestAt + this.config.minRequestIntervalMs - this.config.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = this.config.now();
  }

  private async fetchJson(url: string, options: FetchJsonOptions, headers: Record<string, string>): Promise<unknown> {
    const response = await this.fetchRaw(url, options, headers);
    try {
      return await response.json();
    } catch {
      throw new SteamOrderbookError('malformed_response', 'Steam 盘口响应不是合法 JSON', { status: response.status, url });
    }
  }

  private async fetchText(url: string, options: FetchJsonOptions, headers: Record<string, string>): Promise<string> {
    const response = await this.fetchRaw(url, options, headers);
    return response.text();
  }

  private async fetchRaw(url: string, options: FetchJsonOptions, headers: Record<string, string>): Promise<Response> {
    const retries = options.retries ?? this.config.retries;
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    let lastError: SteamOrderbookError | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.pace();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.config.fetchImpl(url, {
          method: 'GET',
          headers,
          redirect: 'follow',
          signal: controller.signal,
        });
        if (response.ok) return response;
        const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        lastError = new SteamOrderbookError('http', `Steam 盘口接口返回 HTTP ${response.status}`, {
          status: response.status,
          attempts: attempt + 1,
          url,
        });
        if (!retryable || attempt >= retries) throw lastError;
      } catch (error) {
        if (error instanceof SteamOrderbookError) {
          lastError = error;
        } else if (error instanceof Error && error.name === 'AbortError') {
          lastError = new SteamOrderbookError('timeout', `Steam 盘口请求超时（${timeoutMs}ms）`, {
            attempts: attempt + 1,
            url,
          });
        } else {
          lastError = errorFromUnknown(error, url, attempt + 1);
        }
        const retryable = lastError.code === 'timeout' || lastError.code === 'network' || lastError.status === 408 || lastError.status === 425 || lastError.status === 429 || (lastError.status != null && lastError.status >= 500);
        if (!retryable || attempt >= retries) throw lastError;
      } finally {
        clearTimeout(timer);
      }
      await sleep(this.config.backoffMs * Math.pow(2, attempt));
    }
    throw lastError ?? new SteamOrderbookError('network', 'Steam 盘口请求失败', { url });
  }

  private markSuccess(startedAt: number): void {
    const now = this.config.now();
    this.currentHealth = {
      provider: 'steam-market-orderbook',
      ok: true,
      lastSuccessAt: now,
      consecutiveFailures: 0,
      latencyMs: Math.max(0, now - startedAt),
    };
  }

  private markFailure(error: SteamOrderbookError): void {
    const now = this.config.now();
    this.currentHealth = {
      ...this.currentHealth,
      provider: 'steam-market-orderbook',
      ok: false,
      lastFailureAt: now,
      consecutiveFailures: this.currentHealth.consecutiveFailures + 1,
      status: error.status,
      reason: `${error.code}: ${error.message}`,
    };
  }
}

