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
  return hits.filter((h) => isCaseLikeName(h.name));
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

/** 用 Web API 把「自定义 URL / vanity」解析为 SteamID64（仅需 Key，无需 Cookie）。
 *  支持 17 位数字、profiles/ 链接、steamcommunity.com/id/xxx 自定义 URL。 */
export async function resolveSteamIdViaWebApi(apiKey: string, input: string): Promise<string> {
  const s = (input || '').trim();
  try {
    return normalizeSteamId(s);
  } catch {
    // 不是数字/profiles 链接，尝试当作自定义 URL 解析
  }
  const m = s.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]+)/) || s.match(/^([A-Za-z0-9_-]{2,32})$/);
  const vanity = m ? m[1] : null;
  if (!vanity) {
    throw new Error('请填写 17 位 SteamID64、profiles/ 链接，或自定义 URL（steamcommunity.com/id/xxx）');
  }
  if (!apiKey || !apiKey.trim()) {
    throw new Error('解析自定义 URL 需要先配置 Steam Web API Key');
  }
  const url = `${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey.trim())}&vanityurl=${encodeURIComponent(vanity)}&url_type=1`;
  const resp = await fetch(url);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Steam Web API 解析自定义 URL 失败（HTTP ${resp.status}）：${text.slice(0, 200)}`);
  }
  let j: { response?: { success?: number; steamid?: string } };
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`Steam Web API 返回非 JSON：${text.slice(0, 200)}`);
  }
  const r = j.response;
  if (r && r.success === 1 && /^\d{17}$/.test(r.steamid || '')) {
    return r.steamid as string;
  }
  throw new Error(`无法把「${vanity}」解析为 SteamID（Steam 返回：${text.slice(0, 200)}），请改用资料页 /profiles/ 后的 17 位数字`);
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

/** Web API 库存返回（含 context 16 失败诊断；context16 失败不中断整体，但保护箱会缺失） */
export interface SteamInventoryWebApiResult {
  items: SteamInventoryItem[];
  assetCount: number;
  totalInventoryCount: number | null;
  /** context 2（普通物品）Steam 返回的 total_inventory_count */
  ctx2Total: number | null;
  /** context 16（交易保护物品）Steam 返回的 total_inventory_count */
  ctx16Total: number | null;
  /** context 16（交易保护物品）请求失败的具体原因；用户库存全在保护期时该通道决定成败，必须显形 */
  ctx16Error?: string;
  /** 该 SteamID 对应的 Steam 昵称（GetPlayerSummaries，尽力而为；用于核对 ID 是否本人） */
  playerName: string | null;
  /** context 2 原始响应片段（截断 ≤300 字符、单行）；库存为空时带回 app 文案，便于核对 Steam 实际返回形状 */
  ctx2Raw?: string;
  /** context 16 原始响应片段（截断 ≤300 字符、单行） */
  ctx16Raw?: string;
}

/** 用 Web API 查该 SteamID 的公开昵称（GetPlayerSummaries/v2），失败返回 null，不阻塞主流程。
 *  库存为空时把昵称透出给用户核对——「ID 填成别的账号」是最常见的空库存原因之一。 */
export async function fetchSteamPlayerSummary(apiKey: string, steamId: string): Promise<string | null> {
  try {
    const sid = normalizeSteamId(steamId);
    const url = `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey.trim())}&steamids=${sid}`;
    const resp = await fetch(url, { headers: headers('') });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { response?: { players?: Array<{ personaname?: string }> } };
    const name = data?.response?.players?.[0]?.personaname;
    return name && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

const STEAM_API_BASE = 'https://api.steampowered.com';

/** 读取响应体诊断片段（≤200 字符、单行），错误消息直接带 Steam 原始返回，便于定位 403/429/格式变化 */
async function readBodySnippet(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > 200 ? `${t.slice(0, 200)}…` : t;
  } catch {
    return '';
  }
}

/**
 * Steam Web API 官方库存接口（IEconService）：社区接口会漏掉交易保护中的箱子，
 * 官方 Web API（需免费 Key，steamcommunity.com/dev/apikey 申请）作为所有者视角返回全量物品，
 * 且保护中的箱子带 cache_expiration（精确到时刻的可逆期），冷却比 "剩余整天" 更准。
 *
 * CS2 交易保护物品在 context 16（非 context 2），需同时请求两个 context 并合并。
 * Steam 官方返回 {"response":{...}}（IEconService 与 GetPlayerSummaries 一致），必须解包后再取值。
 * 错误消息一律带 HTTP 状态码 + Steam 原始返回片段，用户测试失败时能直接看到原因。
 */
export async function fetchSteamInventoryWebApi(
  apiKey: string,
  steamId: string,
): Promise<SteamInventoryWebApiResult> {
  const sid = normalizeSteamId(steamId);
  const key = encodeURIComponent(apiKey.trim());
  const base = `${STEAM_API_BASE}/IEconService/GetInventoryItemsWithDescriptions/v1/?key=${key}&steamid=${sid}&appid=730&get_descriptions=true`;

  // CS2 交易保护物品在 context 16，需同时请求 context 2 和 16
  const fetchContext = async (contextId: number) => {
    let resp: Response;
    try {
      resp = await fetch(`${base}&contextid=${contextId}`, { headers: headers('') });
    } catch (e) {
      throw new Error(`无法连接 api.steampowered.com（网络或 VPN 问题）：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!resp.ok) {
      const snippet = await readBodySnippet(resp);
      const extra = snippet ? ` Steam 返回：${snippet}` : '';
      if (resp.status === 403) throw new Error(`Steam Web API 拒绝访问（403）：请核对设置页的 Web API Key${extra}`);
      if (resp.status === 429) throw new Error(`Steam Web API 被限流（429），请等几分钟再同步${extra}`);
      throw new Error(`Steam Web API 返回 ${resp.status}${extra}`);
    }
    let data: unknown;
    try {
      data = await resp.json();
    } catch {
      const snippet = await readBodySnippet(resp);
      throw new Error(`Steam Web API 返回的不是有效 JSON${snippet ? `：${snippet}` : ''}`);
    }
    const obj = (data ?? {}) as Record<string, unknown>;
    // 原始响应片段（截断、单行）：库存为空时透出给用户，用户直接发回即可核对 Steam 实际返回形状
    const rawText = JSON.stringify(obj).replace(/\s+/g, ' ').trim();
    const truncate = (max: number) => (rawText.length > max ? `${rawText.slice(0, max)}…` : rawText);
    // Steam 官方接口（GetInventoryItemsWithDescriptions/GetPlayerSummaries）统一返回 {"response":{...}} 包装；
    // 兼容历史 result 包裹与裸对象，避免响应被整体丢弃而永远显示「空库存/0/?」。
    const root = ((obj.response ?? obj.result ?? obj) ?? {}) as {
      success?: unknown;
      total_inventory_count?: unknown;
      assets?: Record<string, unknown>[];
      descriptions?: Record<string, unknown>[];
    };
    // success 可能缺失（官方成功响应通常无 success 字段）、true/1（成功）、false/0（失败）。
    // 只把明确的失败抛出去；缺失时交给下游按字段存在性判断，绝不静默当成空库存。
    if (root.success === false || root.success === 0) {
      throw new Error(`Steam Web API 返回失败（success=${String(root.success)}，请核对 Key 与 SteamID）：${truncate(200)}`);
    }
    return { root, raw: truncate(300) };
  };

  // context 2 = 普通物品
  const ctx2 = await fetchContext(2);

  // context 16 = 交易保护物品（尽力而为，失败不阻塞，但原因必须透出）
  let ctx16: Awaited<ReturnType<typeof fetchContext>> = { root: { assets: [], descriptions: [], total_inventory_count: 0 }, raw: '' };
  let ctx16Error: string | undefined;
  try {
    ctx16 = await fetchContext(16);
  } catch (e) {
    ctx16Error = e instanceof Error ? e.message : String(e);
  }

  // 合并两个 context 的 assets 和 descriptions
  const merged = {
    total_inventory_count: ((ctx2.root.total_inventory_count ?? 0) as number) + ((ctx16.root.total_inventory_count ?? 0) as number),
    assets: [...(ctx2.root.assets ?? []), ...(ctx16.root.assets ?? [])],
    descriptions: [...(ctx2.root.descriptions ?? []), ...(ctx16.root.descriptions ?? [])],
  };

  const parsed = parseWebApiInventory(merged);
  return {
    ...parsed,
    // Steam 偶尔不返回 total_inventory_count：有资产时用资产数兜底，避免诊断文案显示 "?"
    ctx2Total: typeof ctx2.root.total_inventory_count === 'number' ? ctx2.root.total_inventory_count : (ctx2.root.assets?.length ?? null),
    ctx16Total: typeof ctx16.root.total_inventory_count === 'number' ? ctx16.root.total_inventory_count : (ctx16.root.assets?.length ?? null),
    ctx16Error,
    playerName: await fetchSteamPlayerSummary(apiKey, sid),
    // 原始响应片段（诊断用）：库存为空时 app 文案直接携带，用户发回即可确认 Steam 实际返回形状
    ctx2Raw: ctx2.raw,
    ctx16Raw: ctx16.raw,
  };
}

/** 解析 IEconService 响应（assets + descriptions）；保护期由 cache_expiration 精确推算 */
export function parseWebApiInventory(root: {
  response?: { total_inventory_count?: unknown; assets?: Record<string, unknown>[]; descriptions?: Record<string, unknown>[] };
  result?: { total_inventory_count?: unknown; assets?: Record<string, unknown>[]; descriptions?: Record<string, unknown>[] };
  total_inventory_count?: unknown;
  assets?: Record<string, unknown>[];
  descriptions?: Record<string, unknown>[];
}): { items: SteamInventoryItem[]; assetCount: number; totalInventoryCount: number | null } {
  // 官方接口返回 {"response":{...}}，历史/会话抓取格式可能为 result 或裸对象，
  // 统一解包后再解析，避免原始数据被整体丢弃。
  const r = (root.response ?? root.result ?? root) as {
    total_inventory_count?: unknown;
    assets?: Record<string, unknown>[];
    descriptions?: Record<string, unknown>[];
  };
  const totalInventoryCount = typeof r.total_inventory_count === 'number' ? r.total_inventory_count : null;
  const descMap = new Map<string, Record<string, unknown>>();
  for (const d of r.descriptions ?? []) {
    const key = `${d.classid}|${d.instanceid}`;
    if (!descMap.has(key)) descMap.set(key, d);
  }
  const assets = r.assets ?? [];
  const now = Date.now();
  const seen = new Map<string, SteamInventoryItem>();
  for (const a of assets) {
    const desc = descMap.get(`${a.classid}|${a.instanceid}`) ?? {};
    const name = String(desc.market_hash_name ?? a.market_hash_name ?? '');
    if (!name || !isCaseLikeName(name)) continue;
    const amount = intRestriction(a.amount) ?? 1;
    const rawCn = String(desc.market_name ?? desc.name ?? '');
    const cnName = rawCn && rawCn !== name && /[\u4e00-\u9fff]/.test(rawCn) ? rawCn : null;
    const tradableFlag = boolOf(desc.tradable, true);
    const marketable = boolOf(desc.marketable, true);
    // 保护期：cache_expiration（资产级或描述对）→ 精确可逆时刻
    let expMs: number | null = null;
    const rawExp = a.cache_expiration ?? desc.cache_expiration;
    if (typeof rawExp === 'string' && rawExp) {
      const t = Date.parse(rawExp);
      if (Number.isFinite(t)) expMs = t;
    }
    if (expMs == null && Array.isArray(desc.descriptions)) {
      for (const pair of desc.descriptions as Array<Record<string, unknown>>) {
        if (String(pair.name ?? '') === 'cache_expiration' && typeof pair.value === 'string') {
          const t = Date.parse(pair.value);
          if (Number.isFinite(t)) expMs = t;
        }
      }
    }
    let tradable = tradableFlag && expMs == null;
    let tradableDays: number | null = null;
    if (expMs != null) {
      const daysLeft = Math.ceil((expMs - now) / 86400000);
      tradable = daysLeft <= 0;
      tradableDays = Math.max(0, daysLeft);
    }
    const marketableDays = intRestriction(a.market_marketable_restriction ?? desc.market_marketable_restriction);
    const prev = seen.get(name);
    if (!prev) {
      seen.set(name, { name, cnName, amount, tradable, marketable, tradableRestrictionDays: tradableDays, marketableRestrictionDays: marketableDays });
      continue;
    }
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
  return { items: Array.from(seen.values()), assetCount: assets.length, totalInventoryCount };
}

