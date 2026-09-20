/**
 * skinport：Skinport 公开成交历史 API（免 Key、免登录）。
 * GET https://api.skinport.com/v1/sales/history?app_id=730&currency=CNY&market_hash_name=...
 * 返回每个物品 7/30/90/365 天窗口的真实成交聚合（最低/最高/均价/中位/成交量）。
 * 用途：详情页「实际成交参考」——不依赖任何 Steam 登录，一次请求可覆盖多个物品。
 * 限速：官方 8 次/5 分钟，调用方需按物品按需请求并缓存。
 */

export interface SkinportWindow {
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  volume: number | null;
}

export interface SkinportStats {
  name: string;
  d7: SkinportWindow;
  d30: SkinportWindow;
  d90: SkinportWindow;
  d365: SkinportWindow;
}

type RawWindow = Record<string, unknown>;

function parseWindow(w: unknown): SkinportWindow {
  const o = (w ?? {}) as RawWindow;
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  return { min: num(o.min), max: num(o.max), avg: num(o.avg), median: num(o.median), volume: num(o.volume) };
}

/** 解析 Skinport sales/history 响应（数组或 {items:[...]} 包装均可） */
export function parseSkinportHistory(payload: unknown): Record<string, SkinportStats> {
  let arr: unknown[] = [];
  if (Array.isArray(payload)) arr = payload;
  else if (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).items)) {
    arr = (payload as Record<string, unknown>).items as unknown[];
  }
  const out: Record<string, SkinportStats> = {};
  for (const row of arr) {
    const o = (row ?? {}) as RawWindow;
    const name = String(o.market_hash_name ?? '');
    if (!name) continue;
    const sales = Array.isArray(o.sales) ? (o.sales[0] ?? {}) as RawWindow : (o as RawWindow);
    out[name] = {
      name,
      d7: parseWindow(sales.last_7_days),
      d30: parseWindow(sales.last_30_days),
      d90: parseWindow(sales.last_90_days),
      d365: parseWindow(sales.last_365_days),
    };
  }
  return out;
}

/** Skinport 请求超时（毫秒）：不可达时避免详情页 Promise.all 永久挂起 */
export const SKINPORT_TIMEOUT_MS = 5000;

export async function fetchSkinportHistory(
  names: string[],
  currency = 'CNY',
): Promise<Record<string, SkinportStats>> {
  const uniq = [...new Set(names)].filter((n) => !!n).slice(0, 50);
  if (uniq.length === 0) return {};
  const qs = uniq.map((n) => `market_hash_name=${encodeURIComponent(n)}`).join('&');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SKINPORT_TIMEOUT_MS);
  try {
    const resp = await fetch(`https://api.skinport.com/v1/sales/history?app_id=730&currency=${encodeURIComponent(currency)}&${qs}`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`Skinport 接口返回 ${resp.status}`);
    const payload = (await resp.json()) as unknown;
    return parseSkinportHistory(payload);
  } finally {
    clearTimeout(timer);
  }
}
