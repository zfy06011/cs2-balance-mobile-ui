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
  /** 英文 MarketHashName：后台唯一关联键（priceoverview/C5 查询都用它） */
  name: string;
  /** Steam 官方中文名（search/render 带 l=schinese 时返回）；未命中为 null */
  cnName: string | null;
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
import { isTrackedCase } from './caseFilter';

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
    // hash_name 恒为英文 MarketHashName；name 受 l=schinese 影响为中文
    const name = String(r.hash_name ?? r.name ?? '');
    const rawName = r.name != null ? String(r.name) : '';
    const cnName = rawName && rawName !== name && /[\u4e00-\u9fff]/.test(rawName) ? rawName : null;
    const listings = typeof r.sell_listings === 'number' ? r.sell_listings : 0;
    const cents = typeof r.sell_price === 'number' ? r.sell_price : typeof r.sale_price === 'number' ? r.sale_price : null;
    hits.push({
      name,
      cnName,
      volume: listings,
      sell_price: cents != null && Number.isFinite(cents) ? cents / 100 : null,
      sell_listings: listings,
      popular_rank: offset + i + 1,
    });
  }
  return hits;
}

// 受监控武器箱判定复用统一模块（白名单优先 + 词法兜底），避免与 c5.ts/radar.ts 口径不一致

/**
 * 热门榜/成交量搜索（自动翻页）。
 * 实测未登录（无 cookie）时 search/render 单页最多返回约 10 条（登录可拿满 count），
 * 因此按 start 翻页补齐目标数量；页间限速，翻完 total_count 或翻满页数即止。
 */
const SEARCH_PAGE_DELAY_MS = 1200;
const SEARCH_MAX_PAGES = 10;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchSearchPage(
  start: number,
  count: number,
  cookie: string,
  popular: boolean,
): Promise<{ hits: SteamCaseHit[]; total: number | null }> {
  const sort = popular ? 'popular' : 'volume';
  // category_730_Type[] 需要保留原始方括号，手动拼 query string（URLSearchParams 会转义成 %5B%5D）
  const base = `appid=${APPID}&norender=1&query=&start=${start}&count=${Math.min(count, 100)}&sort_column=${sort}&sort_dir=desc&l=schinese`;
  const qs = popular ? `${base}&category_730_Type[]=tag_CSGO_Type_WeaponCase` : base;
  const resp = await fetch(`${MARKET_BASE}/search/render/?${qs}`, { headers: headers(cookie) });
  if (!resp.ok) throw new Error(`Steam 搜索接口返回 ${resp.status}`);
  const data = (await resp.json()) as { results?: Record<string, unknown>[]; total_count?: unknown };
  const total = typeof data.total_count === 'number' ? data.total_count : null;
  return { hits: parseResults(data, start), total };
}

async function searchPaged(count: number, cookie: string, popular: boolean): Promise<SteamCaseHit[]> {
  const seen = new Set<string>();
  const out: SteamCaseHit[] = [];
  let start = 0;
  let total: number | null = null;
  for (let page = 0; page < SEARCH_MAX_PAGES && out.length < count; page++) {
    const r = await fetchSearchPage(start, count - out.length, cookie, popular);
    if (r.total != null) total = r.total;
    let added = 0;
    for (const h of r.hits) {
      if (seen.has(h.name)) continue;
      seen.add(h.name);
      out.push(h);
      added++;
    }
    if (added === 0) break;
    start += r.hits.length;
    if (total != null && start >= total) break;
    if (page < SEARCH_MAX_PAGES - 1) await sleep(SEARCH_PAGE_DELAY_MS);
  }
  return out;
}

async function searchPopular(count: number, cookie: string): Promise<SteamCaseHit[]> {
  return searchPaged(count, cookie, true);
}

/** 回退：按近 24h 成交量倒序搜索 + 武器箱过滤 */
async function searchByVolume(count: number, cookie: string): Promise<SteamCaseHit[]> {
  const hits = await searchPaged(count, cookie, false);
  return hits.filter((h) => isTrackedCase(h.name));
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

/**
 * Steam 官方价格历史（pricehistory，日线、可回溯数年）。
 * 实测必须带有效 Steam 登录 cookie（未登录返回 400/401）。
 * prices 形如 [["2026-08-01T00:00:00.000","12.34","500"],...]（日期、价格、成交量）。
 */
export interface SteamHistoryPoint {
  /** YYYY-MM-DD */
  date: string;
  price: number;
  volume: number | null;
}

export function parsePriceHistory(prices: unknown, days: number): SteamHistoryPoint[] {
  if (!Array.isArray(prices)) return [];
  const rows: SteamHistoryPoint[] = [];
  for (const row of prices) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const date = String(row[0]).slice(0, 10);
    const price = parsePrice(row[1]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || price == null) continue;
    rows.push({ date, price, volume: row.length >= 3 ? parseVolume(row[2]) : null });
  }
  return rows.slice(-days);
}

// ---------------------------------------------------------------------------
// Steam 库存：真实冷却期同步（精确到小时）
// steamcommunity.com/inventory/{steamid}/730/2 返回：
//  - assets[] 的 market_tradable_restriction / market_marketable_restriction
//    = 距解锁「剩余整数天」（Steam 官方不提供小时级时间戳）
//  - descriptions[] 提供 market_hash_name（英文唯一键）与中文名
// 小时级精度由 engine.syncSteamInventory 结合「本地首次观察时间」推算。
// ---------------------------------------------------------------------------



/** 规整为 SteamID64：支持 17 位数字或 profiles/7656119... 链接 */
export function normalizeSteamId(input: string): string {
  const s = (input || '').trim();
  if (/^\d{17}$/.test(s)) return s;
  const m = s.match(/profiles\/(\d{17})/);
  if (m) return m[1];
  throw new Error('请输入 17 位 SteamID64 或 profiles/7656119… 链接');
}

/** 从登录会话识别自己的 SteamID64：steamcommunity.com/my 会重定向到本人资料页，
 *  页面里带 data-miniprofile / g_steamID。免去手填 ID，也排除「ID 填成别的账号」的问题。 */
export async function resolveOwnSteamId(cookie: string): Promise<string> {
  if (!cookie || !cookie.trim()) throw new Error('请先在设置页完成「Steam 一键登录」，或手填 SteamID64');
  const resp = await fetch('https://steamcommunity.com/my', { headers: headers(cookie) });
  const html = await resp.text();
  if (/<title>.*(登录|Sign in)/i.test(html.slice(0, 2000)) && !/data-miniprofile/.test(html)) {
    throw new Error('登录已失效：请到设置页重新「Steam 一键登录」');
  }
  const m =
    html.match(/data-miniprofile="(\d{17})"/) ||
    html.match(/g_steamID\s*=\s*["']?(\d{17})/) ||
    resp.url.match(/profiles\/(\d{17})/);
  if (m) return m[1];
  throw new Error('无法从登录会话识别 SteamID，请重新「Steam 一键登录」或手填 SteamID64');
}

