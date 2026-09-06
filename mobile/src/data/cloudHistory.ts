/**
 * 云端历史：从 Cloudflare Worker（D1 缓存）拉取 Steam 官方全量历史（零 cookie）。
 *
 * 数据来源：Steam 市场 gid 页 SSR pricehistory（2013 年至今全量日线 + 近期小时粒度），
 * 由云端定时采集入库；本模块仅做 GET /history 调用并映射为本地快照格式。
 */
export interface CloudHistoryResponse {
  name: string;
  price_prefix?: string;
  /** [[unix秒, 价格, 成交量], ...] 升序 */
  points: Array<[number, number, number | null] | Array<number | null>>;
  count?: number;
  hint?: string;
}

/** 云端历史点 → 本地 storage.mergeSteamHistory 需要的形状 */
export interface StorageHistoryPoint {
  date: string;
  price: number;
  volume: number | null;
}

/** 拉取云端历史（默认最近 120 天，覆盖 HISTORY_KEEP 需求）。失败抛错（含原因）。 */
export async function fetchCloudHistory(
  workerBaseUrl: string,
  name: string,
  days = 120,
): Promise<CloudHistoryResponse> {
  const base = workerBaseUrl.replace(/\/+$/, '');
  const url = `${base}/history?name=${encodeURIComponent(name)}&days=${days}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`云端历史返回 HTTP ${resp.status}`);
    const data = (await resp.json()) as CloudHistoryResponse;
    if (!data || !Array.isArray(data.points)) throw new Error('云端历史响应格式异常');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** 云端 points → StorageHistoryPoint[]（UTC 日期，价格非有限/缺失点丢弃） */
export function cloudPointsToHistory(points: CloudHistoryResponse['points']): StorageHistoryPoint[] {
  const out: StorageHistoryPoint[] = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const ts = Number(p[0]);
    const price = Number(p[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(price) || ts <= 0) continue;
    const vol = p.length >= 3 ? Number(p[2]) : NaN;
    const d = new Date(ts * 1000);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    out.push({ date, price, volume: Number.isFinite(vol) ? vol : null });
  }
  return out;
}
