import type { DiscountResult } from '../discountV2';

export type OpportunityDecision = 'excellent' | 'buy' | 'watch' | 'avoid';

export interface OpportunityBand {
  max: number;
  score: number;
}

export interface OpportunityMinBand {
  min: number;
  score: number;
}

export interface OpportunityWeights {
  discount: number;
  liquidity: number;
  volume: number;
  c5Supply: number;
  risk: number;
  forecast: number;
  dataQuality: number;
}

export interface OpportunityConfig {
  weights: OpportunityWeights;
  discountBands: OpportunityBand[];
  spreadBands: OpportunityBand[];
  capacityBands: OpportunityBand[];
  volumeBands: OpportunityMinBand[];
  c5SupplyBands: OpportunityMinBand[];
  coverageBands: OpportunityMinBand[];
  decisionThresholds: { excellent: number; buy: number; watch: number };
  gates: { minMarketDataQuality: number; minCapacityBudget: number };
  excellent: {
    maxConservativeDiscount: number;
    maxExpectedDiscount: number;
    minCapacityBudget: number;
    maxSpreadPct: number;
    minMarketDataQuality: number;
  };
  approxFeeSensitivePrice: number;
  riskMultipliers: Record<string, number>;
}

export interface OpportunityInput {
  item: string;
  discount: DiscountResult;
  market: {
    volume24h?: number;
    c5AvailableQuantity?: number;
    highestBuy?: number;
    lowestSell?: number;
  };
  risk?: {
    marketState?: 'STABLE' | 'RISING' | 'FALLING' | 'CHAOS' | string;
    cv?: number;
    r2?: number;
    volatility30d?: number;
    volatility365d?: number;
  };
  forecast?: {
    confidence?: number;
    direction?: 'UP' | 'DOWN' | 'FLAT' | string;
  };
  feeModel?: {
    kind: 'approximate' | 'exact';
    exact: boolean;
  };
  evaluationBudget?: number;
  config?: Partial<OpportunityConfig>;
}

export interface OpportunityBreakdown {
  discount: number;
  liquidity: number;
  volume: number;
  c5Supply: number;
  risk: number;
  forecast: number;
  dataQuality: number;
}

export interface OpportunityConfidence {
  marketData: number;
  forecast?: number;
  overall: number;
}

export interface OpportunityResult {
  item: string;
  score: number;
  decision: OpportunityDecision;
  /** 诊断字段：score/decision 保留既有语义，raw* 记录 caps/gates 之前的结果。 */
  rawScore: number;
  rawDecision: OpportunityDecision;
  suggestedMaxBudget: number;
  breakdown: OpportunityBreakdown;
  hardGates: string[];
  caps: string[];
  reasons: string[];
  warnings: string[];
  confidence: OpportunityConfidence;
}
