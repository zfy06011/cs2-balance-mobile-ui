/**
 * Opportunity Engine v2：Phase 3A 独立纯决策层。
 * 不联网、不读 SQLite、不调用 Provider，不接现有 radar/collector/UI。
 */
import type { DiscountResult } from './discountV2';
import {
  type OpportunityBand,
  type OpportunityConfig,
  type OpportunityDecision,
  type OpportunityInput,
  type OpportunityMinBand,
  type OpportunityResult,
} from './types/opportunity';

export const DEFAULT_OPPORTUNITY_CONFIG: OpportunityConfig = Object.freeze({
  weights: {
    discount: 0.35,
    liquidity: 0.25,
    volume: 0.10,
    c5Supply: 0.10,
    risk: 0.10,
    forecast: 0.05,
    dataQuality: 0.05,
  },
  discountBands: [
    { max: 0.75, score: 100 },
    { max: 0.82, score: 85 },
    { max: 0.90, score: 60 },
    { max: 0.97, score: 30 },
    { max: 1.00, score: 10 },
    { max: Number.POSITIVE_INFINITY, score: 0 },
  ],
  spreadBands: [
    { max: 0.01, score: 100 },
    { max: 0.02, score: 85 },
    { max: 0.05, score: 55 },
    { max: 0.08, score: 25 },
    { max: 0.12, score: 0 },
  ],
  capacityBands: [
    { max: 20, score: 0 },
    { max: 50, score: 20 },
    { max: 100, score: 40 },
    { max: 300, score: 70 },
    { max: 500, score: 85 },
    { max: 1000, score: 100 },
    { max: Number.POSITIVE_INFINITY, score: 100 },
  ],
  volumeBands: [
    { min: 10, score: 0 },
    { min: 30, score: 15 },
    { min: 100, score: 35 },
    { min: 300, score: 55 },
    { min: 1000, score: 75 },
    { min: 5000, score: 90 },
    { min: 10000, score: 100 },
  ],
  c5SupplyBands: [
    { min: 0, score: 0 },
    { min: 5, score: 15 },
    { min: 20, score: 35 },
    { min: 50, score: 55 },
    { min: 100, score: 70 },
    { min: 200, score: 85 },
    { min: 500, score: 100 },
  ],
  coverageBands: [
    { min: 0, score: 0 },
    { min: 0.5, score: 20 },
    { min: 0.75, score: 50 },
    { min: 0.9, score: 80 },
    { min: 1, score: 100 },
  ],
  decisionThresholds: { excellent: 85, buy: 70, watch: 50 },
  gates: { minMarketDataQuality: 0.60, minCapacityBudget: 20 },
  excellent: {
    maxConservativeDiscount: 0.90,
    maxExpectedDiscount: 0.85,
    minCapacityBudget: 100,
    maxSpreadPct: 0.05,
    minMarketDataQuality: 0.80,
  },
  approxFeeSensitivePrice: 1.00,
  riskMultipliers: { STABLE: 1.00, RISING: 0.90, FALLING: 0.60, CHAOS: 0.25, UNKNOWN: 0.50 },
});

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function addUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

function mergeConfig(input: Partial<OpportunityConfig> | undefined): OpportunityConfig {
  return {
    ...DEFAULT_OPPORTUNITY_CONFIG,
    ...(input ?? {}),
    weights: { ...DEFAULT_OPPORTUNITY_CONFIG.weights, ...(input?.weights ?? {}) },
    decisionThresholds: { ...DEFAULT_OPPORTUNITY_CONFIG.decisionThresholds, ...(input?.decisionThresholds ?? {}) },
    gates: { ...DEFAULT_OPPORTUNITY_CONFIG.gates, ...(input?.gates ?? {}) },
    excellent: { ...DEFAULT_OPPORTUNITY_CONFIG.excellent, ...(input?.excellent ?? {}) },
    riskMultipliers: { ...DEFAULT_OPPORTUNITY_CONFIG.riskMultipliers, ...(input?.riskMultipliers ?? {}) },
    discountBands: input?.discountBands ?? DEFAULT_OPPORTUNITY_CONFIG.discountBands,
    spreadBands: input?.spreadBands ?? DEFAULT_OPPORTUNITY_CONFIG.spreadBands,
    capacityBands: input?.capacityBands ?? DEFAULT_OPPORTUNITY_CONFIG.capacityBands,
    volumeBands: input?.volumeBands ?? DEFAULT_OPPORTUNITY_CONFIG.volumeBands,
    c5SupplyBands: input?.c5SupplyBands ?? DEFAULT_OPPORTUNITY_CONFIG.c5SupplyBands,
    coverageBands: input?.coverageBands ?? DEFAULT_OPPORTUNITY_CONFIG.coverageBands,
  };
}

/** 分段点之间线性插值；输入曲线需按 max/min 升序。 */
export function scoreLowerBetter(value: number | null | undefined, bands: OpportunityBand[]): number {
  const n = finite(value);
  if (n == null || bands.length === 0) return 0;
  const sorted = bands.slice().sort((a, b) => a.max - b.max);
  if (n <= sorted[0].max) return clamp(sorted[0].score);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (n <= cur.max) {
      if (!Number.isFinite(cur.max) || cur.max === prev.max) return clamp(cur.score);
      const t = (n - prev.max) / (cur.max - prev.max);
      return clamp(prev.score + (cur.score - prev.score) * t);
    }
  }
  return clamp(sorted[sorted.length - 1].score);
}

export function scoreHigherBetter(value: number | null | undefined, bands: OpportunityMinBand[]): number {
  const n = finite(value);
  if (n == null || bands.length === 0) return 0;
  const sorted = bands.slice().sort((a, b) => a.min - b.min);
  if (n < sorted[0].min) return 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (n < cur.min) {
      const span = cur.min - prev.min;
      const t = span > 0 ? (n - prev.min) / span : 1;
      return clamp(prev.score + (cur.score - prev.score) * t);
    }
  }
  return clamp(sorted[sorted.length - 1].score);
}

function scoreCoverage(value: number | undefined, config: OpportunityConfig, neutral: boolean): number {
  return neutral ? 50 : scoreHigherBetter(value, config.coverageBands);
}

function riskScore(input: OpportunityInput, config: OpportunityConfig, warnings: string[]): number {
  const state = String(input.risk?.marketState ?? 'UNKNOWN').toUpperCase();
  const base = config.riskMultipliers[state] != null ? config.riskMultipliers[state] * 100 : config.riskMultipliers.UNKNOWN * 100;
  if (state === 'UNKNOWN') addUnique(warnings, 'market_state_unknown');
  const cv = finite(input.risk?.cv);
  let penalty = 0;
  if (cv != null) {
    if (cv <= 0.05) penalty = 0;
    else if (cv < 0.10) penalty = ((cv - 0.05) / 0.05) * 10;
    else if (cv < 0.20) penalty = 10 + ((cv - 0.10) / 0.10) * 15;
    else if (cv < 0.35) penalty = 25 + ((cv - 0.20) / 0.15) * 25;
    else penalty = 50;
  }
  return clamp(base - penalty);
}

function forecastScore(input: OpportunityInput, warnings: string[]): { score: number; available: boolean; confidence?: number } {
  const quality = input.discount.forecastQuality;
  const confidence = finite(input.forecast?.confidence ?? quality?.score);
  const available = quality?.available === true || confidence != null;
  if (!available) {
    addUnique(warnings, 'forecast_missing');
    return { score: 50, available: false };
  }
  let score = confidence != null ? confidence * 100 : 50;
  const direction = String(input.forecast?.direction ?? 'FLAT').toUpperCase();
  if (direction === 'UP') score += 10;
  else if (direction === 'DOWN') score -= 15;
  else if (direction !== 'FLAT') addUnique(warnings, 'forecast_direction_unknown');
  return { score: clamp(score), available: true, confidence: confidence != null ? clamp(confidence, 0, 1) : undefined };
}

function decisionForScore(score: number, config: OpportunityConfig): OpportunityDecision {
  if (score >= config.decisionThresholds.excellent) return 'excellent';
  if (score >= config.decisionThresholds.buy) return 'buy';
  if (score >= config.decisionThresholds.watch) return 'watch';
  return 'avoid';
}

function capDecision(decision: OpportunityDecision, cap: OpportunityDecision): OpportunityDecision {
  const rank: Record<OpportunityDecision, number> = { avoid: 0, watch: 1, buy: 2, excellent: 3 };
  return rank[decision] > rank[cap] ? cap : decision;
}

function qualityScore(input: OpportunityInput): { score: number; market: number; forecast: number; overallConfidence: number } {
  const marketRaw = input.discount.marketDataQuality?.score ?? input.discount.quality?.marketData?.score ?? input.discount.quality?.score ?? 0.5;
  const market = clamp(marketRaw * 100);
  const forecastAvailable = input.discount.forecastQuality?.available === true;
  const forecastRaw = input.discount.forecastQuality?.score ?? finite(input.forecast?.confidence) ?? 0.5;
  const forecast = forecastAvailable ? clamp(forecastRaw * 100) : 50;
  const score = market * 0.7 + forecast * 0.3;
  const overallConfidence = forecastAvailable ? (market / 100) * 0.7 + (forecast / 100) * 0.3 : market / 100;
  return { score: clamp(score), market: market / 100, forecast: forecastAvailable ? forecast / 100 : 0.5, overallConfidence: clamp(overallConfidence, 0, 1) };
}

function suggestedBudget(input: OpportunityInput, config: OpportunityConfig, marketQuality: number, warnings: string[]): number {
  const capacity = finite(input.discount.currentLiquidityCapacity?.executableBudget ?? input.discount.liquidity?.executableBudget) ?? 0;
  const state = String(input.risk?.marketState ?? 'UNKNOWN').toUpperCase();
  let multiplier = config.riskMultipliers[state] ?? config.riskMultipliers.UNKNOWN;
  if (state === 'UNKNOWN') addUnique(warnings, 'market_state_unknown');
  let qualityMultiplier = clamp(marketQuality, 0, 1);
  const price = finite(input.market.highestBuy ?? input.discount.current.grossPerUnit) ?? 0;
  const fee = input.feeModel ?? input.discount.feeModel;
  if (fee && fee.exact === false && price < config.approxFeeSensitivePrice) {
    multiplier *= 0.5;
  }
  let value = Math.max(0, capacity * multiplier * qualityMultiplier);
  const evaluationBudget = finite(input.evaluationBudget);
  if (evaluationBudget != null && evaluationBudget >= 0) value = Math.min(value, evaluationBudget);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function buildOpportunityV2(input: OpportunityInput): OpportunityResult {
  const config = mergeConfig(input.config);
  const warnings: string[] = [];
  const hardGates: string[] = [];
  const caps: string[] = [];
  const reasons: string[] = [];
  const discount = input.discount;
  const conservative = finite(discount.conservative7d?.discount);
  const expected = finite(discount.expected7d?.discount);
  const discountValue = conservative != null && expected != null ? conservative * 0.60 + expected * 0.40 : expected ?? conservative ?? 0;
  const discountScore = scoreLowerBetter(discountValue, config.discountBands);
  if (conservative == null) addUnique(warnings, 'conservative_discount_missing');
  if (expected == null) addUnique(warnings, 'expected_discount_missing');
  if (discountScore >= 70) addUnique(reasons, 'discount_attractive');
  if (conservative != null && conservative <= 0.90) addUnique(reasons, 'conservative_discount_good');

  const spreadPct = finite(discount.liquidity?.spreadPct);
  const capacityBudget = finite(discount.currentLiquidityCapacity?.executableBudget ?? discount.liquidity?.executableBudget) ?? 0;
  const requested = finite(discount.current?.requestedQuantity) ?? 0;
  const coverage = finite(discount.current?.liquidationCoverage) ?? 0;
  const spreadScore = scoreLowerBetter(spreadPct, config.spreadBands);
  const capacityScore = scoreLowerBetter(capacityBudget, config.capacityBands);
  // A one-item evaluation is not evidence of large-capital coverage; capacity remains primary.
  const coverageScore = scoreCoverage(coverage, config, requested <= 1);
  if (requested <= 1) addUnique(warnings, 'coverage_single_unit_neutral');
  const liquidityScore = clamp(spreadScore * 0.35 + capacityScore * 0.45 + coverageScore * 0.20);
  if (liquidityScore >= 70) addUnique(reasons, 'liquidity_strong');
  if (spreadPct != null && spreadPct <= 0.02) addUnique(reasons, 'spread_tight');

  const volumeMissing = finite(input.market.volume24h) == null;
  const volumeScore = volumeMissing ? 50 : scoreHigherBetter(input.market.volume24h, config.volumeBands);
  if (volumeMissing) addUnique(warnings, 'volume_missing');
  else if (volumeScore >= 75) addUnique(reasons, 'volume_high');

  const c5Missing = finite(input.market.c5AvailableQuantity) == null;
  const c5SupplyScore = c5Missing ? 50 : scoreHigherBetter(input.market.c5AvailableQuantity, config.c5SupplyBands);
  if (c5Missing) addUnique(warnings, 'c5_supply_missing');
  else if (c5SupplyScore >= 70) addUnique(reasons, 'c5_supply_available');

  const risk = riskScore(input, config, warnings);
  const forecastResult = forecastScore(input, warnings);
  const quality = qualityScore(input);
  const dataQualityScore = quality.score;
  const state = String(input.risk?.marketState ?? 'UNKNOWN').toUpperCase();
  if (state === 'STABLE') addUnique(reasons, 'market_stable');
  const weights = config.weights;
  const rawScore = discountScore * weights.discount
    + liquidityScore * weights.liquidity
    + volumeScore * weights.volume
    + c5SupplyScore * weights.c5Supply
    + risk * weights.risk
    + forecastResult.score * weights.forecast
    + dataQualityScore * weights.dataQuality;
  const score = clamp(rawScore);
  const rawDecision = decisionForScore(score, config);
  let decision = rawDecision;

  const marketQualityRaw = finite(discount.marketDataQuality?.score ?? discount.quality?.marketData?.score ?? discount.quality?.score) ?? 0;
  const stale = discount.marketDataQuality?.stale ?? discount.quality?.stale ?? false;
  const feeModel = input.feeModel ?? discount.feeModel;
  const price = finite(input.market.highestBuy ?? discount.current.grossPerUnit) ?? 0;
  if (expected == null) addUnique(hardGates, 'missing_expected_7d');
  if (expected != null && expected >= 1) addUnique(hardGates, 'expected_discount_not_viable');
  if (marketQualityRaw < config.gates.minMarketDataQuality) addUnique(hardGates, 'market_data_quality_low');
  if (capacityBudget < config.gates.minCapacityBudget) addUnique(hardGates, 'current_capacity_too_small');
  if (stale) addUnique(caps, 'market_data_stale');
  if (state === 'CHAOS') addUnique(caps, 'chaos_cap_watch');
  if (!forecastResult.available) addUnique(caps, 'forecast_missing_cap_watch');
  if (coverage < 0.5) addUnique(caps, 'coverage_too_low_cap_watch');
  if (feeModel && feeModel.exact === false && price < config.approxFeeSensitivePrice) {
    addUnique(caps, 'approximate_fee_low_price_cap_watch');
    addUnique(warnings, 'steam_fee_model_approximate');
  }
  if (discount.futureModel?.orderbookPredicted === false) addUnique(warnings, 'future_orderbook_not_predicted');
  if (discount.futureModel?.liquidityGuaranteed === false) addUnique(warnings, 'future_liquidity_not_guaranteed');
  if (discount.current?.liquidationCoverage != null && discount.current.liquidationCoverage < 0.5) addUnique(warnings, 'partial_fill');

  const excellent = conservative != null && expected != null
    && conservative <= config.excellent.maxConservativeDiscount
    && expected <= config.excellent.maxExpectedDiscount
    && capacityBudget >= config.excellent.minCapacityBudget
    && (spreadPct ?? 1) <= config.excellent.maxSpreadPct
    && marketQualityRaw >= config.excellent.minMarketDataQuality
    && !stale && forecastResult.available && state !== 'CHAOS'
    && !(feeModel && feeModel.exact === false && price < config.approxFeeSensitivePrice);
  if (decision === 'excellent' && !excellent) addUnique(caps, 'excellent_requirements_not_met');
  if (hardGates.length > 0) decision = 'avoid';
  else for (const cap of caps) decision = capDecision(decision, cap === 'market_data_stale' || cap === 'chaos_cap_watch' || cap === 'forecast_missing_cap_watch' || cap === 'coverage_too_low_cap_watch' || cap === 'approximate_fee_low_price_cap_watch' || cap === 'excellent_requirements_not_met' ? 'watch' : decision);

  const budget = suggestedBudget(input, config, quality.market, warnings);
  const breakdown = {
    discount: clamp(discountScore),
    liquidity: clamp(liquidityScore),
    volume: clamp(volumeScore),
    c5Supply: clamp(c5SupplyScore),
    risk: clamp(risk),
    forecast: clamp(forecastResult.score),
    dataQuality: clamp(dataQualityScore),
  };
  return {
    item: input.item,
    score,
    decision,
    rawScore: score,
    rawDecision,
    suggestedMaxBudget: budget,
    breakdown,
    hardGates,
    caps,
    reasons,
    warnings,
    confidence: {
      marketData: quality.market,
      ...(forecastResult.confidence != null ? { forecast: forecastResult.confidence } : {}),
      overall: quality.overallConfidence,
    },
  };
}
