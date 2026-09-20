function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatDiscount(value: number | null | undefined, digits = 2): string {
  const n = finite(value);
  return n == null || n < 0 ? '--' : `${(n * 10).toFixed(digits)} 折`;
}

export function formatMoney(value: number | null | undefined, digits = 2): string {
  const n = finite(value);
  return n == null ? '--' : `¥${n.toFixed(digits)}`;
}

export function formatScore(value: number | null | undefined): string {
  const n = finite(value);
  return n == null ? '--' : `${Math.round(n)}`;
}

export function formatCapacity(value: number | null | undefined): string {
  const n = finite(value);
  return n == null || n < 0 ? '--' : `当前可执行容量 ${formatMoney(n)}`;
}

export function formatSpread(value: number | null | undefined): string {
  const n = finite(value);
  return n == null || n < 0 ? '--' : `${(n * 100).toFixed(2)}%`;
}

export function formatCoverage(value: number | null | undefined): string {
  const n = finite(value);
  return n == null ? '--' : `${Math.max(0, Math.min(100, n * 100)).toFixed(0)}%`;
}

export function formatFreshness(value: 'fresh' | 'stale' | 'fallback' | 'missing'): string {
  if (value === 'stale') return '数据已过期';
  if (value === 'fallback') return '使用最近有效数据';
  if (value === 'missing') return '数据暂不可用';
  return '';
}

export function formatMarketState(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const labels: Record<string, string> = {
    STABLE: '稳定',
    RISING: '上行',
    FALLING: '下行',
    CHAOS: '波动较大',
    UNKNOWN: '未知',
  };
  return labels[value.toUpperCase()] ?? '未知';
}

