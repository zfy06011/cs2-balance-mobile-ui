/**
 * analysisCache：分析结果缓存（v1.8.2 切页提速）。
 *
 * 为什么需要：App.tsx 是「当前标签页才挂载」的写法，切页会卸载再重建，
 * 每次重挂载都重跑 engine.markets()/radar()/status()/inventory()——而这些
 * 全表扫描 + 逐箱 V4 预测的成本很高（100 箱 ≈300 次 SQL + 100 次预测）。
 *
 * 设计：不设 TTL 过期，只靠「数据代次」（generation）失效——
 * 只有真正写入数据（扫描完成/单箱刷新/改 C5 价/清库/改设置）时才 bump，
 * 因此切页永远命中缓存（0 查询 0 预测），数据变了又不会看到旧值。
 */
interface Entry {
  gen: number;
  v: unknown;
}

let generation = 0;
const cache = new Map<string, Entry>();

/** 读取缓存（未命中或代次过期返回 null） */
export function getAnalysisCache<T>(key: string): T | null {
  const e = cache.get(key);
  if (!e || e.gen !== generation) return null;
  return e.v as T;
}

/** 写入缓存（带当前代次） */
export function setAnalysisCache<T>(key: string, v: T): void {
  cache.set(key, { gen: generation, v });
}

/**
 * 数据已变更：自增代次使全部旧结果失效。
 * 必须在每个写入数据的地方调用（否则会看到过期结果）。
 */
export function bumpAnalysisGeneration(): void {
  generation++;
  cache.clear();
}

/** 当前代次（测试用） */
export function analysisGeneration(): number {
  return generation;
}
