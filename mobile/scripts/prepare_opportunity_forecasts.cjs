// V3-PHASE-3B.2R：Prepare Forecast Bundle。
// Cloud batch 优先，缺失项才顺序使用 Steam SSR；Prepare 完成后才写入 frozen bundle。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(__dirname, '.forecast-prepare-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });
const source = (p) => path.join(root, 'src', p);
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(buildDir) + ' ' + [
  source('core/forecastBundle.ts'), source('core/prediction.ts'), source('data/steamHistorySsr.ts'), source('data/steam.ts'), source('data/caseFilter.ts'),
].map(JSON.stringify).join(' '), { cwd: root, stdio: 'pipe', shell: true });
const { prepareForecastBundle } = require(path.join(buildDir, 'core', 'forecastBundle.js'));
const { BaselinePredictorV4 } = require(path.join(buildDir, 'core', 'prediction.js'));
const { fetchSteamHistorySsr } = require(path.join(buildDir, 'data', 'steamHistorySsr.js'));
const { searchCases } = require(path.join(buildDir, 'data', 'steam.js'));
const { isTrackedCase } = require(path.join(buildDir, 'data', 'caseFilter.js'));
const historyCache = require(path.join(root, 'scripts', 'persistent_history_cache.cjs'));

const DEFAULT_NAMES = [
  'CS:GO Weapon Case', 'Dreams & Nightmares Case', 'Kilowatt Case', 'Revolution Case', 'Fracture Case',
  'Sealed Dead Hand Terminal', 'Fever Case', 'Prisma 2 Case', 'Snakebite Case', 'Clutch Case',
  'Danger Zone Case', 'Horizon Case', 'Prisma Case', 'Spectrum 2 Case', 'Gamma 2 Case', 'Glove Case',
  'Chroma 3 Case', 'Operation Wildfire Case', 'Shadow Case', 'Recoil Case',
];
function argValue(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback; }
function timeoutPromise(promise, timeoutMs) { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('history_timeout'), { code: 'timeout' })), timeoutMs); })]).finally(() => clearTimeout(timer)); }
function parseNames() {
  const file = argValue('--names', null);
  if (file) return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return DEFAULT_NAMES.slice();
}
async function candidates(limit) {
  const names = [];
  const add = (name) => { if (name && isTrackedCase(name) && !names.includes(name)) names.push(name); };
  for (const name of parseNames()) add(name);
  try { for (const hit of await searchCases(Math.max(limit * 2, 100))) add(hit.name); } catch { /* 手工候选继续 */ }
  return names.slice(0, limit);
}
function cloudPointsToRaw(points) {
  return points.filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
    .map((p) => ({ ts: Number(p[0]) * 1000, price: Number(p[1]), volume: Number.isFinite(Number(p[2])) ? Number(p[2]) : 0 }))
    .sort((a, b) => a.ts - b.ts);
}
async function cloudBatch(names, days, timeoutMs) {
  const url = `${String(argValue('--cloud-url', 'https://cs2-price-history.1951497869.workers.dev')).replace(/\/+$/, '')}/history/batch`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ names, days }) });
    if (!response.ok) throw new Error(`cloud_batch_http_${response.status}`);
    const json = await response.json();
    return json && json.results && typeof json.results === 'object' ? json.results : {};
  } finally { clearTimeout(timer); }
}
function makeForecast(item, raw, asOf, source = 'cloud', retrievalSource = source) {
  const points = raw.slice(-365);
  if (points.length < 3) return { readiness: { item, status: points.length === 0 ? 'missing_history' : 'insufficient_history', historySource: source, retrievalSource, historyPointCount: points.length, requiredPointCount: 3, historyStartAt: points[0]?.ts, historyEndAt: points.at(-1)?.ts, forecastAsOf: asOf, modelVersion: 'baseline-robust-v4', reason: 'history_point_count_below_required' } };
  try {
    const prediction = new BaselinePredictorV4().predict({ marketHashName: item, prices: points.map((p) => p.price), timestamps: points.map((p) => p.ts), volumes: points.map((p) => p.volume), volumeHistory: points.slice(-60).map((p) => p.volume), predictedAt: new Date(asOf) });
    return {
      item,
      readiness: { item, status: 'ready', historySource: source, retrievalSource, historyPointCount: points.length, requiredPointCount: 3, historyStartAt: points[0].ts, historyEndAt: points.at(-1).ts, forecastAsOf: asOf, modelVersion: prediction.model_version, cacheHit: retrievalSource === 'persistent_cache' },
      forecast: { p25: prediction.p25, p50: prediction.p50, p75: prediction.p75, confidence: prediction.confidence, marketState: prediction.features.market_state, direction: prediction.p50 >= points.at(-1).price ? 'UP' : 'DOWN' },
    };
  } catch (error) {
    return { item, readiness: { item, status: 'prediction_failed', historySource: source, retrievalSource, historyPointCount: points.length, requiredPointCount: 3, historyStartAt: points[0].ts, historyEndAt: points.at(-1).ts, forecastAsOf: asOf, modelVersion: 'baseline-robust-v4', reason: String(error?.message || error) } };
  }
}
async function main() {
  const limit = Math.max(5, Number(argValue('--limit', 93)) || 93);
  const names = await candidates(limit);
  const asOf = Date.now();
  const cacheDir = path.resolve(process.cwd(), argValue('--cache-dir', path.join('artifacts', 'history-cache')));
  if (process.argv.includes('--clear-cache')) fs.rmSync(cacheDir, { recursive: true, force: true });
  const cacheHits = new Map();
  const cloudNames = [];
  for (const name of names) {
    const hit = historyCache.readHistoryCache(cacheDir, name, { requiredPointCount: 3 });
    if (hit.hit) cacheHits.set(name, hit.entry);
    else cloudNames.push(name);
  }
  const results = cloudNames.length > 0
    ? await cloudBatch(cloudNames, 365, Math.max(1000, Number(argValue('--timeout-ms', 10000)) || 10000))
    : {};
  let cloudHitCount = 0;
  let ssrFallbackCount = 0;
  let ssrSuccessCount = 0;
  let ssrFailureCount = 0;
  let persistWriteCount = 0;
  const bundle = await prepareForecastBundle(names, async (item) => {
    const cached = cacheHits.get(item);
    if (cached) return makeForecast(item, cached.points, asOf, cached.source === 'steam_ssr' ? 'steam_ssr' : 'cloud', 'persistent_cache');
    const result = results[item];
    if (result && Array.isArray(result.points)) {
      cloudHitCount++;
      const raw = cloudPointsToRaw(result.points);
      historyCache.writeHistoryCache(cacheDir, { item, source: 'cloud', points: raw, fetchedAt: asOf, requiredPointCount: 3, parserVersion: 'cloud-history-batch' });
      persistWriteCount++;
      return makeForecast(item, raw, asOf, 'cloud', 'cloud');
    }
    ssrFallbackCount++;
    try {
      const ssrPoints = await fetchSteamHistorySsr(item, 365, Math.max(1000, Number(argValue('--ssr-timeout-ms', 6000)) || 6000));
      const raw = ssrPoints.map((point) => ({ ts: Date.parse(`${point.date}T00:00:00.000Z`), price: point.price, volume: point.volume ?? 0 }));
      historyCache.writeHistoryCache(cacheDir, { item, source: 'steam_ssr', points: raw, fetchedAt: asOf, requiredPointCount: 3, parserVersion: 'steam-ssr-history' });
      persistWriteCount++;
      ssrSuccessCount++;
      return makeForecast(item, raw, asOf, 'steam_ssr', 'steam_ssr');
    } catch (error) {
      ssrFailureCount++;
      return { item, readiness: { item, status: 'history_fetch_failed', historySource: 'steam_ssr', requiredPointCount: 3, reason: String(error?.message || error) } };
    }
  }, { modelVersion: 'baseline-robust-v4', startedAt: asOf });
  const out = argValue('--out', path.join('artifacts', 'shadow', `forecast-bundle-${Date.now()}.json`));
  const resolved = path.resolve(process.cwd(), out);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(bundle, null, 2), 'utf8');
  console.log(JSON.stringify({ out: resolved, candidateCount: bundle.manifest.candidateCount, readyCount: bundle.manifest.readyCount, failedCount: bundle.manifest.failedCount, candidateHash: bundle.candidateHash, prepareCompleted: bundle.manifest.prepareCompleted, inFlightAtFreeze: bundle.manifest.inFlightAtFreeze, persistentHitCount: cacheHits.size, cloudHitCount, ssrFallbackCount, ssrSuccessCount, ssrFailureCount, persistWriteCount, cacheStats: historyCache.cacheStats(cacheDir) }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
