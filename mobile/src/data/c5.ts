/**
 * c5：C5GAME 直连适配器（手机端）。
 *
 * 官方 OpenAPI（https://opendoc.c5game.com）：
 *   端点：POST /merchant/product/price/batch
 *        （MarketHashNames 批量查询在售最低价和数量，文档 /api-125914570）
 *   鉴权：app-key 作为 query 参数，无需签名（默认限流 50 QPS）。
 *   请求体：{ "appId": "730", "marketHashNames": ["<MarketHashName>"] }
 *   价格单位：元（人民币），与 Steam priceoverview（CNY）一致，可直接参与计算。
 *
 * 未配置 app-key / 请求失败 / 无数据时返回 null（禁止臆造价格），
 * 用户也可在商品详情页手动录入 C5 买入价兜底。
 */
const C5_API_BASE = 'https://openapi.c5game.com';
const C5_WEB_BASE = 'https://www.c5game.com';
const C5_APP_ID = '730'; // CS:GO / CS2

/** 与 steam.ts#isCaseLikeName 同口径的武器箱判断（c5.ts 独立编译，不引入 steam.ts） */
function isCaseLikeName(name: string): boolean {
  return /case/i.test(name) || /package/i.test(name) || name.includes('武器箱') || name.includes('胶囊') || name.includes('收藏包');
}
/** 单次批量上限（保守，官方限流 50 QPS） */
export const C5_BULK_CHUNK = 30;

interface C5BatchItem {
  itemId?: string;
  marketHashName?: string;
  /** 在售最低价，单位：元 */
  price?: number | string;
  count?: number;
  website?: string;
}

interface C5BatchResponse {
  success?: boolean;
  data?: Record<string, C5BatchItem> | null;
  errorCode?: number;
  errorMsg?: string | null;
}

/** 把可能为字符串的金额转成 number，失败返回 null */
function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 真正批量查询：一次 POST 多个 MarketHashName，自动分批（每批 C5_BULK_CHUNK 个）。
 * 返回 { name: price|null }，单个失败置 null（不阻塞整批）。
 */
export async function fetchC5PricesBulk(
  names: string[],
  appKey: string,
  chunkSize = C5_BULK_CHUNK,
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (!appKey || !appKey.trim() || names.length === 0) return out;
  const key = appKey.trim();
  const uniq = [...new Set(names)].filter((n) => !!n);

  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    let map: Record<string, number | null> = {};
    try {
      const resp = await fetch(`${C5_API_BASE}/merchant/product/price/batch?app-key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appId: C5_APP_ID, marketHashNames: chunk }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as C5BatchResponse;
        if (data && data.success === true && data.data) {
          for (const n of chunk) {
            const item = data.data[n];
            map[n] = item ? toNumber(item.price) : null;
          }
        }
      }
    } catch {
      map = {};
    }
    for (const n of chunk) out[n] = map[n] ?? null;
  }
  return out;
}

/** 单条查询（批量接口的便捷封装） */
export async function fetchC5Price(name: string, appKey: string): Promise<number | null> {
  const r = await fetchC5PricesBulk([name], appKey, 1);
  return r[name] ?? null;
}

// ---------------------------------------------------------------------------
// C5 历史价格（网页端趋势图接口，需 C5 网页登录 cookie；OpenAPI 无历史接口，实测确认）
// GET https://www.c5game.com/trade-flex/order/price-trend/chart?itemId=<id>&period=<7|30|...>
// 响应里嵌着 { dates: [unix 秒], prices: [元] }（网页图表组件消费同一结构）
// ---------------------------------------------------------------------------

export interface C5HistoryPoint {
  /** YYYY-MM-DD */
  date: string;
  price: number;
}

/** 递归在响应 JSON 中找 dates/prices 平行数组（响应包装层级可能变化，弹性解析） */
export function parseC5Trend(json: unknown, days: number): C5HistoryPoint[] {
  const found: Array<{ dates: unknown[]; prices: unknown[] }> = [];
  const visit = (node: unknown, depth: number) => {
    if (found.length > 0 || node == null || typeof node !== 'object' || depth > 6) return;
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.dates) && Array.isArray(o.prices) && o.dates.length === o.prices.length && o.dates.length > 0) {
      found.push({ dates: o.dates, prices: o.prices });
      return;
    }
    for (const k of Object.keys(o)) visit(o[k], depth + 1);
  };
  visit(json, 0);
  if (found.length === 0) return [];
  const dates = found[0].dates;
  const prices = found[0].prices;
  const out: C5HistoryPoint[] = [];
  for (let i = 0; i < dates.length; i++) {
    let ts = Number(dates[i]);
    const price = Number(prices[i]);
    if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(price) || price <= 0) continue;
    if (ts > 1e12) ts = ts / 1000; // 毫秒时间戳兼容
    out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), price });
  }
  return out.slice(-days);
}

export async function fetchC5PriceTrend(itemId: string, cookie: string, period = '30', days = 60): Promise<C5HistoryPoint[]> {  if (!cookie || !cookie.trim()) throw new Error('需要 C5GAME 网页登录 cookie 才能获取历史价格');
  const url = `${C5_WEB_BASE}/trade-flex/order/price-trend/chart?itemId=${encodeURIComponent(itemId)}&period=${encodeURIComponent(period)}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
      Accept: 'application/json',
      Referer: 'https://www.c5game.com/',
      Cookie: cookie.trim(),
    },
  });
  if (!resp.ok) throw new Error(`C5 历史接口返回 ${resp.status}`);
  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    throw new Error('C5 cookie 已失效（返回了登录页），请更新设置页的 C5 Cookie');
  }
  return parseC5Trend(json, days);
}

/**
 * 求购/出售统计（HANDOFF 实测：POST /merchant/market/v2/item/stat/hash/name）。
 * 返回每件商品的 itemId、在售最低价、在售数量、求购最高价、求购数量；
 * 无需 IP 白名单即可访问（与 products/search 不同）。
 * 求购最高价仅供「卖出参考」，勿与买入成本混用。
 */
export interface C5StatsResult {
  itemId: string | null;
  /** 在售最低价（元） */
  sellPrice: number | null;
  sellCount: number | null;
  /** 求购最高价（元），即「可秒出」的参考价 */
  purchaseMaxPrice: number | null;
  purchaseCount: number | null;
}

interface C5StatsRawItem {
  marketHashName?: string;
  itemId?: string | number;
  sellPrice?: number | string;
  sellCount?: number | string;
  purchaseMaxPrice?: number | string;
  purchaseCount?: number | string;
}

interface C5StatsResponse {
  success?: boolean;
  data?: C5StatsRawItem[] | Record<string, C5StatsRawItem> | null;
  errorCode?: number;
  errorMsg?: string | null;
}

function toCount(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function statsOf(item: C5StatsRawItem, name: string): C5StatsResult {
  return {
    itemId: item.itemId != null ? String(item.itemId) : null,
    sellPrice: toNumber(item.sellPrice),
    sellCount: toCount(item.sellCount),
    purchaseMaxPrice: toNumber(item.purchaseMaxPrice),
    purchaseCount: toCount(item.purchaseCount),
  };
}

/** 批量查询求购/出售统计；自动分批，单条失败置 null（不阻塞整批）。 */
export async function fetchC5StatsBulk(
  names: string[],
  appKey: string,
): Promise<Record<string, C5StatsResult | null>> {
  const out: Record<string, C5StatsResult | null> = {};
  if (!appKey || !appKey.trim() || names.length === 0) return out;
  const key = appKey.trim();
  const uniq = [...new Set(names)].filter((n) => !!n);

  for (let i = 0; i < uniq.length; i += C5_BULK_CHUNK) {
    const chunk = uniq.slice(i, i + C5_BULK_CHUNK);
    try {
      const resp = await fetch(`${C5_API_BASE}/merchant/market/v2/item/stat/hash/name?app-key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appId: C5_APP_ID, marketHashNames: chunk }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as C5StatsResponse;
        if (data && data.success === true && data.data) {
          if (Array.isArray(data.data)) {
            for (const item of data.data) {
              const n = item.marketHashName || '';
              if (n) out[n] = statsOf(item, n);
            }
          } else {
            for (const n of chunk) {
              const item = data.data[n];
              out[n] = item ? statsOf(item, n) : null;
            }
          }
        }
      }
    } catch {
      // 网络异常：该批视为无数据
    }
    for (const n of chunk) if (!(n in out)) out[n] = null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// C5 itemId 查询（网页搜索接口）：GET {C5_WEB_BASE}/steamtrade/sga/item-search/v1/list
// 前端 bundle 接口 keywordSearch（trade base = /steamtrade）。需 C5 网页登录 cookie，
// 匿名访问会返回登录页。仅当 OpenAPI app-key 拿不到 itemId 时使用。
// ---------------------------------------------------------------------------
export async function fetchC5ItemIdViaWeb(marketHashName: string, cookie: string): Promise<string> {
  if (!marketHashName || !cookie || !cookie.trim()) return '';
  const url = `${C5_WEB_BASE}/steamtrade/sga/item-search/v1/list?appId=${C5_APP_ID}&keyword=${encodeURIComponent(marketHashName)}&pageIndex=1&pageSize=10`;
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
        Accept: 'application/json',
        Referer: 'https://www.c5game.com/',
        Cookie: cookie.trim(),
      },
    });
    if (!resp.ok) return '';
    let json: unknown;
    try {
      json = await resp.json();
    } catch {
      return '';
    }
    return extractC5ItemId(json, marketHashName);
  } catch {
    return '';
  }
}

/** 弹性提取 itemId：优先找 marketHashName 命中条目的 itemId；否则取第一个数字型 itemId */
function extractC5ItemId(json: unknown, marketHashName: string): string {
  const kw = marketHashName.toLowerCase();
  let firstId = '';
  let matchId = '';
  const visit = (node: unknown, depth: number) => {
    if (matchId || node == null || typeof node !== 'object' || depth > 7) return;
    const o = node as Record<string, unknown>;
    if (!Array.isArray(o)) {
      let name = '';
      for (const key of ['marketHashName', 'market_hash_name', 'itemName', 'item_name', 'name']) {
        if (typeof o[key] === 'string') {
          name = o[key];
          break;
        }
      }
      let id = '';
      for (const key of ['itemId', 'item_id', 'id']) {
        if (o[key] != null) {
          id = String(o[key]).trim();
          if (id) break;
        }
      }
      if (id) {
        if (!firstId) firstId = id;
        if (name && name.toLowerCase().includes(kw)) matchId = id;
      }
    }
    for (const k of Object.keys(o)) visit(o[k], depth + 1);
  };
  visit(json, 0);
  return matchId || firstId;
}

