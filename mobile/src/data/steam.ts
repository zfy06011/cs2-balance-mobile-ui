/**
 * steam：Steam Community Market 直连适配器（手机端）。
 * 接口：priceoverview（当前价/成交量）、search/render（按成交量搜索）。
 * 遵守限流：请求间隔由调用方控制（collector）。
 */
export interface SteamPriceResult {
  success: boolean;
  lowest_price: number | null;
  median_price: number | null;
  volume: number | null;
}

export interface SteamCaseHit {
  name: string;
  volume: number;
  sell_price: number | null;
  sell_listings: number | null;
}

const MARKET_BASE = 'https://steamcommunity.com/market';
const APPID = 730;
const CURRENCY = 23;
export const STEAM_DELAY_MS = 1800;

function headers(cookie: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
    Accept: 'application/json, text/plain, */*',
  };
  if (cookie && cookie.trim()) h.Cookie = cookie.trim();
  return h;
}

/** 解析 "¥ 12.34" / "¥12.34" / "---" */
function parsePrice(text: unknown): number | null {
  if (text == null) return null;
  const cleaned = String(text).replace(/[¥￥元,,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseVolume(text: unknown): number | null {
  if (text == null) return null;
  const cleaned = String(text).replace(/[,,\s]/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

export async function fetchSteamPrice(name: string, cookie = ''): Promise<SteamPriceResult> {
  const params = new URLSearchParams({
    appid: String(APPID),
    currency: String(CURRENCY),
    market_hash_name: name,
  });
  const resp = await fetch(`${MARKET_BASE}/priceoverview/?${params.toString()}`, {
    headers: headers(cookie),
  });
  if (!resp.ok) throw new Error(`Steam 价格接口返回 ${resp.status}`);
  const data = (await resp.json()) as Record<string, unknown>;
  if (!data.success) return { success: false, lowest_price: null, median_price: null, volume: null };
  return {
    success: true,
    lowest_price: parsePrice(data.lowest_price),
    median_price: parsePrice(data.median_price),
    volume: parseVolume(data.volume),
  };
}

/** 按近 24h 成交量倒序搜索，返回过滤后的武器箱列表 */
export async function searchCases(count = 100, cookie = ''): Promise<SteamCaseHit[]> {
  const params = new URLSearchParams({
    appid: String(APPID),
    norender: '1',
    query: '',
    start: '0',
    count: String(Math.min(count, 100)),
    sort_column: 'volume',
    sort_dir: 'desc',
  });
  const resp = await fetch(`${MARKET_BASE}/search/render/?${params.toString()}`, {
    headers: headers(cookie),
  });
  if (!resp.ok) throw new Error(`Steam 搜索接口返回 ${resp.status}`);
  const data = (await resp.json()) as { results?: Record<string, unknown>[] };
  const results = data.results ?? [];
  const hits: SteamCaseHit[] = [];
  for (const r of results) {
    const name = String(r.name ?? '');
    // search/render 不返回 24h 成交量字段：用挂牌数作为流动性近似，
    // 真实成交量由后续 priceoverview 返回并覆盖（collector 中 sp.volume 优先）。
    const listings = typeof r.sell_listings === 'number' ? r.sell_listings : 0;
    // 价格字段兼容新旧两种命名（分 → 元）
    const cents = typeof r.sell_price === 'number' ? r.sell_price : typeof r.sale_price === 'number' ? r.sale_price : null;
    hits.push({
      name,
      volume: listings,
      sell_price: cents != null && Number.isFinite(cents) ? cents / 100 : null,
      sell_listings: listings,
    });
  }
  return hits;
}
