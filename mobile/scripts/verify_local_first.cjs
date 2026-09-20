const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(os.tmpdir(), 'yu-e-verify-local-first');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--ignoreConfig', '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--outDir', outDir,
  path.join(root, 'src', 'data', 'opportunitySnapshot.ts'),
  path.join(root, 'src', 'ui', 'opportunity', 'useOpportunitySnapshot.ts'),
], { cwd: root, stdio: 'pipe' });

let liveCalls = 0;
let refreshOptions = null;
let liveInputKind = 'live';
let liveIncomplete = false;
let localRealtimeRefreshAt;
const persisted = new Map();
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request.includes('core/engine')) {
    return { engine: { radar: async () => [], markets: async () => [] } };
  }
  if (request.includes('config/featureFlags')) {
    return {
      DEFAULT_FEATURE_FLAGS: { opportunityMode: 'v2' },
      getRuntimeFeatureFlags: () => ({ opportunityMode: 'v2' }),
      isDevRuntime: () => false,
    };
  }
  if (request.includes('core/fees')) return { STEAM_FEE_MODEL: { kind: 'exact' } };
  if (request.includes('opportunityProduction')) {
    return {
      ProductionOpportunityOrchestrator: class {
        async refresh() { return { mode: 'legacy', candidateCount: 0, items: [], diagnostics: {} }; }
      },
    };
  }
  if (request.includes('opportunityLiveFeed')) {
    return {
      refreshProductionOpportunityFromLiveSources: async () => {
        liveCalls += 1;
        return {
          generatedAt: Date.now(),
          mode: 'v2',
          candidateCount: 0,
          items: [],
          diagnostics: { inputKind: liveInputKind, forecastCoverage: liveIncomplete ? 0.5 : 1, orderbookFreshCoverage: 1, c5Coverage: 1, failureCount: liveIncomplete ? 1 : 0, stale: false, fallbackCount: 0, lastRefreshDurationMs: 1 },
        };
      },
    };
  }
  if (request.includes('data/storage') || request === './storage') {
    return {
      storage: {
        getKv: async (key) => persisted.get(key) ?? null,
        setKv: async (key, value) => { persisted.set(key, value); },
        getLocalSyncStatus: async () => ({ lastRealtimeRefreshAt: localRealtimeRefreshAt }),
        getSnapshotNames: async () => [],
      },
    };
  }
  if (request === 'react') {
    return {
      useCallback: (fn) => fn,
      useEffect: () => undefined,
      useState: (initial) => [initial, () => undefined],
    };
  }
  if (request.includes('api/client')) {
    return { api: { productionOpportunity: async (options) => { refreshOptions = options; return {}; } } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const snapshot = require(path.join(outDir, 'data', 'opportunitySnapshot.js'));

async function run() {
  const initial = await snapshot.getProductionOpportunitySnapshot();
  if (liveCalls !== 0 || initial.mode !== 'legacy') throw new Error('initial local-first snapshot must not call live orderbook');
  snapshot.clearProductionOpportunitySnapshotCache();
  await snapshot.getProductionOpportunitySnapshot({ force: true });
  if (liveCalls !== 1) throw new Error('manual refresh must call live orderbook exactly once');
  if (!persisted.has('opportunity_snapshot_v2')) throw new Error('live snapshot must persist to the local KV cache');
  snapshot.clearProductionOpportunitySnapshotCache();
  const restored = await snapshot.getProductionOpportunitySnapshot();
  if (liveCalls !== 1 || restored.mode !== 'v2') throw new Error('initial load must reuse the persisted live snapshot');
  liveIncomplete = true;
  const fallback = await snapshot.getProductionOpportunitySnapshot({ force: true });
  if (fallback.diagnostics.reason !== 'live_refresh_incomplete' || fallback.diagnostics.stale !== true) throw new Error('incomplete refresh must explain last-good fallback');
  if (persisted.get('opportunity_snapshot_v2') == null) throw new Error('incomplete refresh must keep last-good persistence');
  liveIncomplete = false;
  const realNow = Date.now;
  const now = realNow();
  Date.now = () => now + 11 * 60 * 1000;
  try {
    if (snapshot.peekProductionOpportunitySnapshot() !== null) throw new Error('expired memory snapshot must not be peekable');
    const expiredMemory = await snapshot.getProductionOpportunitySnapshot();
    if (expiredMemory.mode !== 'legacy') throw new Error('expired memory snapshot must fall back to local data');
  } finally {
    Date.now = realNow;
  }
  const persistedLive = persisted.get('opportunity_snapshot_v2');
  localRealtimeRefreshAt = new Date(Date.now() + 1000).toISOString();
  snapshot.clearProductionOpportunitySnapshotCache();
  const newerLocalData = await snapshot.getProductionOpportunitySnapshot();
  if (newerLocalData.mode !== 'legacy') throw new Error('newer local data must invalidate the persisted live snapshot');
  localRealtimeRefreshAt = undefined;
  liveInputKind = 'fixture';
  snapshot.clearProductionOpportunitySnapshotCache();
  await snapshot.getProductionOpportunitySnapshot({ force: true });
  if (persisted.get('opportunity_snapshot_v2') !== persistedLive) throw new Error('fixture refresh must not replace the persisted live snapshot');
  liveInputKind = 'live';
  const expiredEnvelope = JSON.parse(persisted.get('opportunity_snapshot_v2'));
  expiredEnvelope.snapshot.generatedAt = Date.now() - 11 * 60 * 1000;
  persisted.set('opportunity_snapshot_v2', JSON.stringify(expiredEnvelope));
  snapshot.clearProductionOpportunitySnapshotCache();
  const expired = await snapshot.getProductionOpportunitySnapshot();
  if (liveCalls !== 3 || expired.mode !== 'legacy') throw new Error('expired live snapshot must fall back to local data');
  persisted.set('opportunity_snapshot_v2', '{corrupt');
  snapshot.clearProductionOpportunitySnapshotCache();
  const corrupt = await snapshot.getProductionOpportunitySnapshot();
  if (corrupt.mode !== 'legacy') throw new Error('corrupt live snapshot must fall back to local data');

  const hook = require(path.join(outDir, 'ui', 'opportunity', 'useOpportunitySnapshot.js'));
  const hookState = hook.useOpportunitySnapshot();
  await hookState.reload();
  if (refreshOptions?.force === true) throw new Error('local reload must not trigger the live opportunity refresh');
  await hookState.refreshLive(['Fever Case']);
  if (refreshOptions?.force !== true || refreshOptions.candidateNames?.[0] !== 'Fever Case') throw new Error('explicit live refresh must forward candidate names');

  const seedText = fs.readFileSync(path.join(root, 'src', 'data', 'historySeed.generated.ts'), 'utf8');
  const match = seedText.match(/export const HISTORY_SEED = (.*) as const;/s);
  if (!match) throw new Error('history seed payload is missing');
  const seed = JSON.parse(match[1]);
  if (seed.some((entry) => /Sticker|Capsule/i.test(entry.name))) throw new Error('history seed must exclude sticker capsules');
  console.log(`PASS local-first snapshot and ${seed.length} seed items`);
}

run().finally(() => { Module._load = originalLoad; });
