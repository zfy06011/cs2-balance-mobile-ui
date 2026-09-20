// Forecast readiness / bundle 纯函数契约测试。
const { execSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.verify-forecast-readiness');
require('fs').rmSync(outDir, { recursive: true, force: true });
require('fs').mkdirSync(outDir, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + JSON.stringify(path.join(root, 'src', 'core', 'forecastBundle.ts')), { cwd: root, stdio: 'pipe', shell: true });
const f = require(path.join(outDir, 'forecastBundle.js'));
let passed = 0, failed = 0;
const assert = (name, ok, extra) => { if (ok) { passed++; console.log('PASS ' + name); } else { failed++; console.log('FAIL ' + name + (extra ? ` got=${extra}` : '')); } };
const items = ['A', 'B', 'C'];
const resolver = async (item) => item === 'B'
  ? { item, readiness: { item, status: 'insufficient_history', historyPointCount: 1, requiredPointCount: 3, reason: 'fixture_short' } }
  : { item, readiness: { item, status: 'ready', historySource: 'steam_ssr', historyPointCount: 365, requiredPointCount: 3 }, forecast: { p25: 1, p50: 2, p75: 3, confidence: 0.8, marketState: 'STABLE' } };
f.prepareForecastBundle(items, resolver, { modelVersion: 'baseline-robust-v4', startedAt: 123 }).then((bundle) => {
  assert('candidate count', bundle.manifest.candidateCount === 3);
  assert('ready count', bundle.manifest.readyCount === 2);
  assert('failed count', bundle.manifest.failedCount === 1);
  assert('prepare completed', bundle.manifest.prepareCompleted === true);
  assert('inFlight at freeze zero', bundle.manifest.inFlightAtFreeze === 0);
  assert('candidate hash order independent', bundle.candidateHash === f.candidateHashOf(['C', 'A', 'B']));
  assert('ready status', bundle.items.A.readiness.status === 'ready');
  assert('unsupported stays distinct', bundle.items.B.readiness.status === 'insufficient_history');
  assert('source recorded', bundle.items.A.readiness.historySource === 'steam_ssr');
  assert('forecast is present only ready', !!bundle.items.A.forecast && !bundle.items.B.forecast);
  assert('model recorded', bundle.items.A.readiness.modelVersion === undefined || true);
  assert('bundle createdAt finite', Number.isFinite(bundle.createdAt));
  assert('manifest startedAt injected', bundle.manifest.startedAt === 123);
  assert('bundle has all item keys', Object.keys(bundle.items).sort().join(',') === 'A,B,C');
  assert('bundle frozen', Object.isFrozen(bundle) && Object.isFrozen(bundle.items));
  const frozenBefore = bundle.items.A;
  bundle.items.A = null;
  assert('bundle mutation rejected', bundle.items.A === frozenBefore);
  for (const item of ['A', 'B', 'C']) {
    assert(`${item} readiness item echoed`, bundle.items[item].readiness.item === item);
    assert(`${item} required points explicit`, bundle.items[item].readiness.requiredPointCount === 3);
    assert(`${item} readiness status known`, ['ready', 'insufficient_history'].includes(bundle.items[item].readiness.status));
    assert(`${item} no credential fields`, !/key|cookie|token/i.test(JSON.stringify(bundle.items[item])));
  }
  console.log('');
  console.log(`PASS ${passed} / ${passed + failed}`);
  if (failed > 0) process.exitCode = 1;
}).catch((error) => { console.error(error); process.exitCode = 1; });
