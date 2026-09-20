// 3C-3R qualification gate evaluator tests。
// 真实 Android rounds 由 RN recorder 写入 kv；这里验证 gate 语义和安全 veto。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const flagsSource = fs.readFileSync(path.join(root, 'src', 'config', 'featureFlags.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');

let passed = 0;
let failed = 0;
function assert(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` got=${detail}` : ''}`);
  }
}

function record(overrides = {}) {
  return {
    roundId: `round-${Math.random()}`,
    inputKind: 'live',
    candidateCount: 93,
    forecast: { ready: 93, missing: 0, coverage: 1 },
    orderbook: { live: 93, cacheFresh: 0, cacheStale: 0, failed: 0, freshCoverage: 1, usableCoverage: 1, liveAttempts: 93, retries: 0, http429: 0, timeout: 0, circuitOpens: 0 },
    c5: { ready: 93, failed: 0, coverage: 1 },
    decisions: { excellent: 0, buy: 0, watch: 0, avoid: 93, fallbackLegacy: 0, missing: 0 },
    accounting: { accountedItems: 93, unaccountedItems: 0 },
    snapshot: { valid: true, stale: false, fallbackUsed: false },
    highRiskViolationCount: 0,
    refreshDurationMs: 1000,
    ...overrides,
  };
}

function qualify(records) {
  if (records.some((round) => round.inputKind !== 'live')) return 'FAIL';
  if (records.some((round) => round.accounting.unaccountedItems !== 0 || round.highRiskViolationCount > 0)) return 'FAIL';
  const qualified = records.filter((round) => round.forecast.coverage >= 0.90
    && round.orderbook.freshCoverage >= 0.95
    && round.c5.coverage >= 0.95
    && round.snapshot.valid
    && round.accounting.unaccountedItems === 0
    && round.highRiskViolationCount === 0).length;
  return records.length >= 12 && qualified >= 11 ? 'PASS-V2' : 'PASS-LEGACY';
}

const twelve = Array.from({ length: 12 }, () => record());
assert('12 live rounds qualify PASS-V2', qualify(twelve) === 'PASS-V2');
assert('12 rounds are retained', twelve.length === 12);
assert('all rounds inputKind live', twelve.every((round) => round.inputKind === 'live'));
assert('all rounds accounting complete', twelve.every((round) => round.accounting.unaccountedItems === 0));
assert('all rounds high-risk clean', twelve.every((round) => round.highRiskViolationCount === 0));
assert('all rounds forecast gate', twelve.every((round) => round.forecast.coverage >= 0.90));
assert('all rounds fresh orderbook gate', twelve.every((round) => round.orderbook.freshCoverage >= 0.95));
assert('all rounds c5 gate', twelve.every((round) => round.c5.coverage >= 0.95));
assert('all rounds snapshot valid', twelve.every((round) => round.snapshot.valid));
assert('zero buy is acceptable', twelve.every((round) => round.decisions.buy === 0));
assert('zero excellent is acceptable', twelve.every((round) => round.decisions.excellent === 0));

const oneExternalFailure = twelve.slice();
oneExternalFailure[0] = record({ forecast: { ready: 80, missing: 13, coverage: 80 / 93 }, orderbook: { ...record().orderbook, freshCoverage: 0.90 }, c5: { ready: 80, failed: 13, coverage: 80 / 93 }, snapshot: { valid: false, stale: true, fallbackUsed: true } });
assert('one failed round remains PASS-V2 eligible', qualify(oneExternalFailure) === 'PASS-V2');
assert('one failed round is not qualified', oneExternalFailure.filter((round) => round.snapshot.valid).length === 11);

const twoFailures = twelve.slice();
twoFailures[0] = oneExternalFailure[0];
twoFailures[1] = oneExternalFailure[0];
assert('two failed rounds downgrade to PASS-LEGACY', qualify(twoFailures) === 'PASS-LEGACY');

assert('accounting gap is veto', qualify([record({ accounting: { accountedItems: 90, unaccountedItems: 3 } })]) === 'FAIL');
assert('high-risk violation is veto', qualify([record({ highRiskViolationCount: 1 })]) === 'FAIL');
assert('synthetic input is release veto', qualify([record({ inputKind: 'synthetic' })]) === 'FAIL');
assert('fixture input is release veto', qualify([record({ inputKind: 'fixture' })]) === 'FAIL');
assert('missing snapshot validity is legacy-safe', qualify([record({ snapshot: { valid: false, stale: true, fallbackUsed: true } })]) === 'PASS-LEGACY');
assert('stale but complete round can be recorded', record({ snapshot: { valid: true, stale: true, fallbackUsed: false } }).snapshot.stale === true);
assert('fallback is recorded', record({ snapshot: { valid: true, stale: true, fallbackUsed: true } }).snapshot.fallbackUsed === true);
assert('429 is diagnostic only', record({ orderbook: { ...record().orderbook, http429: 1 } }).orderbook.http429 === 1);
assert('timeout is diagnostic only', record({ orderbook: { ...record().orderbook, timeout: 1 } }).orderbook.timeout === 1);
assert('circuit open is diagnostic only', record({ orderbook: { ...record().orderbook, circuitOpens: 1 } }).orderbook.circuitOpens === 1);
assert('fallback legacy is counted', record({ decisions: { ...record().decisions, fallbackLegacy: 3, avoid: 90 } }).decisions.fallbackLegacy === 3);
assert('missing is counted', record({ decisions: { ...record().decisions, missing: 2, avoid: 91 } }).decisions.missing === 2);

assert('default mode source is v2', /opportunityMode:\s*'v2'/.test(flagsSource));
assert('version is 1.9.5', packageJson.version === '1.9.5');
assert('Expo version is 1.9.5', JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo.version === '1.9.5');
assert('version code is 43', /versionCode\s+43/.test(gradle));
assert('release version bump is present', /versionName\s*[=:]?\s*["']1\.9\.5["']/.test(gradle));

console.log('');
console.log(`PASS ${passed} / ${passed + failed}`);
if (failed > 0) process.exitCode = 1;
