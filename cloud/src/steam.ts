/**
 * Steam 市场页解析（纯函数，无网络/无依赖，可离线单测）。
 *
 * 两种可零 cookie 拿历史的方式（2026-09-07 实测）：
 *  1. SSR 路径（主）：/market/listings/730/{gid} 页内嵌
 *       window.SSR.renderContext=JSON.parse("...")
 *     → renderContext.queryData（JSON 字符串）→ queries[] 里
 *       queryKey=["market","pricehistory",730,名称] 的 state.data.prices
 *     prices 每项是对象 { time: unix秒, price_median: 元, purchases: 成交量 }
 *     （实测 CS:GO Weapon Case：5202 点，2013-08-14 → 2026-09-06，日粒度为主 + 近期小时粒度）
 *     同页还有 queryKey=["market","orderbook",...] 的买卖盘深度。
 *  2. 旧版路径（兜底）：classic 列表页内嵌 var line1 = [[dateStr, 价格, 成交量], ...]
 */
export interface SteamPricePoint {
  ts: number;
  price: number;
  volume: number;
}

export interface OrderbookData {
  amtMaxBuyOrder: number | null;
  amtMinSellOrder: number | null;
  cBuyOrders: number | null;
  cSellOrders: number | null;
  currency: number | null;
  buyOrders: number[];
  sellOrders: number[];
}

export interface ParsedListing {
  /** 终态 URL 或页面里的 gid（无则为 null） */
  gid: string | null;
  /** 价格历史（SSR 优先，line1 兜底；都无则为 null） */
  pricePoints: SteamPricePoint[] | null;
  /** SSR 页面里的买卖盘深度（旧版 line1 页无此数据） */
  orderbook: OrderbookData | null;
}

const GID_RE = /\/market\/listings\/730\/(G[0-9A-F]{10})/i;

export function extractGid(input: string): string | null {
  const m = input.match(GID_RE);
  return m ? m[1] : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 从 HTML 解析 window.SSR.renderContext=JSON.parse("...")，返回 renderContext 对象 */
export function parseSSR(html: string): unknown | null {
  const marker = 'window.SSR.renderContext=JSON.parse(';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let i = start + marker.length;
  while (i < html.length && html[i] !== '"') i++;
  if (i >= html.length) return null;
  const qStart = i;
  let qEnd = -1;
  i++;
  while (i < html.length) {
    if (html[i] === '\\') {
      i += 2;
      continue;
    }
    if (html[i] === '"') {
      qEnd = i;
      break;
    }
    i++;
  }
  if (qEnd < 0) return null;
  try {
    let v: unknown = JSON.parse(html.slice(qStart, qEnd + 1));
    // 该页面实际是双重编码：JSON.parse 后仍是一段 JSON 字符串
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        return null;
      }
    }
    return v != null && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function queryData(renderContext: unknown): unknown | null {
  const rc = asRecord(renderContext);
  const raw = rc && rc.queryData;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface PriceHistoryData {
  points: SteamPricePoint[];
  currency: number | null;
}

/** 从 renderContext 取 pricehistory query 的价格序列 */
export function extractPriceHistory(renderContext: unknown): PriceHistoryData | null {
  const queries = asRecord(queryData(renderContext))?.queries;
  if (!Array.isArray(queries)) return null;
  for (const q of queries) {
    const r = asRecord(q);
    const key = r && r.queryKey;
    if (!Array.isArray(key) || key.length < 2 || key[0] !== 'market' || key[1] !== 'pricehistory') continue;
    const data = asRecord(asRecord(r?.state)?.data);
    if (!data || !Array.isArray(data.prices)) return null;
    const points: SteamPricePoint[] = [];
    for (const p of data.prices) {
      const o = asRecord(p);
      if (!o) continue;
      const ts = Number(o.time);
      const price = Number(o.price_median ?? o.price);
      if (!Number.isFinite(ts) || !Number.isFinite(price)) continue;
      const volume = toNum(o.purchases ?? o.volume);
      points.push({ ts, price, volume: volume ?? 0 });
    }
    return { points, currency: toNum(data.ecurrency) };
  }
  return null;
}

/** 从 renderContext 取 orderbook query 的盘口深度 */
export function extractOrderbook(renderContext: unknown): OrderbookData | null {
  const queries = asRecord(queryData(renderContext))?.queries;
  if (!Array.isArray(queries)) return null;
  for (const q of queries) {
    const r = asRecord(q);
    const key = r && r.queryKey;
    if (!Array.isArray(key) || key[0] !== 'market' || key[1] !== 'orderbook') continue;
    const data = asRecord(asRecord(r?.state)?.data);
    if (!data) return null;
    return {
      amtMaxBuyOrder: toNum(data.amtMaxBuyOrder),
      amtMinSellOrder: toNum(data.amtMinSellOrder),
      cBuyOrders: toNum(data.cBuyOrders),
      cSellOrders: toNum(data.cSellOrders),
      currency: toNum(data.eCurrency),
      buyOrders: Array.isArray(data.rgCompactBuyOrders) ? (data.rgCompactBuyOrders as number[]) : [],
      sellOrders: Array.isArray(data.rgCompactSellOrders) ? (data.rgCompactSellOrders as number[]) : [],
    };
  }
  return null;
}

/** 旧版列表页 var line1 = [[dateStr, price, volume], ...]（dateStr 形如 "Jun 01 2014 01: +0"） */
export function extractLine1(html: string): SteamPricePoint[] | null {
  const m = html.match(/var line1\s*=\s*(\[.*?\])\s*;/s);
  if (!m) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const points: SteamPricePoint[] = [];
  for (const row of arr) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const date = new Date(String(row[0]).replace(/ \+0$/, ':00 +0000'));
    const price = Number(row[1]);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(price)) continue;
    const volume = toNum(row[2]);
    points.push({ ts: Math.floor(date.getTime() / 1000), price, volume: volume ?? 0 });
  }
  return points;
}

/** 综合解析一页：SSR pricehistory 优先，line1 兜底；顺带提取 gid 与盘口 */
export function parseListingPage(html: string, finalUrl: string): ParsedListing {
  const gid = extractGid(finalUrl) ?? extractGid(html);
  const rc = parseSSR(html);
  const ph = rc ? extractPriceHistory(rc) : null;
  const line1 = ph && ph.points.length > 0 ? null : extractLine1(html);
  const orderbook = rc ? extractOrderbook(rc) : null;
  return {
    gid,
    pricePoints: (ph && ph.points.length > 0 ? ph.points : line1) ?? null,
    orderbook,
  };
}