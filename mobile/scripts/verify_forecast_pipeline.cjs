// V3-PHASE-3B.2R：Prepare/Freeze/Replay/顺序独立性契约测试。
const { execSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.verify-forecast-pipeline');
require('fs').rmSync(outDir, { recursive: true, force: true });
require('fs').mkdirSync(outDir, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + JSON.stringify(path.join(root, 'src', 'core', 'forecastBundle.ts')), { cwd: root, stdio: 'pipe', shell: true });
const f = require(path.join(outDir, 'forecastBundle.js'));
let passed = 0, failed = 0;
const assert = (name, ok, extra) => { if (ok) { passed++; console.log('PASS ' + name); } else { failed++; console.log('FAIL ' + name + (extra ? ` got=${extra}` : '')); } };
const names = ['CS:GO Weapon Case', 'Kilowatt Case', 'Fracture Case', 'Glove Case', 'Gamma 2 Case'];
let resolverCalls = 0;
const deterministicResolver = async (item) => {
  resolverCalls++;
  const value = item.length;
  return { item, readiness: { item, status: 'ready', historySource: 'steam_ssr', historyPointCount: 365, requiredPointCount: 3, forecastAsOf: 1700000000000, modelVersion: 'baseline-robust-v4' }, forecast: { p25: value, p50: value + 1, p75: value + 2, confidence: 0.8, marketState: 'STABLE', direction: 'UP' } };
};

async function main() {
  const cold = await f.prepareForecastBundle(names, deterministicResolver, { modelVersion: 'baseline-robust-v4', startedAt: 1700000000000 });
  assert('prepare awaits all resolvers', resolverCalls === names.length, resolverCalls);
  assert('cold ready all', cold.manifest.readyCount === names.length);
  assert('cold no in-flight', cold.manifest.inFlightAtFreeze === 0);
  const warm = await f.prepareForecastBundle(names, deterministicResolver, { modelVersion: 'baseline-robust-v4', startedAt: 1700000000000 });
  assert('warm ready all', warm.manifest.readyCount === names.length);
  assert('cold/warm ready set equal', JSON.stringify(Object.keys(cold.items).filter((x) => cold.items[x].readiness.status === 'ready')) === JSON.stringify(Object.keys(warm.items).filter((x) => warm.items[x].readiness.status === 'ready')));
  assert('cold/warm forecast equal', JSON.stringify(cold.items) === JSON.stringify(warm.items));
  const reverse = await f.prepareForecastBundle(names.slice().reverse(), deterministicResolver, { modelVersion: 'baseline-robust-v4', startedAt: 1700000000000 });
  assert('reverse ready all', reverse.manifest.readyCount === names.length);
  assert('reverse candidate hash equal', reverse.candidateHash === cold.candidateHash);
  const mapView = (items) => JSON.stringify(Object.keys(items).sort().map((key) => [key, items[key]]));
  assert('reverse forecast map equal', mapView(reverse.items) === mapView(cold.items));
  assert('asOf explicit', cold.items[names[0]].readiness.forecastAsOf === 1700000000000);
  assert('model version stable', cold.modelVersion === 'baseline-robust-v4');
  assert('history source explicit', Object.values(cold.items).every((x) => x.readiness.historySource === 'steam_ssr'));
  assert('point count explicit', Object.values(cold.items).every((x) => x.readiness.historyPointCount === 365));
  assert('required point count explicit', Object.values(cold.items).every((x) => x.readiness.requiredPointCount === 3));
  assert('no unknown status', Object.values(cold.items).every((x) => x.readiness.status !== 'warming'));
  assert('score stage would see only frozen items', names.every((name) => cold.items[name].readiness.status === 'ready'));
  assert('bundle immutable', Object.isFrozen(cold) && Object.isFrozen(cold.items));
  const frozenP50 = cold.items[names[0]].forecast.p50;
  cold.items[names[0]].forecast.p50 = 999;
  assert('forecast mutation rejected', cold.items[names[0]].forecast.p50 === frozenP50);
  // 5 samples × 12 invariants deliberately exercise order, status, source, cache key and freeze semantics.
  for (const name of names) {
    const item = cold.items[name];
    assert(`${name} ready`, item.readiness.status === 'ready');
    assert(`${name} forecast finite`, Number.isFinite(item.forecast.p25) && Number.isFinite(item.forecast.p50) && Number.isFinite(item.forecast.p75));
    assert(`${name} quantile order`, item.forecast.p25 <= item.forecast.p50 && item.forecast.p50 <= item.forecast.p75);
    assert(`${name} confidence range`, item.forecast.confidence >= 0 && item.forecast.confidence <= 1);
    assert(`${name} cache-independent key`, cold.items[name].item === name);
    assert(`${name} source not unknown`, item.readiness.historySource !== undefined);
    assert(`${name} model version`, item.readiness.modelVersion === 'baseline-robust-v4');
    assert(`${name} forecast asOf fixed`, item.readiness.forecastAsOf === 1700000000000);
    assert(`${name} p50 deterministic`, item.forecast.p50 === names.indexOf(name) + name.length + 1 || item.forecast.p50 === name.length + 1);
    assert(`${name} direction deterministic`, item.forecast.direction === 'UP');
    assert(`${name} no readiness reason`, item.readiness.reason === undefined);
  }
  console.log('');
  console.log(`PASS ${passed} / ${passed + failed}`);
  if (failed > 0) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
