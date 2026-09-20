/**
 * Opportunity v2 Shadow Integration helpers。
 * 纯函数：只组合/比较已取得的数据，不联网、不读存储、不修改生产 Radar。
 */
import type { DiscountResult } from './discountV2';
import type { OpportunityDecision, OpportunityResult } from './types/opportunity';

export type OldRadarClass = 'positive' | 'neutral' | 'negative' | 'unknown';
export type DisagreementCode =
  | 'AGREE_POSITIVE'
  | 'AGREE_NEUTRAL'
  | 'AGREE_NEGATIVE'
  | 'OLD_POSITIVE_NEW_WATCH'
  | 'OLD_POSITIVE_NEW_AVOID'
  | 'OLD_WAIT_NEW_BUY'
  | 'OLD_AVOID_NEW_BUY'
  | 'NEW_CAPPED_BY_LIQUIDITY'
  | 'NEW_CAPPED_BY_CHAOS'
  | 'NEW_CAPPED_BY_STALE'
  | 'NEW_CAPPED_BY_APPROX_FEE'
  | 'NEW_AVOID_EXPECTED_GE_1'
  | 'NEW_AVOID_LOW_QUALITY'
  | 'NEW_AVOID_LOW_CAPACITY'
  | 'DISAGREE_OTHER';

export interface ShadowDiagnostics {
  orderbookOk: boolean;
  discountOk: boolean;
  opportunityOk: boolean;
  latencyMs?: number;
  http429?: boolean;
  stale?: boolean;
  missingFields: string[];
  errorCode?: string;
}

export interface ShadowRow {
  item: string;
  oldRadarSignal?: string;
  oldRadarScore?: number;
  oldRadarClass: OldRadarClass;
  rawScore: number;
  rawDecision: OpportunityDecision;
  opportunityDecision: OpportunityDecision;
  opportunityScore: number;
  suggestedMaxBudget: number;
  conservativeDiscount?: number;
  expectedDiscount?: number;
  listingDiscount?: number;
  currentDiscount?: number;
  filledDiscount?: number;
  liquidationCoverage?: number;
  spreadPct?: number;
  currentLiquidityCapacity?: number;
  volume24h?: number;
  c5AvailableQuantity?: number;
  marketDataQuality?: number;
  forecastQuality?: number;
  forecastAvailable: boolean;
  marketState?: string;
  hardGates: string[];
  caps: string[];
  primaryGate?: string;
  poolSource?: string;
  reasons: string[];
  warnings: string[];
  disagreement: DisagreementCode;
  diagnostics: ShadowDiagnostics;
}

export interface ShadowSummary {
  totalItems: number;
  successItems: number;
  failedItems: number;
  successRate: number;
  totalDurationMs: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  orderbookFailureCount: number;
  c5FailureCount: number;
  discountFailureCount: number;
  opportunityFailureCount: number;
  http429Count: number;
  http429Rate: number;
  staleCount: number;
  missingForecastCount: number;
  missingVolumeCount: number;
  missingC5SupplyCount: number;
  oldDistribution: Record<string, number>;
  newDistribution: Record<string, number>;
  disagreementDistribution: Record<string, number>;
}

export function oldRadarToClass(signal: unknown): OldRadarClass {
  switch (String(signal ?? '').toLowerCase()) {
    case 'buy':
    case 'positive':
      return 'positive';
    case 'wait':
    case 'watch':
    case 'neutral':
      return 'neutral';
    case 'avoid':
    case 'negative':
      return 'negative';
    default:
      return 'unknown';
  }
}

function newClass(decision: OpportunityDecision): OldRadarClass {
  if (decision === 'excellent' || decision === 'buy') return 'positive';
  if (decision === 'watch') return 'neutral';
  return 'negative';
}

function hasCode(result: OpportunityResult, code: string): boolean {
  return result.hardGates.includes(code) || result.caps.includes(code) || result.warnings.includes(code);
}

export function classifyDisagreement(
  oldSignal: unknown,
  opportunity: OpportunityResult,
): DisagreementCode {
  const old = oldRadarToClass(oldSignal);
  const next = newClass(opportunity.decision);
  if (old !== 'unknown' && old === next) {
    if (next === 'positive') return 'AGREE_POSITIVE';
    if (next === 'neutral') return 'AGREE_NEUTRAL';
    return 'AGREE_NEGATIVE';
  }
  if (opportunity.decision === 'avoid' && opportunity.hardGates.includes('expected_discount_not_viable')) return 'NEW_AVOID_EXPECTED_GE_1';
  if (opportunity.decision === 'avoid' && opportunity.hardGates.includes('market_data_quality_low')) return 'NEW_AVOID_LOW_QUALITY';
  if (opportunity.decision === 'avoid' && opportunity.hardGates.includes('current_capacity_too_small')) return 'NEW_AVOID_LOW_CAPACITY';
  if (old === 'positive' && next === 'neutral') return 'OLD_POSITIVE_NEW_WATCH';
  if (old === 'positive' && next === 'negative') return 'OLD_POSITIVE_NEW_AVOID';
  if (old === 'neutral' && next === 'positive') return 'OLD_WAIT_NEW_BUY';
  if (old === 'negative' && next === 'positive') return 'OLD_AVOID_NEW_BUY';
  if (hasCode(opportunity, 'approximate_fee_low_price_cap_watch')) return 'NEW_CAPPED_BY_APPROX_FEE';
  if (hasCode(opportunity, 'chaos_cap_watch')) return 'NEW_CAPPED_BY_CHAOS';
  if (hasCode(opportunity, 'market_data_stale')) return 'NEW_CAPPED_BY_STALE';
  if (hasCode(opportunity, 'current_capacity_too_small') || hasCode(opportunity, 'coverage_too_low_cap_watch')) return 'NEW_CAPPED_BY_LIQUIDITY';
  return 'DISAGREE_OTHER';
}

export function buildShadowRow(input: {
  item: string;
  oldRadar?: { signal?: string; score?: number };
  discount: DiscountResult;
  opportunity: OpportunityResult;
  poolSource?: string;
  volume24h?: number;
  c5AvailableQuantity?: number;
  marketState?: string;
  diagnostics: ShadowDiagnostics;
}): ShadowRow {
  const d = input.opportunity;
  const discount = input.discount;
  const row: ShadowRow = {
    item: input.item,
    oldRadarSignal: input.oldRadar?.signal,
    oldRadarScore: input.oldRadar?.score,
    oldRadarClass: oldRadarToClass(input.oldRadar?.signal),
    rawScore: d.rawScore ?? d.score,
    rawDecision: d.rawDecision ?? d.decision,
    opportunityDecision: d.decision,
    opportunityScore: d.score,
    suggestedMaxBudget: d.suggestedMaxBudget,
    conservativeDiscount: discount.conservative7d?.discount,
    expectedDiscount: discount.expected7d?.discount,
    listingDiscount: discount.listing7d?.discount,
    currentDiscount: discount.current.fullPositionDiscount ?? discount.current.discount,
    filledDiscount: discount.current.filledDiscount,
    liquidationCoverage: discount.current.liquidationCoverage,
    spreadPct: discount.liquidity.spreadPct,
    currentLiquidityCapacity: discount.currentLiquidityCapacity.executableBudget,
    volume24h: input.volume24h,
    c5AvailableQuantity: input.c5AvailableQuantity,
    marketDataQuality: discount.marketDataQuality.score,
    forecastQuality: discount.forecastQuality.score,
    forecastAvailable: discount.forecastQuality.available,
    marketState: input.marketState,
    hardGates: d.hardGates.slice(),
    caps: d.caps.slice(),
    primaryGate: primaryGateOf(d),
    poolSource: input.poolSource,
    reasons: d.reasons.slice(),
    warnings: d.warnings.slice(),
    disagreement: classifyDisagreement(input.oldRadar?.signal, d),
    diagnostics: { ...input.diagnostics, missingFields: input.diagnostics.missingFields.slice() },
  };
  return row;
}

export function primaryGateOf(opportunity: OpportunityResult): string | undefined {
  const priority = ['missing_expected_7d', 'market_data_quality_low', 'expected_discount_not_viable', 'current_capacity_too_small'];
  return priority.find((code) => opportunity.hardGates.includes(code)) ?? (opportunity.hardGates.length > 0 ? 'other' : undefined);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function sortShadowRows(rows: readonly ShadowRow[]): ShadowRow[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const score = b.row.opportunityScore - a.row.opportunityScore;
    if (score !== 0) return score;
    const discount = (a.row.expectedDiscount ?? Number.POSITIVE_INFINITY) - (b.row.expectedDiscount ?? Number.POSITIVE_INFINITY);
    if (discount !== 0) return discount;
    const name = a.row.item.localeCompare(b.row.item);
    return name !== 0 ? name : a.index - b.index;
  }).map((entry) => entry.row);
}

export function topShadowRows(rows: readonly ShadowRow[], limit: number): ShadowRow[] {
  return sortShadowRows(rows).slice(0, Math.max(0, limit));
}

export function summarizeShadowRows(rows: readonly ShadowRow[], totalDurationMs = 0): ShadowSummary {
  const latencies = rows.map((row) => row.diagnostics.latencyMs).filter((value): value is number => Number.isFinite(value));
  const successItems = rows.filter((row) => row.diagnostics.orderbookOk
    && row.diagnostics.discountOk
    && row.diagnostics.opportunityOk
    && !row.diagnostics.missingFields.includes('c5.unitPrice')).length;
  const http429Count = rows.filter((row) => row.diagnostics.http429 === true).length;
  const oldDistribution: Record<string, number> = {};
  const newDistribution: Record<string, number> = {};
  const disagreementDistribution: Record<string, number> = {};
  for (const row of rows) {
    increment(oldDistribution, row.oldRadarSignal ?? 'unknown');
    increment(newDistribution, row.opportunityDecision);
    increment(disagreementDistribution, row.disagreement);
  }
  return {
    totalItems: rows.length,
    successItems,
    failedItems: rows.length - successItems,
    successRate: rows.length > 0 ? successItems / rows.length : 0,
    totalDurationMs,
    avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    p50LatencyMs: percentile(latencies, 0.50),
    p95LatencyMs: percentile(latencies, 0.95),
    orderbookFailureCount: rows.filter((row) => !row.diagnostics.orderbookOk).length,
    c5FailureCount: rows.filter((row) => row.diagnostics.missingFields.includes('c5.unitPrice')).length,
    discountFailureCount: rows.filter((row) => !row.diagnostics.discountOk).length,
    opportunityFailureCount: rows.filter((row) => !row.diagnostics.opportunityOk).length,
    http429Count,
    http429Rate: rows.length > 0 ? http429Count / rows.length : 0,
    staleCount: rows.filter((row) => row.diagnostics.stale === true).length,
    missingForecastCount: rows.filter((row) => row.diagnostics.missingFields.includes('forecast')).length,
    missingVolumeCount: rows.filter((row) => row.diagnostics.missingFields.includes('volume24h')).length,
    missingC5SupplyCount: rows.filter((row) => row.diagnostics.missingFields.includes('c5AvailableQuantity')).length,
    oldDistribution,
    newDistribution,
    disagreementDistribution,
  };
}

/** 有界并发；任一 item 失败只影响该 item。 */
export async function mapBounded<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.floor(concurrency));
  async function consume(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, () => consume()));
  return output;
}
