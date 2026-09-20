// V3-PHASE-3B.2R：Forecast pipeline trace。
// 只追踪 Steam SSR 历史与 V4 纯预测，不接 Shadow Score，不写用户数据库。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.forecast-trace-build');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const source = (p) => path.join(root, 'src', p);
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + [source('data/steamHistorySsr.ts'), source('core/prediction.ts')].map(JSON.stringify).join(' '), { cwd: root, stdio: 'pipe', shell: true });
const { fetchSteamHistorySsr } = require(path.join(outDir, 'data', 'steamHistorySsr.js'));
const { BaselinePredictorV4 } = require(path.join(outDir, 'core', 'prediction.js'));

const DEFAULT_NAMES = [
  'CS:GO Weapon Case', 'Dreams & Nightmares Case', 'Kilowatt Case', 'Revolution Case',
  'Fracture Case', 'Glove Case', 'Gamma 2 Case', 'Chroma 3 Case', 'Operation Wildfire Case',
];
function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
}
function parseNames() {
  const raw = argValue('--names', null);
  if (!raw) return DEFAULT_NAMES.slice();
  if (fs.existsSync(path.resolve(process.cwd(), raw))) return fs.readFileSync(path.resolve(process.cwd(), raw), 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return raw.split(',').map((x) => x.trim()).filter(Boolean);
}
function featureNumber(prediction, key) {
  const value = prediction?.features?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
async function traceOne(item, timeoutMs) {
  const started = Date.now();
  const trace = {
    item,
    candidateResolved: true,
    historyLookup: { localAttempted: false, localFound: false, ssrAttempted: true, ssrParsed: false },
    normalizedHistory: { inputPointCount: 0, outputPointCount: 0, requiredPointCount: 3 },
    forecast: { attempted: false, success: false },
    bundle: { inserted: false, readinessStatus: 'warming' },
    timing: {},
  };
  const historyStarted = Date.now();
  try {
    const points = await fetchSteamHistorySsr(item, 365, timeoutMs);
    trace.historyLookup.ssrStatus = 200;
    trace.historyLookup.ssrParsed = true;
    trace.historyLookup.ssrPointCount = points.length;
    trace.historyLookup.historySource = 'steam_ssr';
    trace.normalizedHistory.inputPointCount = points.length;
    trace.normalizedHistory.outputPointCount = points.length;
    trace.normalizedHistory.firstTimestamp = points[0] ? Date.parse(`${points[0].date}T00:00:00.000Z`) : undefined;
    trace.normalizedHistory.lastTimestamp = points.length > 0 ? Date.parse(`${points[points.length - 1].date}T00:00:00.000Z`) : undefined;
    trace.timing.historyMs = Date.now() - historyStarted;
    if (points.length === 0) {
      trace.bundle.readinessStatus = 'missing_history';
      trace.reason = 'ssr_empty';
    } else if (points.length < trace.normalizedHistory.requiredPointCount) {
      trace.bundle.readinessStatus = 'insufficient_history';
      trace.reason = 'history_point_count_below_required';
    } else {
      trace.forecast.attempted = true;
      const forecastStarted = Date.now();
      const prices = points.map((point) => point.price);
      const timestamps = points.map((point) => Date.parse(`${point.date}T00:00:00.000Z`));
      const volumes = points.map((point) => point.volume ?? 0);
      const prediction = new BaselinePredictorV4().predict({ marketHashName: item, prices, timestamps, volumes, volumeHistory: volumes.slice(-60), predictedAt: new Date() });
      trace.timing.forecastMs = Date.now() - forecastStarted;
      trace.forecast = {
        attempted: true,
        success: true,
        modelVersion: prediction.model_version,
        p25: prediction.p25,
        p50: prediction.p50,
        p75: prediction.p75,
      };
      trace.bundle = { inserted: true, readinessStatus: 'ready', cacheKey: `${item}|${trace.normalizedHistory.lastTimestamp}|${points.length}|${prediction.model_version}` };
    }
  } catch (error) {
    trace.timing.historyMs = Date.now() - historyStarted;
    trace.historyLookup.ssrStatus = error?.status;
    trace.historyLookup.ssrParsed = false;
    trace.bundle.readinessStatus = error?.code === 'timeout' ? 'history_fetch_failed' : 'history_parse_failed';
    trace.reason = String(error?.message || error);
  }
  trace.timing.totalMs = Date.now() - started;
  return trace;
}

async function main() {
  let names = parseNames();
  if (process.argv.includes('--reverse')) names = names.reverse();
  const repeat = Math.max(1, Number(argValue('--repeat', 1)) || 1);
  const timeoutMs = Math.max(1000, Number(argValue('--timeout-ms', 6000)) || 6000);
  const rounds = [];
  for (let i = 0; i < repeat; i++) {
    const traces = [];
    for (const name of names) traces.push(await traceOne(name, timeoutMs));
    rounds.push({ round: i + 1, traces });
  }
  const output = { generatedAt: new Date().toISOString(), names, rounds };
  const outPath = argValue('--out', null);
  if (outPath) {
    const resolved = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(output, null, 2), 'utf8');
  }
  const compact = rounds.map((round) => ({ round: round.round, ready: round.traces.filter((x) => x.bundle.readinessStatus === 'ready').length, statuses: round.traces.reduce((m, x) => { m[x.bundle.readinessStatus] = (m[x.bundle.readinessStatus] || 0) + 1; return m; }, {}) }));
  console.log(JSON.stringify({ names, compact, traces: rounds[0].traces }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
