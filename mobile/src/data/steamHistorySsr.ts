/**
 * steamHistorySsr：零 cookie 直连 Steam 市场 gid 页抓取历史价格。
 *
 * 安装包历史种子之外的新数据由 Steam 市场页提供；页内嵌 SSR pricehistory 无需登录即可解析。
 *
 * 解析顺序为 SSR 优先、line1 兜底；纯解析函数由 verify:core 覆盖。
 */

export interface SsrPricePoint {
  /** unix 秒 */
  ts: number;
  price: number;
  volume: number;
}

export interface SsrHistoryPoint {
  /** YYYY-MM-DD */
  date: string;
  price: number;
  volume: number | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 从 HTML 解析 window.SSR.renderContext=JSON.parse("...")（双重编码：解析后仍是 JSON 字符串） */
export function parseSsrContext(html: string): unknown | null {
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

function queryDataOf(renderContext: unknown): unknown | null {
  const rc = asRecord(renderContext);
  const raw = rc && rc.queryData;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 从 renderContext 取 pricehistory query 的价格序列 */
export function extractSsrPriceHistory(renderContext: unknown): SsrPricePoint[] | null {
  const queries = asRecord(queryDataOf(renderContext))?.queries;
  if (!Array.isArray(queries)) return null;
  for (const q of queries) {
    const r = asRecord(q);
    const key = r && r.queryKey;
    if (!Array.isArray(key) || key.length < 2 || key[0] !== 'market' || key[1] !== 'pricehistory') continue;
    const data = asRecord(asRecord(r?.state)?.data);
    if (!data || !Array.isArray(data.prices)) return null;
    const points: SsrPricePoint[] = [];
    for (const p of data.prices) {
      const o = asRecord(p);
      if (!o) continue;
      const ts = Number(o.time);
      const price = Number(o.price_median ?? o.price);
      if (!Number.isFinite(ts) || !Number.isFinite(price)) continue;
      const volume = toNum(o.purchases ?? o.volume);
      points.push({ ts, price, volume: volume ?? 0 });
    }
    return points;
  }
  return null;
}

/** 旧版列表页 var line1 = [[dateStr, price, volume], ...] */
export function extractLine1(html: string): SsrPricePoint[] | null {
  const m = html.match(/var line1\s*=\s*(\[.*?\])\s*;/s);
  if (!m) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const points: SsrPricePoint[] = [];
  for (const row of arr) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const date = new Date(String(row[0]).replace(/ \+0$/, ':00 +0000'));
    const price = Number(row[1]);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(price)) continue;
    points.push({ ts: Math.floor(date.getTime() / 1000), price, volume: toNum(row[2]) ?? 0 });
  }
  return points;
}

/** 综合解析一页（SSR 优先、line1 兜底） */
export function parseListingHistory(html: string): SsrPricePoint[] | null {
  const rc = parseSsrContext(html);
  const ssr = rc ? extractSsrPriceHistory(rc) : null;
  if (ssr && ssr.length > 0) return ssr;
  return extractLine1(html);
}

/**
 * 原始点 → 本地历史格式：按 UTC 日聚合（同日取最后一个点，成交量求和），
 * 截断到最近 days 天，升序返回。
 */
export function toDailyHistory(points: SsrPricePoint[], days: number): SsrHistoryPoint[] {
  const byDay = new Map<string, SsrHistoryPoint>();
  const sorted = points.slice().sort((a, b) => a.ts - b.ts);
  for (const p of sorted) {
    if (!Number.isFinite(p.ts) || p.ts <= 0 || !Number.isFinite(p.price) || p.price <= 0) continue;
    const d = new Date(p.ts * 1000);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const prev = byDay.get(date);
    if (prev) {
      prev.price = p.price;
      prev.volume = (prev.volume ?? 0) + p.volume;
    } else {
      byDay.set(date, { date, price: p.price, volume: p.volume });
    }
  }
  const all = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return all.slice(-days);
}

/** App 端直连 Steam 抓取历史（零 cookie）。失败抛错，调用方降级。 */
export const STEAM_SSR_TIMEOUT_MS = 8000;

/**
 * v1.8.1 闪退修复：SSR 抓取「单飞 + 全局串行」。
 * - 单飞（inflight）：同一箱子的并发请求共享同一次抓取（页面 0.5-3MB、双重 JSON.parse，
 *   详情补拉与图表辅助加载并发时会双份下载，内存峰值可致低端机被系统杀进程）。
 * - 全局串行（ssrChain）：任一时刻整个 App 只有一次下载+解析在跑，
 *   详情补拉 / 图表加载 / 扫描兜底三者彻底串行，避免 JS 线程长阻塞叠加。
 * 底层统一抓全量日线（≤3650 天），调用方按 days 自行截取。
 */
const inflight = new Map<string, Promise<SsrHistoryPoint[]>>();
let ssrChain: Promise<void> = Promise.resolve();

function runSerial(task: () => Promise<SsrHistoryPoint[]>): Promise<SsrHistoryPoint[]> {
  const result = ssrChain.then(task, task);
  ssrChain = result.then(() => undefined, () => undefined);
  return result;
}

export async function fetchSteamHistorySsr(
  name: string,
  days = 365,
  timeoutMs = STEAM_SSR_TIMEOUT_MS,
): Promise<SsrHistoryPoint[]> {
  const shared = inflight.get(name);
  if (shared) return (await shared).slice(-days);
  const p = runSerial(() => fetchSteamHistorySsrOnce(name, timeoutMs));
  inflight.set(name, p);
  p.finally(() => {
    if (inflight.get(name) === p) inflight.delete(name);
  }).catch(() => undefined);
  return (await p).slice(-days);
}

async function fetchSteamHistorySsrOnce(name: string, timeoutMs: number): Promise<SsrHistoryPoint[]> {
  const url = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    if (!resp.ok) throw new Error(`Steam 市场页返回 HTTP ${resp.status}`);
    const html = await resp.text();
    const pts = parseListingHistory(html);
    if (!pts || pts.length === 0) throw new Error('Steam 市场页未解析到价格历史');
    const daily = toDailyHistory(pts, 3650);
    if (daily.length === 0) throw new Error('Steam 历史解析结果为空');
    return daily;
  } finally {
    clearTimeout(timer);
  }
}
