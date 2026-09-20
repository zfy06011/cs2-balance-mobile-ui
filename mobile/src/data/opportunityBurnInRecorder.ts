import type { ProductionOpportunitySnapshot } from './opportunityProduction';
import { storage } from './storage';
import type { LiveFeedDiagnostics } from './opportunityLiveFeed';

export const OPPORTUNITY_BURNIN_KV_KEY = 'dev:opportunity-burnin:v1';

export interface OpportunityBurnInRecord {
  roundId: string;
  startedAt: number;
  completedAt: number;
  inputKind: 'live';
  universeVersion: string;
  candidateCount: number;
  candidateHash?: string;
  forecast: { ready: number; missing: number; coverage: number };
  orderbook: {
    live: number;
    cacheFresh: number;
    cacheStale: number;
    failed: number;
    freshCoverage: number;
    usableCoverage: number;
    liveAttempts: number;
    retries: number;
    http429: number;
    timeout: number;
    circuitOpens: number;
  };
  c5: { ready: number; failed: number; coverage: number };
  decisions: {
    excellent: number;
    buy: number;
    watch: number;
    avoid: number;
    fallbackLegacy: number;
    missing: number;
  };
  accounting: { accountedItems: number; unaccountedItems: number };
  snapshot: { valid: boolean; stale: boolean; fallbackUsed: boolean };
  highRiskViolationCount: number;
  refreshDurationMs: number;
}

function roundId(now: number): string {
  return `live-${now}-${Math.random().toString(36).slice(2, 8)}`;
}

function decisionCount(snapshot: ProductionOpportunitySnapshot): OpportunityBurnInRecord['decisions'] {
  const decisions = { excellent: 0, buy: 0, watch: 0, avoid: 0, fallbackLegacy: 0, missing: 0 };
  for (const item of snapshot.items) {
    if (item.v2?.decision) decisions[item.v2.decision]++;
    else if (item.legacy) decisions.fallbackLegacy++;
    else decisions.missing++;
  }
  return decisions;
}

function highRiskViolationCount(snapshot: ProductionOpportunitySnapshot): number {
  let violations = 0;
  for (const item of snapshot.items) {
    const result = item.v2;
    if (!result) continue;
    if (['buy', 'excellent'].includes(result.decision)) {
      if ((result.expectedDiscount ?? 0) >= 1 || (result.executableBudget ?? 0) < 20 || result.marketState === 'CHAOS'
        || item.diagnostics.stale || result.marketDataQuality < 0.60
        || result.caps.includes('approximate_fee_low_price_cap_watch')
        || result.warnings.includes('forecast_missing')
        || item.diagnostics.orderbookStatus === 'failed') violations++;
    }
  }
  return violations;
}

export function buildOpportunityBurnInRecord(snapshot: ProductionOpportunitySnapshot, preparedAt = Date.now(), feed?: LiveFeedDiagnostics | null): OpportunityBurnInRecord {
  const items = snapshot.items;
  const uniqueItems = new Set(items.map((item) => item.item));
  const forecastReady = items.filter((item) => item.diagnostics.forecastStatus === 'ready').length;
  const live = items.filter((item) => item.diagnostics.orderbookStatus === 'live').length;
  const cacheFresh = items.filter((item) => item.diagnostics.orderbookStatus === 'cache_fresh').length;
  const cacheStale = items.filter((item) => item.diagnostics.orderbookStatus === 'cache_stale').length;
  const failed = items.filter((item) => item.diagnostics.orderbookStatus === 'failed').length;
  const c5Ready = items.filter((item) => item.diagnostics.c5Status === 'ready').length;
  const count = snapshot.candidateCount;
  const usable = live + cacheFresh + cacheStale;
  const decisions = decisionCount(snapshot);
  const inputKind = snapshot.diagnostics.inputKind;
  const valid = inputKind === 'live'
    && uniqueItems.size === count
    && snapshot.diagnostics.forecastCoverage >= 0.90
    && snapshot.diagnostics.orderbookFreshCoverage >= 0.95
    && snapshot.diagnostics.c5Coverage >= 0.95
    && highRiskViolationCount(snapshot) === 0;
  return {
    roundId: roundId(preparedAt),
    startedAt: Math.max(0, preparedAt - snapshot.diagnostics.lastRefreshDurationMs),
    completedAt: preparedAt,
    inputKind: 'live',
    universeVersion: feed?.universeVersion ?? 'unknown',
    candidateCount: count,
    candidateHash: feed?.candidateHash,
    forecast: { ready: forecastReady, missing: Math.max(0, count - forecastReady), coverage: snapshot.diagnostics.forecastCoverage },
    orderbook: {
      live,
      cacheFresh,
      cacheStale,
      failed,
      freshCoverage: snapshot.diagnostics.orderbookFreshCoverage,
      usableCoverage: count ? usable / count : 0,
      liveAttempts: feed?.steamLiveAttempts ?? 0,
      retries: feed?.steamRetries ?? 0,
      http429: feed?.steam429 ?? 0,
      timeout: feed?.steamTimeout ?? 0,
      circuitOpens: feed?.steamCircuitOpens ?? 0,
    },
    c5: { ready: c5Ready, failed: Math.max(0, count - c5Ready), coverage: snapshot.diagnostics.c5Coverage },
    decisions,
    accounting: { accountedItems: uniqueItems.size, unaccountedItems: Math.max(0, count - uniqueItems.size) },
    snapshot: {
      valid,
      stale: snapshot.diagnostics.stale,
      fallbackUsed: snapshot.diagnostics.fallbackCount > 0 || decisions.fallbackLegacy > 0,
    },
    highRiskViolationCount: highRiskViolationCount(snapshot),
    refreshDurationMs: snapshot.diagnostics.lastRefreshDurationMs,
  };
}

export async function recordOpportunityBurnIn(snapshot: ProductionOpportunitySnapshot, feed?: LiveFeedDiagnostics | null): Promise<OpportunityBurnInRecord> {
  const record = buildOpportunityBurnInRecord(snapshot, Date.now(), feed);
  const raw = await storage.getKv(OPPORTUNITY_BURNIN_KV_KEY).catch(() => null);
  let records: OpportunityBurnInRecord[] = [];
  try { records = raw ? JSON.parse(raw) : []; } catch { records = []; }
  records = [...records.filter((item) => item.roundId !== record.roundId), record].slice(-30);
  await storage.setKv(OPPORTUNITY_BURNIN_KV_KEY, JSON.stringify(records));
  return record;
}

export async function readOpportunityBurnInRecords(): Promise<OpportunityBurnInRecord[]> {
  const raw = await storage.getKv(OPPORTUNITY_BURNIN_KV_KEY).catch(() => null);
  if (!raw) return [];
  try {
    const records = JSON.parse(raw);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}
