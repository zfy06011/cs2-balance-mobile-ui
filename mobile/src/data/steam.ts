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

/** 武器箱/收藏包类名称的宽松判断（回退模式过滤用） */
function isCaseLikeName(name: string): boolean {
  return /case/i.test(name) || /package/i.test(name) || name.includes('武器箱') || name.includes('胶囊') || name.includes('收藏包');
}

/**
 * 热门榜采集：sort_column=popular + CS2 武器箱分类 tag。
 * category_730_Type[] 需要保留原始方括号，手动拼 query string（URLSearchParams 会转义成 %5B%5D）。
 */
async function searchPopular(count: number, cookie: string): Promise<SteamCaseHit[]> {
  const qs = `appid=${APPID}&norender=1&query=&start=0&count=${Math.min(count, 100)}&sort_column=popular&sort_dir=desc&category_730_Type[]=tag_CSGO_Type_WeaponCase&l=schinese`;
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
    l: 'schinese',
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

// ---------------------------------------------------------------------------
// Steam 库存：真实冷却期同步（精确到小时）
// steamcommunity.com/inventory/{steamid}/730/2 返回：
//  - assets[] 的 market_tradable_restriction / market_marketable_restriction
//    = 距解锁「剩余整数天」（Steam 官方不提供小时级时间戳）
//  - descriptions[] 提供 market_hash_name（英文唯一键）与中文名
// 小时级精度由 engine.syncSteamInventory 结合「本地首次观察时间」推算。
// ---------------------------------------------------------------------------

export interface SteamInventoryItem {
  /** 英文 MarketHashName（与本地库存 item_name 关联键） */
  name: string;
  /** Steam 官方中文名（l=schinese 时返回；无则为 null） */
  cnName: string | null;
  amount: number;
  tradable: boolean;
  marketable: boolean;
  /** 距可交易剩余天数（整数；0 或 null 且 tradable=true 表示已解锁） */
  tradableRestrictionDays: number | null;
  /** 距可上架剩余天数（整数） */
  marketableRestrictionDays: number | null;
}

/** 规整为 SteamID64：支持 17 位数字或 profiles/7656119... 链接 */
export function normalizeSteamId(input: string): string {
  const s = (input || '').trim();
  if (/^\d{17}$/.test(s)) return s;
  const m = s.match(/profiles\/(\d{17})/);
  if (m) return m[1];
  throw new Error('请输入 17 位 SteamID64 或 profiles/7656119… 链接');
}

function intRestriction(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function boolOf(v: unknown, fallback: boolean): boolean {
  if (v == null) return fallback;
  return v === true || v === 1 || String(v) === '1' || String(v).toLowerCase() === 'true';
}

/** 拉取用户 Steam CS2 库存（730/2 = CS2 库存 context），解析冷却信息与官方中文名 */
export async function fetchSteamInventory(steamIdInput: string, cookie = ''): Promise<SteamInventoryItem[]> {
  const steamId = normalizeSteamId(steamIdInput);
  const url = `https://steamcommunity.com/inventory/${steamId}/730/2?l=schinese&count=2000`;
  const resp = await fetch(url, { headers: headers(cookie) });
  if (!resp.ok) {
    const extra = resp.status === 403 ? '（需登录 cookie 或公开库存）' : resp.status === 401 ? '（需登录 cookie）' : '';
    throw new Error(`Steam 库存接口返回 ${resp.status}${extra}`);
  }
  const data = (await resp.json()) as {
    success?: unknown;
    assets?: Record<string, unknown>[];
    descriptions?: Record<string, unknown>[];
  };
  if (data.success === false) throw new Error('Steam 库存不可见（请公开库存或填写 Steam cookie）');
  const descMap = new Map<string, Record<string, unknown>>();
  for (const d of data.descriptions ?? []) {
    const key = `${d.classid}|${d.instanceid}`;
    if (!descMap.has(key)) descMap.set(key, d);
  }
  const seen = new Map<string, SteamInventoryItem>();
  for (const a of data.assets ?? []) {
    const desc = descMap.get(`${a.classid}|${a.instanceid}`) ?? {};
    const name = String(desc.market_hash_name ?? a.market_hash_name ?? '');
    if (!name || !isCaseLikeName(name)) continue;
    const amount = intRestriction(a.amount) ?? 1;
    const rawCn = String(desc.market_name ?? desc.name ?? '');
    const cnName = rawCn && rawCn !== name && /[\u4e00-\u9fff]/.test(rawCn) ? rawCn : null;
    const tradable = boolOf(desc.tradable, true);
    const marketable = boolOf(desc.marketable, true);
    const tradableDays = intRestriction(a.market_tradable_restriction ?? desc.market_tradable_restriction);
    const marketableDays = intRestriction(a.market_marketable_restriction ?? desc.market_marketable_restriction);
    const prev = seen.get(name);
    if (!prev) {
      seen.set(name, { name, cnName, amount, tradable, marketable, tradableRestrictionDays: tradableDays, marketableRestrictionDays: marketableDays });
      continue;
    }
    // 同类多把：数量累加；可交易取「任一已解锁」；冷却天数取最短（最快解锁的那把）
    prev.amount += amount;
    prev.tradable = prev.tradable || tradable;
    prev.marketable = prev.marketable || marketable;
    if (tradableDays != null && (prev.tradableRestrictionDays == null || tradableDays < prev.tradableRestrictionDays)) {
      prev.tradableRestrictionDays = tradableDays;
    }
    if (marketableDays != null && (prev.marketableRestrictionDays == null || marketableDays < prev.marketableRestrictionDays)) {
      prev.marketableRestrictionDays = marketableDays;
    }
  }
  return Array.from(seen.values());
}
