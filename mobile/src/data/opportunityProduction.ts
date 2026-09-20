/**
 * 3C-1 Production Opportunity Orchestrator。
 * RN-compatible：不依赖 fs/path/process，不主动联网，不接 UI。
 * 调用方负责提供已准备好的 Forecast/Orderbook/C5 数据组合。
 */
import { DEFAULT_FEATURE_FLAGS, normalizeFeatureFlags, type FeatureFlags, type OpportunityMode } from '../config/featureFlags';
import { buildOpportunityV2 } from '../core/opportunityV2';
import type { OpportunityInput, OpportunityResult } from '../core/types/opportunity';

export interface ProductionCandidate {
  item: string;
  legacy: {
    signal?: string;
    score?: number;
    expectedDiscount?: number;
    expectedRoi?: number | null;
    c5BuyPrice?: number | null;
    steamSellPrice?: number | null;
    steamNetReceive?: number | null;
    netProfit?: number | null;
    riskLevel?: string;
    liquidity?: string;
    dataInsufficient?: boolean;
    steamVolume?: number | null;
  };
  opportunityInput?: OpportunityInput;
  prepared: {
    forecastReady: boolean;
    orderbookStatus: 'live' | 'cache_fresh' | 'cache_stale' | 'failed';
    c5Ready: boolean;
    volumeReady?: boolean;
    sourceTimestamp?: number;
    orderbookFetchedAt?: number;
    c5FetchedAt?: number;
    c5BuyPrice?: number;
    provenance?: {
      forecast?: string;
      orderbook?: string;
      c5?: string;
      discount?: string;
    };
  };
}

export interface ProductionOpportunityItem {
  item: string;
  generatedAt: number;
  mode: OpportunityMode;
  legacy?: ProductionCandidate['legacy'];
  v2?: {
    score: number;
    decision: OpportunityResult['decision'];
    suggestedMaxBudget: number;
    currentDiscount?: number;
    conservativeDiscount?: number;
    expectedDiscount?: number;
    c5BuyPrice?: number;
    c5FetchedAt?: number;
    listingDiscount?: number;
    spreadPct?: number;
    executableBudget?: number;
    marketDataQuality: number;
    forecastQuality?: number;
    marketState?: string;
    steamHighestBuy?: number;
    steamLowestSell?: number;
    orderbookFetchedAt?: number;
    currentFilledQuantity?: number;
    currentRequestedQuantity?: number;
    liquidationCoverage?: number;
    filledDiscount?: number;
    reasons: string[];
    warnings: string[];
    hardGates: string[];
    caps: string[];
  };
  diagnostics: {
    forecastStatus: string;
    orderbookStatus: string;
    c5Status: string;
    stale: boolean;
    fallbackUsed: boolean;
    sourceTimestamp?: number;
    provenance?: {
      forecast?: string;
      orderbook?: string;
      c5?: string;
      discount?: string;
    };
    reason?: string;
  };
}

export interface ProductionOpportunitySnapshot {
  generatedAt: number;
  mode: OpportunityMode;
  candidateCount: number;
  items: ProductionOpportunityItem[];
  diagnostics: {
    inputKind: 'live' | 'synthetic' | 'fixture';
    forecastCoverage: number;
    orderbookFreshCoverage: number;
    c5Coverage: number;
    failureCount: number;
    stale: boolean;
    fallbackCount: number;
    lastRefreshDurationMs: number;
    reason?: string;
  };
  /** 仅 dev/test fixture 使用；生产快照不得将 synthetic 当作 live。 */
  isDemo?: boolean;
}

export interface ProductionOrchestratorConfig {
  minRefreshIntervalMs?: number;
  forecastCoverageThreshold?: number;
  orderbookFreshCoverageThreshold?: number;
  c5CoverageThreshold?: number;
  snapshotStaleAfterMs?: number;
  inputKind?: 'live' | 'synthetic' | 'fixture';
  now?: () => number;
}

export class ProductionOpportunityOrchestrator {
  private readonly flags: FeatureFlags;
  private readonly minRefreshIntervalMs: number;
  private readonly forecastCoverageThreshold: number;
  private readonly orderbookFreshCoverageThreshold: number;
  private readonly c5CoverageThreshold: number;
  private readonly snapshotStaleAfterMs: number;
  private readonly inputKind: 'live' | 'synthetic' | 'fixture';
  private readonly now: () => number;
  private currentSnapshot: ProductionOpportunitySnapshot | null = null;
  private currentGeneratedAt = 0;
  private inflight: Promise<ProductionOpportunitySnapshot> | null = null;
  private lastDiagnostics: ProductionOpportunitySnapshot['diagnostics'] | null = null;

  constructor(flags: Partial<FeatureFlags> = DEFAULT_FEATURE_FLAGS, config: ProductionOrchestratorConfig = {}) {
    this.flags = normalizeFeatureFlags(flags);
    this.minRefreshIntervalMs = config.minRefreshIntervalMs ?? 2 * 60 * 1000;
    this.forecastCoverageThreshold = config.forecastCoverageThreshold ?? 0.90;
    this.orderbookFreshCoverageThreshold = config.orderbookFreshCoverageThreshold ?? 0.90;
    this.c5CoverageThreshold = config.c5CoverageThreshold ?? 0.90;
    this.snapshotStaleAfterMs = Math.max(0, config.snapshotStaleAfterMs ?? 10 * 60 * 1000);
    this.inputKind = config.inputKind ?? 'fixture';
    this.now = config.now ?? (() => Date.now());
  }

  mode(): OpportunityMode { return this.flags.opportunityMode; }
  current(): ProductionOpportunitySnapshot | null {
    this.markCurrentStaleIfNeeded();
    return this.currentSnapshot;
  }
  diagnostics(): ProductionOpportunitySnapshot['diagnostics'] | null { return this.lastDiagnostics; }

  refresh(candidates: readonly ProductionCandidate[], force = false): Promise<ProductionOpportunitySnapshot> {
    if (this.inflight) return this.inflight;
    this.markCurrentStaleIfNeeded();
    const now = this.now();
    if (!force && this.currentSnapshot && now - this.currentGeneratedAt < this.minRefreshIntervalMs) {
      return Promise.resolve(this.currentSnapshot);
    }
    this.inflight = this.buildAndSwap(candidates).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async buildAndSwap(candidates: readonly ProductionCandidate[]): Promise<ProductionOpportunitySnapshot> {
    const startedAt = this.now();
    const requestedMode = this.flags.opportunityMode;
    const nextItems: ProductionOpportunityItem[] = [];
    let failures = 0;
    let fallbackCount = 0;
    let forecastReady = 0;
    let orderbookFresh = 0;
    let c5Ready = 0;
    let stale = false;

    for (const candidate of candidates) {
      const prepared = candidate.prepared;
      if (prepared.forecastReady) forecastReady++;
      if (prepared.orderbookStatus === 'live' || prepared.orderbookStatus === 'cache_fresh') orderbookFresh++;
      if (prepared.c5Ready) c5Ready++;
      if (prepared.orderbookStatus === 'cache_stale') stale = true;
      const preparationFailure = !prepared.forecastReady || prepared.orderbookStatus === 'failed' || !prepared.c5Ready;
      if (preparationFailure) failures++;
      const base: ProductionOpportunityItem = {
        item: candidate.item,
        generatedAt: startedAt,
        mode: requestedMode,
        legacy: { ...candidate.legacy },
        diagnostics: {
          forecastStatus: prepared.forecastReady ? 'ready' : 'missing',
          orderbookStatus: prepared.orderbookStatus,
          c5Status: prepared.c5Ready ? 'ready' : 'missing',
          stale: prepared.orderbookStatus === 'cache_stale',
          fallbackUsed: false,
          ...(prepared.sourceTimestamp != null ? { sourceTimestamp: prepared.sourceTimestamp } : {}),
          ...(prepared.provenance ? { provenance: { ...prepared.provenance } } : {}),
          ...(preparationFailure ? { reason: 'prepared_data_incomplete' } : {}),
        },
      };

      if (requestedMode === 'legacy') {
        nextItems.push(base);
        continue;
      }
      if (!candidate.opportunityInput) {
        if (!preparationFailure) failures++;
        fallbackCount++;
        base.diagnostics.fallbackUsed = true;
        base.diagnostics.reason = 'v2_input_missing';
        nextItems.push(base);
        continue;
      }
      try {
        const result = buildOpportunityV2(candidate.opportunityInput);
        const discount = candidate.opportunityInput.discount;
        base.v2 = {
          score: result.score,
          decision: result.decision,
          suggestedMaxBudget: result.suggestedMaxBudget,
          currentDiscount: discount.current.discount,
          conservativeDiscount: discount.conservative7d?.discount,
          expectedDiscount: discount.expected7d?.discount,
          listingDiscount: discount.listing7d?.discount,
          spreadPct: discount.liquidity.spreadPct,
          executableBudget: discount.currentLiquidityCapacity.executableBudget,
          marketDataQuality: result.confidence.marketData,
          forecastQuality: result.confidence.forecast,
          marketState: candidate.opportunityInput.risk?.marketState,
          steamHighestBuy: candidate.opportunityInput.market.highestBuy,
          steamLowestSell: candidate.opportunityInput.market.lowestSell,
          orderbookFetchedAt: prepared.orderbookFetchedAt ?? prepared.sourceTimestamp,
          ...(prepared.c5BuyPrice != null ? { c5BuyPrice: prepared.c5BuyPrice } : {}),
          ...(prepared.c5FetchedAt != null ? { c5FetchedAt: prepared.c5FetchedAt } : {}),
          currentFilledQuantity: discount.current.filledQuantity,
          currentRequestedQuantity: discount.current.requestedQuantity,
          liquidationCoverage: discount.current.liquidationCoverage,
          filledDiscount: discount.current.filledDiscount,
          reasons: result.reasons.slice(),
          warnings: result.warnings.slice(),
          hardGates: result.hardGates.slice(),
          caps: result.caps.slice(),
        };
        if (requestedMode === 'v2') base.legacy = undefined;
        if (requestedMode === 'shadow') base.v2 = { ...base.v2 };
      } catch (error) {
        if (!preparationFailure) failures++;
        fallbackCount++;
        base.diagnostics.fallbackUsed = true;
        base.diagnostics.reason = String((error as Error)?.message || error);
      }
      nextItems.push(base);
    }

    const count = candidates.length;
    const coverage = {
      forecastCoverage: count ? forecastReady / count : 0,
      orderbookFreshCoverage: count ? orderbookFresh / count : 0,
      c5Coverage: count ? c5Ready / count : 0,
    };
    const complete = requestedMode === 'legacy' || (
      coverage.forecastCoverage >= this.forecastCoverageThreshold
      && coverage.orderbookFreshCoverage >= this.orderbookFreshCoverageThreshold
      && coverage.c5Coverage >= this.c5CoverageThreshold
    );
    const duration = Math.max(0, this.now() - startedAt);
    let diagnostics: ProductionOpportunitySnapshot['diagnostics'] = {
      inputKind: this.inputKind,
      ...coverage,
      failureCount: failures,
      stale,
      fallbackCount,
      lastRefreshDurationMs: duration,
      ...(complete ? {} : { reason: 'snapshot_completeness_below_threshold' }),
    };
    this.lastDiagnostics = diagnostics;
    if (!complete && this.currentSnapshot) return this.currentSnapshot;

    if (!complete) {
      const fallbackItems = nextItems.map((item) => ({
        ...item,
        mode: 'legacy' as const,
        v2: undefined,
        diagnostics: {
          ...item.diagnostics,
          fallbackUsed: true,
          reason: item.diagnostics.reason ?? 'snapshot_completeness_below_threshold',
        },
      }));
      diagnostics = {
        ...diagnostics,
        fallbackCount: Math.max(fallbackCount, count),
      };
      this.lastDiagnostics = diagnostics;
      const fallbackSnapshot: ProductionOpportunitySnapshot = {
        generatedAt: this.now(),
        mode: 'legacy',
        candidateCount: count,
        items: fallbackItems,
        diagnostics,
      };
      this.currentSnapshot = fallbackSnapshot;
      this.currentGeneratedAt = fallbackSnapshot.generatedAt;
      return fallbackSnapshot;
    }

    const snapshot: ProductionOpportunitySnapshot = {
      generatedAt: this.now(),
      mode: requestedMode,
      candidateCount: count,
      items: nextItems,
      diagnostics,
    };
    this.currentSnapshot = snapshot;
    this.currentGeneratedAt = snapshot.generatedAt;
    return snapshot;
  }

  private markCurrentStaleIfNeeded(): void {
    if (!this.currentSnapshot || this.now() - this.currentGeneratedAt <= this.snapshotStaleAfterMs) return;
    if (this.currentSnapshot.diagnostics.stale) return;
    this.currentSnapshot = {
      ...this.currentSnapshot,
      diagnostics: { ...this.currentSnapshot.diagnostics, stale: true },
    };
    this.lastDiagnostics = this.currentSnapshot.diagnostics;
  }
}

export function createProductionOpportunityOrchestrator(flags?: Partial<FeatureFlags>, config?: ProductionOrchestratorConfig): ProductionOpportunityOrchestrator {
  return new ProductionOpportunityOrchestrator(flags, config);
}
