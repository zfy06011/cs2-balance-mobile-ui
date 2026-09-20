/**
 * detailCache：详情页分析结果进程内缓存（60 秒 TTL）。
 * 目的：从市场/雷达进入详情、买入后重新加载、反复进出同一箱子时秒开，
 * 避免每次重跑 collectPredictInputs + buildPrediction。
 * 扫描完成 / 刷新单箱价格 / 手动改 C5 价后调用 clearDetailCache 显式失效。
 */
interface Entry {
  v: unknown;
  t: number;
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 100;
const cache = new Map<string, Entry>();

export function getDetailCache<T>(name: string): T | null {
  const e = cache.get(name);
  if (!e) return null;
  if (Date.now() - e.t > TTL_MS) {
    cache.delete(name);
    return null;
  }
  return e.v as T;
}

export function setDetailCache<T>(name: string, v: T): void {
  cache.set(name, { v, t: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

/** 不传 name = 清空全部（扫描完成后用） */
export function clearDetailCache(name?: string): void {
  if (name) cache.delete(name);
  else cache.clear();
}
