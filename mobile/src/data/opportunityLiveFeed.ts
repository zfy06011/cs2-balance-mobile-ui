/**
 * 3C-3 RN live feed：真实候选 -> Forecast -> Steam orderbook -> C5 -> Discount v2。
 * 只依赖 React Native 可用的 fetch、SQLite storage、provider、runtime cache/limiter；
 * 不导入 scripts/artifacts/fs/path/child_process。
 */
import { engine } from '../core/engine';
import { DEFAULT_FEES, STEAM_FEE_MODEL } from '../core/fees';
import { buildDiscountV2, type DiscountResult } from '../core/discountV2';
import { SteamOrderbookProvider, type SteamOrderbook } from '../providers/steam/steamOrderbook';
import { fetchC5PricesBulk, fetchC5StatsBulk, type C5StatsResult } from './c5';
import { storage } from './storage';
import { isTrackedCase } from './caseFilter';
import { OrderbookRuntimeCache } from './orderbookRuntimeCache';
import { OrderbookRuntimeLimiter } from './orderbookRuntimeLimiter';
import { getRuntimeFeatureFlags, type OpportunityMode } from '../config/featureFlags';
import {
  ProductionOpportunityOrchestrator,
  type ProductionCandidate,
  type ProductionOpportunitySnapshot,
} from './opportunityProduction';
import { recordOpportunityBurnIn } from './opportunityBurnInRecorder';
import type { OpportunityInput } from '../core/types/opportunity';

export interface LiveOpportunityPrepareOptions {
  maxCandidates?: number;
  candidateNames?: string[];
  forceLive?: boolean;
}

export interface LiveFeedDiagnostics {
  candidateCount: number;
  universeVersion: string;
  candidateHash: string;
  forecastReady: number;
  orderbookLive: number;
  orderbookFreshHits: number;
  orderbookStaleFallbacks: number;
  orderbookFailed: number;
  c5Ready: number;
  c5Failures: number;
  steamLiveAttempts: number;
  steamRetries: number;
  steam429: number;
  steamTimeout: number;
  steamCircuitOpens: number;
  lastPreparedAt: number;
}

const UNIVERSE_VERSION = 'tracked-cases-v1';
const DEFAULT_MAX_CANDIDATES = 93;
const orderbookCache = new OrderbookRuntimeCache<SteamOrderbook>({
  freshTtlMs: 2 * 60 * 1000,
  staleTtlMs: 10 * 60 * 1000,
  schemaVersion: 'orderbook:v1',
});
const orderbookLimiter = new OrderbookRuntimeLimiter({
  maxConcurrency: 2,
  minIntervalMs: 1_200,
  maxRetries: 2,
  circuitFailureThreshold: 5,
  circuitCooldownMs: 30_000,
});
const orderbookProvider = new SteamOrderbookProvider({
  timeoutMs: 10_000,
  retries: 0,
  minRequestIntervalMs: 0,
});

let lastDiagnostics: LiveFeedDiagnostics | null = null;
const liveOrchestrators = new Map<OpportunityMode, ProductionOpportunityOrchestrator>();

function finite(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function timestampOf(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hashOf(names: string[]): string {
  let hash = 2166136261;
  for (const name of names) {
    for (let index = 0; index < name.length; index++) {
      hash ^= name.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 10;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function riskOf(prediction: Awaited<ReturnType<typeof engine.prediction>>): OpportunityInput['risk'] {
  const features = prediction.features ?? {};
  const state = typeof features.market_state === 'string' ? features.market_state : 'UNKNOWN';
  return {
    marketState: state,
    cv: finite(features.cv),
    r2: finite(features.r2),
    volatility30d: finite(features.volatility),
    volatility365d: finite(features.volatility_365d),
  };
}

function directionOf(prediction: Awaited<ReturnType<typeof engine.prediction>>): string {
  const current = finite(prediction.features?.current_price);
  if (current == null || prediction.p50 <= current * 0.995) return 'DOWN';
  if (prediction.p50 >= current * 1.005) return 'UP';
  return 'FLAT';
}

function legacyOf(quote: Awaited<ReturnType<typeof engine.quote>>, radar: { signal?: string; score?: number } | undefined): ProductionCandidate['legacy'] {
  return {
    signal: radar?.signal ?? quote.signal,
    score: radar?.score,
    expectedDiscount: quote.expected_discount ?? undefined,
    expectedRoi: quote.roi,
    c5BuyPrice: quote.c5_buy_price,
    steamSellPrice: quote.steam_sell_price,
    steamNetReceive: quote.steam_net_receive,
    netProfit: quote.net_profit,
    dataInsufficient: quote.data_insufficient,
    steamVolume: quote.steam_volume,
  };
}

async function candidateNames(options: LiveOpportunityPrepareOptions): Promise<string[]> {
  const raw = options.candidateNames ?? await storage.getSnapshotNames();
  const names = [...new Set(raw.filter(isTrackedCase))].sort((a, b) => a.localeCompare(b));
  return names.slice(0, Math.max(1, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES));
}

interface OrderbookRead {
  value?: SteamOrderbook;
  status: 'live' | 'cache_fresh' | 'cache_stale' | 'failed';
  sourceTimestamp?: number;
}

async function readOrderbook(name: string, diagnostics: LiveFeedDiagnostics): Promise<OrderbookRead> {
  const key = `orderbook:v1:${name}`;
  const cached = orderbookCache.get(key);
  if (cached.status === 'fresh' && cached.value) {
    diagnostics.orderbookFreshHits++;
    return { value: cached.value, status: 'cache_fresh', sourceTimestamp: cached.fetchedAt };
  }
  try {
    diagnostics.steamLiveAttempts++;
    const value = await orderbookLimiter.run(name, () => orderbookProvider.getOrderbook(name));
    orderbookCache.set(key, value, value.fetchedAt);
    diagnostics.orderbookLive++;
    return { value, status: 'live', sourceTimestamp: value.fetchedAt };
  } catch (error) {
    const code = String((error as { code?: unknown } | undefined)?.code ?? '');
    if (code === 'timeout') diagnostics.steamTimeout++;
    if (Number((error as { status?: unknown } | undefined)?.status) === 429) diagnostics.steam429++;
    const stale = orderbookCache.get(key);
    if (stale.status === 'stale' && stale.value) {
      diagnostics.orderbookStaleFallbacks++;
      return { value: stale.value, status: 'cache_stale', sourceTimestamp: stale.fetchedAt };
    }
    diagnostics.orderbookFailed++;
    return { status: 'failed' };
  }
}

async function buildCandidate(
  name: string,
  c5Prices: Record<string, number | null>,
  c5Stats: Record<string, C5StatsResult | null>,
  radarByName: Map<string, { signal?: string; score?: number }>,
  diagnostics: LiveFeedDiagnostics,
): Promise<ProductionCandidate> {
  const quote = await engine.quote(name).catch(() => null);
  const preparedBase = {
    forecastReady: false,
    orderbookStatus: 'failed' as const,
    c5Ready: false,
    provenance: { forecast: 'local_derived', orderbook: 'steam_first_party_web', c5: 'c5_openapi', discount: 'local_derived' },
  };
  if (!quote) return { item: name, legacy: { signal: 'waiting' }, prepared: preparedBase };

  const [prediction, orderbook] = await Promise.all([
    engine.prediction(name).catch(() => null),
    readOrderbook(name, diagnostics),
  ]);
  const storedC5 = await storage.getLatestC5(name).catch(() => null);
  const freshC5Price = c5Prices[name];
  const hasFreshC5 = freshC5Price != null && freshC5Price > 0;
  const c5Price = hasFreshC5 ? freshC5Price : storedC5?.price ?? null;
  const c5FetchedAt = hasFreshC5 ? Date.now() : timestampOf(storedC5?.fetchedAt);
  const c5Source = hasFreshC5 ? 'c5_openapi' : storedC5 ? 'local_cache' : undefined;
  const c5Stat = c5Stats[name] ?? null;
  const forecastReady = prediction != null && [prediction.p25, prediction.p50, prediction.p75].every((value) => Number.isFinite(value));
  const c5Ready = c5Price != null && c5Price > 0;
  if (forecastReady) diagnostics.forecastReady++;
  if (c5Ready) diagnostics.c5Ready++;
  else diagnostics.c5Failures++;
  const legacy = legacyOf(quote, radarByName.get(name));
  const prepared = {
    forecastReady,
    orderbookStatus: orderbook.status,
    c5Ready,
    sourceTimestamp: Math.max(
      c5FetchedAt ?? 0,
      orderbook.sourceTimestamp ?? 0,
    ) || undefined,
    orderbookFetchedAt: orderbook.sourceTimestamp,
    c5FetchedAt,
    c5BuyPrice: c5Price ?? undefined,
    provenance: {
      forecast: prediction ? 'local_derived' : undefined,
      orderbook: 'steam_first_party_web',
      c5: c5Source,
      discount: 'local_derived',
    },
  } as ProductionCandidate['prepared'];
  if (!prediction || !orderbook.value || !c5Ready) return { item: name, legacy, prepared };

  const fetchedAt = c5FetchedAt ?? Date.now();
  const discount: DiscountResult = buildDiscountV2({
    item: name,
    c5: {
      unitPrice: c5Price,
      feeRatio: DEFAULT_FEES.c5_buy_fee_ratio,
      availableQuantity: c5Stat?.sellCount ?? undefined,
      fetchedAt,
    },
    steam: {
      highestBuy: orderbook.value.highestBuy,
      lowestSell: orderbook.value.lowestSell,
      buyLevels: orderbook.value.buyLevels,
      sellLevels: orderbook.value.sellLevels,
      fetchedAt: orderbook.value.fetchedAt,
      currency: 'CNY',
      currencyId: 23,
      quality: 1,
    },
    forecast: {
      p25: prediction.p25,
      p50: prediction.p50,
      p75: prediction.p75,
      confidence: prediction.confidence,
      marketState: String(prediction.features?.market_state ?? 'UNKNOWN'),
    },
    quantity: 1,
    now: Date.now(),
  });
  const opportunityInput: OpportunityInput = {
    item: name,
    discount,
    market: {
      volume24h: quote.steam_volume ?? undefined,
      c5AvailableQuantity: c5Stat?.sellCount ?? undefined,
      highestBuy: orderbook.value.highestBuy,
      lowestSell: orderbook.value.lowestSell,
    },
    risk: riskOf(prediction),
    forecast: { confidence: prediction.confidence, direction: directionOf(prediction) },
    feeModel: STEAM_FEE_MODEL,
  };
  return { item: name, legacy, opportunityInput, prepared };
}

export async function prepareLiveOpportunityCandidates(options: LiveOpportunityPrepareOptions = {}): Promise<ProductionCandidate[]> {
  const names = await candidateNames(options);
  const diagnostics: LiveFeedDiagnostics = {
    candidateCount: names.length,
    universeVersion: UNIVERSE_VERSION,
    candidateHash: hashOf(names),
    forecastReady: 0,
    orderbookLive: 0,
    orderbookFreshHits: 0,
    orderbookStaleFallbacks: 0,
    orderbookFailed: 0,
    c5Ready: 0,
    c5Failures: 0,
    steamLiveAttempts: 0,
    steamRetries: 0,
    steam429: 0,
    steamTimeout: 0,
    steamCircuitOpens: 0,
    lastPreparedAt: Date.now(),
  };
  const settings = await storage.getSettings();
  const [c5Prices, c5Stats, radar] = await Promise.all([
    settings.c5AppKey.trim() ? fetchC5PricesBulk(names, settings.c5AppKey) : Promise.resolve({} as Record<string, number | null>),
    settings.c5AppKey.trim() ? fetchC5StatsBulk(names, settings.c5AppKey) : Promise.resolve({} as Record<string, C5StatsResult | null>),
    engine.radar().catch(() => []),
  ]);
  const radarByName = new Map(radar.map((item) => [item.market_hash_name, { signal: item.signal, score: item.score }]));
  const candidates = new Array<ProductionCandidate>(names.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(2, names.length) }, async () => {
    while (cursor < names.length) {
      const index = cursor++;
      candidates[index] = await buildCandidate(names[index], c5Prices, c5Stats, radarByName, diagnostics);
    }
  });
  await Promise.all(workers);
  const limiterDiagnostics = orderbookLimiter.diagnostics();
  lastDiagnostics = {
    ...diagnostics,
    steamRetries: limiterDiagnostics.retryCount,
    steamCircuitOpens: limiterDiagnostics.circuitState === 'OPEN' ? 1 : 0,
    lastPreparedAt: Date.now(),
  };
  return candidates;
}

export function getLiveFeedDiagnostics(): LiveFeedDiagnostics | null {
  return lastDiagnostics ? { ...lastDiagnostics } : null;
}

function liveOrchestratorFor(mode: OpportunityMode): ProductionOpportunityOrchestrator {
  let orchestrator = liveOrchestrators.get(mode);
  if (!orchestrator) {
    orchestrator = new ProductionOpportunityOrchestrator({ opportunityMode: mode }, { inputKind: 'live' });
    liveOrchestrators.set(mode, orchestrator);
  }
  return orchestrator;
}

export async function refreshProductionOpportunityFromLiveSources(options: LiveOpportunityPrepareOptions & { mode?: OpportunityMode; force?: boolean } = {}): Promise<ProductionOpportunitySnapshot> {
  const mode = options.mode ?? getRuntimeFeatureFlags().opportunityMode;
  const candidates = await prepareLiveOpportunityCandidates(options);
  const snapshot = await liveOrchestratorFor(mode).refresh(candidates, options.force === true);
  await recordOpportunityBurnIn(snapshot, lastDiagnostics).catch(() => undefined);
  return snapshot;
}
