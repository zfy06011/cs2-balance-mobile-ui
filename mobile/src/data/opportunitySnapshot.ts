/**
 * UI 唯一 Opportunity 数据入口。
 * 页面不再直接组合 Radar/Market 字段；这里把旧结果包装成 Production Snapshot，
 * v2 dev mode 使用明确标注的 synthetic fixture，绝不混入默认生产数据。
 */
import { engine } from '../core/engine';
import { STEAM_FEE_MODEL } from '../core/fees';
import type { DiscountResult } from '../core/discountV2';
import { DEFAULT_FEATURE_FLAGS, getRuntimeFeatureFlags, isDevRuntime, type OpportunityMode } from '../config/featureFlags';
import {
  ProductionOpportunityOrchestrator,
  type ProductionCandidate,
  type ProductionOpportunitySnapshot,
} from './opportunityProduction';
import { refreshProductionOpportunityFromLiveSources } from './opportunityLiveFeed';
import { isSeedTrackedCase } from './caseFilter';
import { storage } from './storage';
import { analysisGeneration } from '../core/analysisCache';
import type { Quote, RadarItem } from '../core/types';

interface SnapshotOptions {
  force?: boolean;
  mode?: OpportunityMode;
  candidateNames?: string[];
}

const orchestrators = new Map<string, ProductionOpportunityOrchestrator>();
const inflight = new Map<OpportunityMode, Promise<ProductionOpportunitySnapshot>>();
const PERSISTED_SNAPSHOT_KEY = 'opportunity_snapshot_v2';
const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

let canonicalSnapshot: { generation: number; snapshot: ProductionOpportunitySnapshot } | null = null;

function isReusableLiveSnapshot(snapshot: ProductionOpportunitySnapshot, now = Date.now()): boolean {
  return snapshot.mode === 'v2'
    && snapshot.diagnostics.inputKind === 'live'
    && snapshot.isDemo !== true
    && snapshot.diagnostics.failureCount === 0
    && snapshot.diagnostics.fallbackCount === 0
    && snapshot.diagnostics.stale === false
    && Number.isFinite(snapshot.generatedAt)
    && now - snapshot.generatedAt <= SNAPSHOT_TTL_MS;
}

function snapshotFromEnvelope(raw: string): ProductionOpportunitySnapshot | null {
  try {
    const parsed = JSON.parse(raw) as { schemaVersion?: number; generation?: number; snapshot?: ProductionOpportunitySnapshot };
    const snapshot = parsed?.snapshot;
    return parsed?.schemaVersion === 1 && typeof parsed.generation === 'number' && snapshot ? snapshot : null;
  } catch (cause) {
    if (cause instanceof SyntaxError) return null;
    throw cause;
  }
}

async function readPersistedSnapshot(mode: OpportunityMode): Promise<ProductionOpportunitySnapshot | null> {
  const raw = await storage.getKv(PERSISTED_SNAPSHOT_KEY);
  if (!raw) return null;
  const snapshot = snapshotFromEnvelope(raw);
  if (!snapshot || snapshot.mode !== mode || !isReusableLiveSnapshot(snapshot)) return null;
  const sync = await storage.getLocalSyncStatus();
  const lastRealtimeRefreshAt = sync.lastRealtimeRefreshAt ? Date.parse(sync.lastRealtimeRefreshAt) : NaN;
  if (Number.isFinite(lastRealtimeRefreshAt) && lastRealtimeRefreshAt > snapshot.generatedAt) return null;
  return snapshot;
}

async function persistSnapshot(snapshot: ProductionOpportunitySnapshot): Promise<void> {
  if (!isReusableLiveSnapshot(snapshot)) return;
  try {
    await storage.setKv(PERSISTED_SNAPSHOT_KEY, JSON.stringify({
      schemaVersion: 1,
      generation: analysisGeneration(),
      snapshot,
    }));
  } catch (cause) {
    if (cause instanceof Error) return;
    throw cause;
  }
}

function orchestratorFor(mode: OpportunityMode, inputKind: 'fixture' | 'synthetic' = 'fixture'): ProductionOpportunityOrchestrator {
  const key = `${mode}:${inputKind}`;
  let orchestrator = orchestrators.get(key);
  if (!orchestrator) {
    orchestrator = new ProductionOpportunityOrchestrator({ opportunityMode: mode }, { inputKind });
    orchestrators.set(key, orchestrator);
  }
  return orchestrator;
}

function quoteLegacy(quote: Quote | undefined, radar: RadarItem | undefined): ProductionCandidate['legacy'] {
  return {
    signal: radar?.signal ?? quote?.signal ?? 'waiting',
    score: radar?.score,
    expectedDiscount: radar?.expected_discount ?? quote?.expected_discount ?? undefined,
    expectedRoi: radar?.expected_roi,
    c5BuyPrice: quote?.c5_buy_price,
    steamSellPrice: quote?.steam_sell_price,
    steamNetReceive: quote?.steam_net_receive ?? radar?.steam_net_receive,
    netProfit: quote?.net_profit,
    riskLevel: radar?.risk_level,
    liquidity: radar?.liquidity,
    dataInsufficient: quote?.data_insufficient,
    steamVolume: quote?.steam_volume,
  };
}

async function legacyCandidates(): Promise<ProductionCandidate[]> {
  const [radarResult, marketsResult] = await Promise.allSettled([engine.radar(), engine.markets()]);
  const radar = radarResult.status === 'fulfilled' ? radarResult.value : [];
  const markets = marketsResult.status === 'fulfilled' ? marketsResult.value : [];
  const radarByName = new Map(radar.map((item) => [item.market_hash_name, item]));
  const quoteByName = new Map(markets.map((item) => [item.market_hash_name, item]));
  const names = [...new Set([...radar.map((item) => item.market_hash_name), ...markets.map((item) => item.market_hash_name)])]
    .filter(isSeedTrackedCase);
  return names.map((item) => ({
    item,
    legacy: quoteLegacy(quoteByName.get(item), radarByName.get(item)),
    prepared: {
      // Legacy engine does not expose v2 orderbook/forecast bundle; v2 is therefore
      // never silently inferred from these fields.
      forecastReady: radarByName.has(item),
      orderbookStatus: 'failed' as const,
      c5Ready: (quoteByName.get(item)?.c5_buy_price ?? null) != null,
      provenance: { discount: 'local_derived' },
    },
  }));
}

function demoDiscount(item: string, expected: number, conservative: number, current: number, capacity: number, stale = false): DiscountResult {
  return {
    item,
    quantity: 10,
    current: {
      grossPerUnit: 10,
      netPerUnit: 10,
      totalNet: 100,
      discount: current,
      filledQuantity: 10,
      requestedQuantity: 10,
      liquidationCoverage: 1,
      filledGross: 115,
      filledNet: 100,
      filledDiscount: current,
      fullPositionDiscount: current,
    },
    conservative7d: { grossPerUnit: 10, netPerUnit: 10, totalNet: 100, discount: conservative },
    expected7d: { grossPerUnit: 10, netPerUnit: 10, totalNet: 100, discount: expected },
    listing7d: { grossPerUnit: 10, netPerUnit: 10, totalNet: 100, discount: Math.max(0.70, expected - 0.04) },
    futureModel: {
      orderbookPredicted: false,
      liquidityGuaranteed: false,
      usesCurrentBuySellRatio: true,
      currentBuySellRatio: 0.86,
      ratioKind: 'current_market_heuristic',
    },
    liquidity: {
      spread: 0.10,
      spreadPct: 0.01,
      currentVwap: 10,
      slippagePct: 0.01,
      executableQuantity: capacity / 10,
      executableBudget: capacity,
      filledQuantity: 10,
      unfilledQuantity: 0,
    },
    currentLiquidityCapacity: {
      scope: 'current_market_structure',
      executableQuantity: capacity / 10,
      executableBudget: capacity,
    },
    marketDataQuality: { score: 0.95, stale, reasons: stale ? ['steam_stale'] : [] },
    forecastQuality: { available: true, score: 0.88, reasons: [] },
    feeModel: STEAM_FEE_MODEL,
    quality: {
      score: 0.92,
      stale,
      reasons: stale ? ['steam_stale'] : [],
      marketData: { score: 0.95, stale, reasons: stale ? ['steam_stale'] : [] },
      forecast: { available: true, score: 0.88, reasons: [] },
      overall: 0.92,
    },
    warnings: ['future_orderbook_not_predicted', 'future_liquidity_not_guaranteed'],
  };
}

function demoCandidates(): ProductionCandidate[] {
  const fixtures = [
    { item: 'Fever Case', expected: 0.78, conservative: 0.82, current: 0.80, capacity: 600, signal: 'buy' },
    { item: 'Kilowatt Case', expected: 0.86, conservative: 0.89, current: 0.87, capacity: 260, signal: 'wait' },
    { item: 'Gallery Case', expected: 0.92, conservative: 0.95, current: 0.93, capacity: 120, signal: 'wait' },
    { item: 'Revolution Case', expected: 1.04, conservative: 1.08, current: 1.05, capacity: 30, signal: 'avoid' },
    { item: 'Glove Case', expected: 0.84, conservative: 0.88, current: 0.85, capacity: 400, signal: 'wait' },
  ];
  return fixtures.map((fixture) => ({
    item: fixture.item,
    legacy: { signal: fixture.signal, score: 50, expectedDiscount: fixture.expected, c5BuyPrice: 10, steamSellPrice: 12, steamNetReceive: 10.4 },
    opportunityInput: {
      item: fixture.item,
      discount: demoDiscount(fixture.item, fixture.expected, fixture.conservative, fixture.current, fixture.capacity),
      market: { volume24h: 5000, c5AvailableQuantity: 500, highestBuy: 10, lowestSell: 10.1 },
      risk: { marketState: 'STABLE', cv: 0.02 },
      forecast: { confidence: 0.88, direction: 'UP' },
      feeModel: { kind: 'approximate', exact: false },
      evaluationBudget: fixture.capacity,
    },
    prepared: {
      forecastReady: true,
      orderbookStatus: 'live',
      c5Ready: true,
      sourceTimestamp: Date.now(),
      provenance: { forecast: 'local_derived', orderbook: 'steam_first_party_web', c5: 'c5_openapi', discount: 'local_derived' },
    },
  }));
}

async function buildSnapshot(mode: OpportunityMode, force = false, candidateNames?: string[]): Promise<ProductionOpportunitySnapshot> {
  const demoEnabled = typeof globalThis !== 'undefined'
    && (globalThis as typeof globalThis & { __YU_E_OPPORTUNITY_DEMO__?: boolean }).__YU_E_OPPORTUNITY_DEMO__ === true;
  if (mode !== 'legacy' && isDevRuntime() && demoEnabled) {
    const snapshot = await orchestratorFor(mode, 'synthetic').refresh(demoCandidates(), force);
    return { ...snapshot, isDemo: true };
  }
  if (mode !== 'legacy' && force) {
    const previous = canonicalSnapshot?.snapshot ?? await readPersistedSnapshot(mode);
    const snapshot = await refreshProductionOpportunityFromLiveSources({ mode, force, candidateNames });
    if (!isReusableLiveSnapshot(snapshot) && previous) {
      const fallbackSnapshot: ProductionOpportunitySnapshot = {
        ...previous,
        diagnostics: {
          ...previous.diagnostics,
          stale: true,
          reason: 'live_refresh_incomplete',
          fallbackCount: Math.max(1, previous.diagnostics.fallbackCount),
        },
      };
      canonicalSnapshot = { generation: analysisGeneration(), snapshot: fallbackSnapshot };
      return fallbackSnapshot;
    }
    if (isReusableLiveSnapshot(snapshot)) canonicalSnapshot = { generation: analysisGeneration(), snapshot };
    await persistSnapshot(snapshot);
    return snapshot;
  }
  if (mode !== 'legacy') {
    if (canonicalSnapshot?.generation === analysisGeneration()
      && canonicalSnapshot.snapshot.mode === mode
      && isReusableLiveSnapshot(canonicalSnapshot.snapshot)) {
      return canonicalSnapshot.snapshot;
    }
    const persisted = await readPersistedSnapshot(mode);
    if (persisted) {
      canonicalSnapshot = { generation: analysisGeneration(), snapshot: persisted };
      return persisted;
    }
  }
  const candidates = await legacyCandidates();
  const snapshot = await orchestratorFor(mode, 'fixture').refresh(candidates, force);
  return snapshot;
}

export async function getProductionOpportunitySnapshot(options: SnapshotOptions = {}): Promise<ProductionOpportunitySnapshot> {
  const mode = options.mode ?? getRuntimeFeatureFlags().opportunityMode;
  const existing = inflight.get(mode);
  if (existing && !options.force) return existing;
  const promise = buildSnapshot(mode, options.force === true, options.candidateNames).finally(() => { inflight.delete(mode); });
  inflight.set(mode, promise);
  return promise;
}

export function clearProductionOpportunitySnapshotCache(): void {
  inflight.clear();
  orchestrators.clear();
  canonicalSnapshot = null;
}

export function peekProductionOpportunitySnapshot(mode = getRuntimeFeatureFlags().opportunityMode): ProductionOpportunitySnapshot | null {
  if (canonicalSnapshot?.generation !== analysisGeneration()) return null;
  if (canonicalSnapshot.snapshot.mode !== mode) return null;
  if (!isReusableLiveSnapshot(canonicalSnapshot.snapshot)) return null;
  return canonicalSnapshot.snapshot;
}

export const DEFAULT_UI_OPPORTUNITY_MODE = DEFAULT_FEATURE_FLAGS.opportunityMode;
