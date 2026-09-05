/**
 * steam：Steam Community Market 直连适配器（手机端）。
 * 接口：priceoverview（当前价/成交量）、search/render（搜索）。
 * 热门采集（HANDOFF v2.0 第 3 节）：
 *   1) 优先 Steam 市场「热门物品」榜单（sort_column=popular）+ CS2 武器箱分类过滤；
 *   2) 失败时回退按近 24h 成交量倒序搜索。
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
  /** 热门榜单排名（popular 模式，1 起）；回退模式为 null */
  popular_rank: number | null;
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

function parseResults(data: { results?: Record<string, unknown>[] }, offset: number): SteamCaseHit[] {
  const results = data.results ?? [];
  const hits: SteamCaseHit[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = String(r.name ?? '');
    const listings = typeof r.sell_listings === 'number' ? r.sell_listings : 0;
    const cents = typeof r.sell_price === 'number' ? r.sell_price : typeof r.sale_price === 'number' ? r.sale_price : null;
    hits.push({
      name,
      volume: listings,
      sell_price: cents != null && Number.isFinite(cents) ? cents / 100 : null,
      sell_listings: listings,
      popular_rank: offset + i + 1,
    });
  }
  return hits;
}

/** 武器箱/收藏包类名称的宽松判断（回退模式过滤用） */
function isCaseLikeName(name: string): boolean {
  return /case/i.test(name) || name.includes('武器箱') || name.includes('胶囊') || /package/i.test(name);
}

/**
 * 热门榜采集：sort_column=popular + CS2 武器箱分类 tag。
 * category_730_Type[] 需要保留原始方括号，手动拼 query string（URLSearchParams 会转义成 %5B%5D）。
 */
async function searchPopular(count: number, cookie: string): Promise<SteamCaseHit[]> {
  const qs = `appid=${APPID}&norender=1&query=&start=0&count=${Math.min(count, 100)}&sort_column=popular&sort_dir=desc&category_730_Type[]=tag_CSGO_Type_WeaponCase`;
  const resp = await fetch(`${MARKET_BASE}/search/render/?${qs}`, { headers: headers(cookie) });
  if (!resp.ok) throw new Error(`Steam 热门榜返回 ${resp.status}`);
  const data = (await resp.json()) as { results?: Record<string, unknown>[] };
  return parseResults(data, 0);
}

/** 回退：按近 24h 成交量倒序搜索 + 武器箱过滤 */
async function searchByVolume(count: number, cookie: string): Promise<SteamCaseHit[]> {
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
  return parseResults(data, 0).filter((h) => isCaseLikeName(h.name));
}

/**
 * 搜索武器箱候选（热门优先，失败自动回退成交量）。
 * 返回的 volume 在 popular 模式下为挂牌数近似，真实成交量由后续 priceoverview 覆盖。
 */
export async function searchCases(count = 100, cookie = ''): Promise<SteamCaseHit[]> {
  try {
    const hot = await searchPopular(count, cookie);
    if (hot.length > 0) return hot;
    return searchByVolume(count, cookie);
  } catch {
    return searchByVolume(count, cookie);
  }
}
