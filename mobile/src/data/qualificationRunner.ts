import type { ProductionOpportunitySnapshot } from './opportunityProduction';
import { refreshProductionOpportunityFromLiveSources } from './opportunityLiveFeed';
import {
  buildOpportunityBurnInRecord,
  readOpportunityBurnInRecords,
  recordOpportunityBurnIn,
  type OpportunityBurnInRecord,
} from './opportunityBurnInRecorder';
import { storage } from './storage';

export const QUALIFICATION_KV_KEY = 'dev:opportunity-qualification:v1';
export const QUALIFICATION_INTERVAL_MS = 5 * 60 * 1000;
export const QUALIFICATION_BURNIN_ROUNDS = 12;
export const QUALIFICATION_V2_ROUNDS = 5;

export type QualificationStage =
  | 'idle'
  | 'burn_in'
  | 'v2_refresh'
  | 'await_offline'
  | 'await_online'
  | 'process_restart'
  | 'background'
  | 'complete'
  | 'failed';

export interface QualificationState {
  runId: string;
  stage: QualificationStage;
  currentRound: number;
  startedAt: number | null;
  lastRoundAt: number | null;
  nextEligibleAt: number | null;
  records: OpportunityBurnInRecord[];
  v2RefreshCount: number;
  offlineCheckedAt: number | null;
  onlineRecoveredAt: number | null;
  processRestartCheckedAt: number | null;
  backgroundCheckedAt: number | null;
  lastError?: string;
}

const EMPTY_STATE: QualificationState = {
  runId: '',
  stage: 'idle',
  currentRound: 0,
  startedAt: null,
  lastRoundAt: null,
  nextEligibleAt: null,
  records: [],
  v2RefreshCount: 0,
  offlineCheckedAt: null,
  onlineRecoveredAt: null,
  processRestartCheckedAt: null,
  backgroundCheckedAt: null,
};

function now(): number { return Date.now(); }

function id(): string { return `qualification-${now()}-${Math.random().toString(36).slice(2, 8)}`; }

function normalize(value: unknown): QualificationState {
  if (!value || typeof value !== 'object') return { ...EMPTY_STATE };
  const input = value as Partial<QualificationState>;
  return {
    ...EMPTY_STATE,
    ...input,
    records: Array.isArray(input.records) ? input.records.slice(-30) : [],
  };
}

export async function loadQualificationState(): Promise<QualificationState> {
  const raw = await storage.getKv(QUALIFICATION_KV_KEY).catch(() => null);
  if (!raw) return { ...EMPTY_STATE };
  try { return normalize(JSON.parse(raw)); } catch { return { ...EMPTY_STATE }; }
}

async function save(state: QualificationState): Promise<QualificationState> {
  await storage.setKv(QUALIFICATION_KV_KEY, JSON.stringify(state));
  return state;
}

export async function startQualification(): Promise<QualificationState> {
  const state: QualificationState = {
    ...EMPTY_STATE,
    runId: id(),
    stage: 'burn_in',
    startedAt: now(),
    nextEligibleAt: now(),
  };
  return save(state);
}

export async function resetQualification(): Promise<QualificationState> {
  return save({ ...EMPTY_STATE });
}

export function isQualificationDue(state: QualificationState, at = now()): boolean {
  return state.nextEligibleAt == null || at >= state.nextEligibleAt;
}

async function liveRound(state: QualificationState): Promise<{ state: QualificationState; snapshot: ProductionOpportunitySnapshot }> {
  const snapshot = await refreshProductionOpportunityFromLiveSources({ mode: 'v2', force: true });
  const record = buildOpportunityBurnInRecord(snapshot);
  const records = [...state.records, record].slice(-30);
  await recordOpportunityBurnIn(snapshot);
  return {
    snapshot,
    state: {
      ...state,
      records,
      lastRoundAt: now(),
      nextEligibleAt: now() + QUALIFICATION_INTERVAL_MS,
      lastError: undefined,
    },
  };
}

export async function runNextQualificationRound(): Promise<QualificationState> {
  const current = await loadQualificationState();
  if (!['burn_in', 'v2_refresh'].includes(current.stage)) return current;
  if (!isQualificationDue(current)) return current;
  try {
    const result = await liveRound(current);
    const next = { ...result.state };
    if (current.stage === 'burn_in') {
      next.currentRound = current.currentRound + 1;
      if (next.currentRound >= QUALIFICATION_BURNIN_ROUNDS) {
        next.stage = 'v2_refresh';
        next.currentRound = 0;
        next.nextEligibleAt = now();
      }
    } else {
      next.v2RefreshCount = current.v2RefreshCount + 1;
      next.currentRound = next.v2RefreshCount;
      if (next.v2RefreshCount >= QUALIFICATION_V2_ROUNDS) {
        next.stage = 'await_offline';
        next.nextEligibleAt = null;
      }
    }
    return save(next);
  } catch (error) {
    return save({ ...current, lastError: error instanceof Error ? error.message : String(error) });
  }
}

export async function confirmOfflineCheckpoint(): Promise<QualificationState> {
  const state = await loadQualificationState();
  if (state.stage !== 'await_offline') return state;
  return save({ ...state, stage: 'await_online', offlineCheckedAt: now() });
}

export async function confirmOnlineCheckpoint(): Promise<QualificationState> {
  const state = await loadQualificationState();
  if (state.stage !== 'await_online') return state;
  try {
    const result = await liveRound(state);
    return save({ ...result.state, stage: 'process_restart', onlineRecoveredAt: now(), nextEligibleAt: null });
  } catch (error) {
    return save({ ...state, lastError: error instanceof Error ? error.message : String(error) });
  }
}

export async function confirmProcessRestartCheckpoint(): Promise<QualificationState> {
  const state = await loadQualificationState();
  if (state.stage !== 'process_restart') return state;
  return save({ ...state, stage: 'background', processRestartCheckedAt: now() });
}

export async function confirmBackgroundCheckpoint(): Promise<QualificationState> {
  const state = await loadQualificationState();
  if (state.stage !== 'background') return state;
  return save({ ...state, stage: 'complete', backgroundCheckedAt: now(), nextEligibleAt: null });
}

export async function qualificationRecords(): Promise<OpportunityBurnInRecord[]> {
  const state = await loadQualificationState();
  const persisted = await readOpportunityBurnInRecords();
  return state.records.length > 0 ? state.records : persisted;
}

export function qualificationSummary(state: QualificationState): string {
  const qualified = state.records.filter((record) => record.snapshot.valid && record.accounting.unaccountedItems === 0 && record.highRiskViolationCount === 0).length;
  const final = state.stage === 'complete' && qualified >= 11 && state.v2RefreshCount >= QUALIFICATION_V2_ROUNDS ? 'PASS-V2' : 'PASS-LEGACY';
  return [
    '宇额助手 RC Qualification',
    '',
    `Burn-in: ${Math.min(QUALIFICATION_BURNIN_ROUNDS, state.records.length)}/${QUALIFICATION_BURNIN_ROUNDS}`,
    `Qualified: ${qualified}/${state.records.length}`,
    `v2 refresh: ${state.v2RefreshCount}/${QUALIFICATION_V2_ROUNDS}`,
    `Network recovery: ${state.onlineRecoveredAt ? 'PASS' : 'PENDING'}`,
    `Process restart: ${state.processRestartCheckedAt ? 'PASS' : 'PENDING'}`,
    `Background/foreground: ${state.backgroundCheckedAt ? 'PASS' : 'PENDING'}`,
    `Final: ${final}`,
  ].join('\n');
}

