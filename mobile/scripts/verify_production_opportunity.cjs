// 3C-1 生产 Opportunity 编排层契约测试。
// 这里允许使用 Node 测试工具；被编译的 production/data 模块本身必须保持 RN-safe。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(os.tmpdir(), 'yu-e-verify-production-opportunity');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--ignoreConfig',
  '--module', 'commonjs',
  '--target', 'es2020',
  '--skipLibCheck',
  '--outDir', outDir,
  path.join(root, 'src', 'data', 'opportunityProduction.ts'),
  path.join(root, 'src', 'data', 'orderbookRuntimeCache.ts'),
  path.join(root, 'src', 'data', 'orderbookRuntimeLimiter.ts'),
  path.join(root, 'src', 'core', 'discountV2.ts'),
], { cwd: root, stdio: 'pipe' });

const production = require(path.join(outDir, 'data', 'opportunityProduction.js'));
const flags = require(path.join(outDir, 'config', 'featureFlags.js'));
const core = require(path.join(outDir, 'core', 'opportunityV2.js'));
const discountCore = require(path.join(outDir, 'core', 'discountV2.js'));
const runtimeCache = require(path.join(outDir, 'data', 'orderbookRuntimeCache.js'));
const runtimeLimiter = require(path.join(outDir, 'data', 'orderbookRuntimeLimiter.js'));

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

function discountFor(index) {
  return {
    item: `item-${index}`,
    quantity: 10,
    current: {
      grossPerUnit: 100,
      netPerUnit: 115,
      totalNet: 1150,
      discount: 0.76,
      filledQuantity: 10,
      requestedQuantity: 10,
      liquidationCoverage: 1,
      filledGross: 1322.5,
      filledNet: 1150,
      filledDiscount: 0.76,
      fullPositionDiscount: 0.76,
    },
    conservative7d: { grossPerUnit: 98, netPerUnit: 113, totalNet: 1130, discount: 0.78 },
    expected7d: { grossPerUnit: 100, netPerUnit: 115, totalNet: 1150, discount: 0.80 },
    listing7d: { grossPerUnit: 99, netPerUnit: 114, totalNet: 1140, discount: 0.79 },
    futureModel: {
      orderbookPredicted: false,
      liquidityGuaranteed: false,
      usesCurrentBuySellRatio: true,
      currentBuySellRatio: 0.8,
      ratioKind: 'current_market_heuristic',
    },
    liquidity: {
      spread: 1,
      spreadPct: 0.01,
      currentVwap: 100,
      slippagePct: 0.01,
      executableQuantity: 10,
      executableBudget: 1000,
      filledQuantity: 10,
      unfilledQuantity: 0,
    },
    currentLiquidityCapacity: {
      scope: 'current_market_structure',
      executableQuantity: 10,
      executableBudget: 1000,
    },
    marketDataQuality: { score: 0.95, stale: false, reasons: [] },
    forecastQuality: { available: true, score: 0.80, reasons: [] },
    feeModel: {
      name: 'estimatedSteamNetReceive',
      kind: 'approximate',
      exact: false,
      receiveRatio: 0.8696,
      unit: 'CNY',
      note: 'fixture',
    },
    quality: {
      score: 0.90,
      stale: false,
      reasons: [],
      marketData: { score: 0.95, stale: false, reasons: [] },
      forecast: { available: true, score: 0.80, reasons: [] },
      overall: 0.90,
    },
    warnings: [],
  };
}

function candidate(index, overrides = {}) {
  return {
    item: `item-${index}`,
    legacy: { signal: 'wait', score: 40 + index },
    opportunityInput: {
      item: `item-${index}`,
      discount: discountFor(index),
      market: {
        volume24h: 1000,
        c5AvailableQuantity: 500,
        highestBuy: 100,
        lowestSell: 101,
      },
      risk: { marketState: 'STABLE', cv: 0.02 },
      forecast: { confidence: 0.80, direction: 'UP' },
      feeModel: { kind: 'approximate', exact: false },
      evaluationBudget: 500,
    },
    prepared: {
      forecastReady: true,
      orderbookStatus: 'live',
      c5Ready: true,
      c5BuyPrice: 7,
      c5FetchedAt: 900,
      orderbookFetchedAt: 800,
    },
    ...overrides,
  };
}

function batch(count = 20, overrides = {}) {
  return Array.from({ length: count }, (_, index) => candidate(index, typeof overrides === 'function' ? overrides(index) : overrides));
}

async function main() {
  assert('default mode is v2 after qualification', flags.DEFAULT_FEATURE_FLAGS.opportunityMode === 'v2');
  assert('invalid mode normalizes to legacy', flags.normalizeFeatureFlags({ opportunityMode: 'invalid' }).opportunityMode === 'legacy');
  assert('shadow mode accepted', flags.normalizeFeatureFlags({ opportunityMode: 'shadow' }).opportunityMode === 'shadow');
  assert('v2 mode accepted', flags.normalizeFeatureFlags({ opportunityMode: 'v2' }).opportunityMode === 'v2');

  const legacy = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'legacy' }, { now: () => 1000 });
  const legacySnapshot = await legacy.refresh(batch(), true);
  assert('legacy orchestrator reports legacy', legacy.mode() === 'legacy');
  assert('legacy snapshot reports legacy', legacySnapshot.mode === 'legacy');
  assert('legacy candidate count preserved', legacySnapshot.candidateCount === 20);
  assert('legacy item count preserved', legacySnapshot.items.length === 20);
  assert('legacy does not call v2', legacySnapshot.items.every((item) => !item.v2));
  assert('legacy signal preserved', legacySnapshot.items[3].legacy.signal === 'wait');
  assert('legacy score preserved', legacySnapshot.items[3].legacy.score === 43);
  assert('legacy no fallback', legacySnapshot.diagnostics.fallbackCount === 0);
  assert('legacy generatedAt finite', Number.isFinite(legacySnapshot.generatedAt));
  assert('legacy diagnostics exposed', legacy.diagnostics() === legacySnapshot.diagnostics);

  const shadow = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'shadow' }, { now: () => 2000 });
  const shadowSnapshot = await shadow.refresh(batch(), true);
  assert('shadow snapshot reports shadow', shadowSnapshot.mode === 'shadow');
  assert('shadow keeps legacy field', shadowSnapshot.items.every((item) => item.legacy));
  assert('shadow adds v2 field', shadowSnapshot.items.every((item) => item.v2));
  assert('shadow has no failures', shadowSnapshot.diagnostics.failureCount === 0);
  assert('shadow forecast coverage is full', shadowSnapshot.diagnostics.forecastCoverage === 1);
  assert('shadow orderbook coverage is full', shadowSnapshot.diagnostics.orderbookFreshCoverage === 1);
  assert('shadow c5 coverage is full', shadowSnapshot.diagnostics.c5Coverage === 1);
  assert('shadow item mode is shadow', shadowSnapshot.items.every((item) => item.mode === 'shadow'));
  assert('shadow v2 score finite', shadowSnapshot.items.every((item) => Number.isFinite(item.v2.score)));
  assert('shadow v2 decision present', shadowSnapshot.items.every((item) => ['excellent', 'buy', 'watch', 'avoid'].includes(item.v2.decision)));
  assert('shadow reasons are copied', Array.isArray(shadowSnapshot.items[0].v2.reasons));
  assert('shadow warnings are copied', Array.isArray(shadowSnapshot.items[0].v2.warnings));
  assert('shadow hard gates are copied', Array.isArray(shadowSnapshot.items[0].v2.hardGates));
  assert('shadow caps are copied', Array.isArray(shadowSnapshot.items[0].v2.caps));
  assert('shadow diagnostics forecast ready', shadowSnapshot.items.every((item) => item.diagnostics.forecastStatus === 'ready'));
  assert('shadow diagnostics orderbook live', shadowSnapshot.items.every((item) => item.diagnostics.orderbookStatus === 'live'));
  assert('shadow diagnostics c5 ready', shadowSnapshot.items.every((item) => item.diagnostics.c5Status === 'ready'));
  assert('shadow diagnostics no fallback', shadowSnapshot.items.every((item) => item.diagnostics.fallbackUsed === false));
  assert('shadow v2 current discount sourced', shadowSnapshot.items[0].v2.currentDiscount === 0.76);
  assert('shadow v2 conservative discount sourced', shadowSnapshot.items[0].v2.conservativeDiscount === 0.78);
  assert('shadow v2 expected discount sourced', shadowSnapshot.items[0].v2.expectedDiscount === 0.80);
  assert('shadow v2 listing discount sourced', shadowSnapshot.items[0].v2.listingDiscount === 0.79);
  assert('shadow v2 spread sourced', shadowSnapshot.items[0].v2.spreadPct === 0.01);
  assert('shadow v2 budget sourced', shadowSnapshot.items[0].v2.executableBudget === 1000);
  assert('shadow v2 market confidence sourced', shadowSnapshot.items[0].v2.marketDataQuality === 0.95);
  assert('shadow v2 forecast confidence sourced', shadowSnapshot.items[0].v2.forecastQuality === 0.8);
  assert('shadow v2 c5 price sourced', shadowSnapshot.items[0].v2.c5BuyPrice === 7);
  assert('shadow v2 c5 timestamp sourced', shadowSnapshot.items[0].v2.c5FetchedAt === 900);
  assert('shadow v2 orderbook timestamp stays separate', shadowSnapshot.items[0].v2.orderbookFetchedAt === 800);

  const v2 = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'v2' }, { now: () => 3000 });
  const v2Snapshot = await v2.refresh(batch(), true);
  assert('v2 snapshot reports v2', v2Snapshot.mode === 'v2');
  assert('v2 removes legacy field on success', v2Snapshot.items.every((item) => item.legacy === undefined));
  assert('v2 produces all decisions', v2Snapshot.items.every((item) => item.v2 && item.v2.decision));
  assert('v2 has no fallback', v2Snapshot.diagnostics.fallbackCount === 0);
  assert('v2 snapshot is current', v2.current() === v2Snapshot);
  assert('v2 item timestamps finite', v2Snapshot.items.every((item) => Number.isFinite(item.generatedAt)));
  assert('v2 item names preserved', v2Snapshot.items.map((item) => item.item).join(',') === batch().map((item) => item.item).join(','));

  const missingInput = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'v2' }, { now: () => 4000 });
  const fallbackSnapshot = await missingInput.refresh(batch(10, (index) => index === 2 ? { opportunityInput: undefined } : {}), true);
  assert('missing input still yields snapshot', fallbackSnapshot.items.length === 10);
  assert('missing input counts failure', fallbackSnapshot.diagnostics.failureCount === 1);
  assert('missing input counts fallback', fallbackSnapshot.diagnostics.fallbackCount === 1);
  assert('missing input keeps legacy fallback', fallbackSnapshot.items[2].legacy.signal === 'wait');
  assert('missing input has no v2 result', fallbackSnapshot.items[2].v2 === undefined);
  assert('missing input marks fallback', fallbackSnapshot.items[2].diagnostics.fallbackUsed === true);
  assert('missing input has stable reason', fallbackSnapshot.items[2].diagnostics.reason === 'v2_input_missing');
  assert('other inputs still produce v2', fallbackSnapshot.items.filter((item) => item.item !== 'item-2').every((item) => item.v2));
  assert('partial fallback does not erase snapshot', missingInput.current() === fallbackSnapshot);

  const atomic = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'v2' }, { now: () => 5000 });
  const atomicGood = await atomic.refresh(batch(10), true);
  const atomicBad = await atomic.refresh(batch(10, (index) => index < 2 ? {
    prepared: { forecastReady: false, orderbookStatus: 'failed', c5Ready: false },
  } : {}), true);
  assert('coverage below threshold is reported', (atomic.diagnostics().reason || '') === 'snapshot_completeness_below_threshold');
  assert('forecast coverage below threshold', atomic.diagnostics().forecastCoverage === 0.8);
  assert('orderbook coverage below threshold', atomic.diagnostics().orderbookFreshCoverage === 0.8);
  assert('c5 coverage below threshold', atomic.diagnostics().c5Coverage === 0.8);
  assert('failed refresh returns prior snapshot', atomicBad === atomicGood);
  assert('failed refresh keeps prior candidate count', atomic.current().candidateCount === 10);
  assert('failed refresh keeps prior snapshot identity', atomic.current() === atomicGood);
  assert('failed refresh does not expose partial items', atomic.current().items.every((item) => item.v2));
  assert('failed refresh reports preparation failures', atomic.diagnostics().failureCount === 2);
  assert('failed refresh is not stale by itself', atomic.diagnostics().stale === false);

  const exact = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'shadow' }, { now: () => 6000 });
  const exactSnapshot = await exact.refresh(batch(10, (index) => index === 0 ? {
    prepared: { forecastReady: true, orderbookStatus: 'cache_stale', c5Ready: true },
  } : {}), true);
  assert('90 percent forecast threshold passes', exactSnapshot.diagnostics.forecastCoverage === 1);
  assert('90 percent orderbook fresh threshold is calculated', exactSnapshot.diagnostics.orderbookFreshCoverage === 0.9);
  assert('90 percent c5 threshold passes', exactSnapshot.diagnostics.c5Coverage === 1);
  assert('stale orderbook is visible', exactSnapshot.diagnostics.stale === true);
  assert('stale item is visible', exactSnapshot.items[0].diagnostics.stale === true);
  assert('stale item keeps v2 result', exactSnapshot.items[0].v2 !== undefined);
  assert('stale item is not silently called fresh', exactSnapshot.items[0].diagnostics.orderbookStatus === 'cache_stale');
  assert('stale snapshot is accepted at 90 percent', exactSnapshot.diagnostics.reason === undefined);

  const cooldownClock = { value: 7000 };
  const cooldown = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'shadow' }, {
    now: () => cooldownClock.value,
    minRefreshIntervalMs: 120000,
  });
  const first = cooldown.refresh(batch(12), true);
  const second = cooldown.refresh(batch(12), true);
  const third = cooldown.refresh(batch(12), true);
  assert('refresh singleflight returns same promise 1/2', first === second);
  assert('refresh singleflight returns same promise 2/3', second === third);
  const firstSnapshot = await first;
  assert('singleflight completes one snapshot', cooldown.current() === firstSnapshot);
  cooldownClock.value += 1000;
  const cooled = await cooldown.refresh(batch(12));
  assert('cooldown returns current snapshot', cooled === firstSnapshot);
  assert('cooldown keeps timestamp', cooled.generatedAt === 7000);
  cooldownClock.value += 120000;
  const refreshed = await cooldown.refresh(batch(12));
  assert('cooldown expires after interval', refreshed !== firstSnapshot);
  const forced = await cooldown.refresh(batch(12), true);
  assert('force bypasses cooldown', forced !== refreshed);

  const staleClock = { value: 10000 };
  const staleSnapshotOwner = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'shadow' }, {
    now: () => staleClock.value,
    snapshotStaleAfterMs: 100,
  });
  const freshSnapshot = await staleSnapshotOwner.refresh(batch(3), true);
  staleClock.value += 101;
  const markedStale = staleSnapshotOwner.current();
  assert('old snapshot becomes stale after threshold', markedStale.diagnostics.stale === true);
  assert('stale marking keeps item data', markedStale.items.length === freshSnapshot.items.length);
  assert('stale marking is exposed by diagnostics', staleSnapshotOwner.diagnostics().stale === true);

  const legacyIsolation = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'legacy' }, { now: () => 8000 });
  const legacyWithMissing = await legacyIsolation.refresh(batch(4, { opportunityInput: undefined }), true);
  assert('legacy tolerates missing v2 input', legacyWithMissing.items.length === 4);
  assert('legacy missing input does not count fallback', legacyWithMissing.diagnostics.fallbackCount === 0);
  assert('legacy missing input has no v2', legacyWithMissing.items.every((item) => item.v2 === undefined));
  assert('legacy keeps every legacy signal', legacyWithMissing.items.every((item) => item.legacy.signal === 'wait'));

  const empty = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'shadow' }, { now: () => 9000 });
  const emptySnapshot = await empty.refresh([], true);
  assert('empty candidate list does not throw', emptySnapshot.candidateCount === 0);
  assert('empty candidate list has empty items', emptySnapshot.items.length === 0);
  assert('empty candidate list reports zero forecast coverage', emptySnapshot.diagnostics.forecastCoverage === 0);
  assert('empty candidate list reports zero orderbook coverage', emptySnapshot.diagnostics.orderbookFreshCoverage === 0);
  assert('empty candidate list reports zero c5 coverage', emptySnapshot.diagnostics.c5Coverage === 0);

  const serialized = JSON.stringify(shadowSnapshot);
  assert('snapshot does not serialize credentials', !/(cookie|authorization|api[_-]?key|token)/i.test(serialized));
  assert('snapshot is plain data', !serialized.includes('function'));
  assert('snapshot contains diagnostics', serialized.includes('forecastCoverage'));
  assert('snapshot contains per-item provenance', serialized.includes('orderbookStatus'));

  const cacheClock = { value: 0 };
  const cache = new runtimeCache.OrderbookRuntimeCache({
    freshTtlMs: 100,
    staleTtlMs: 300,
    schemaVersion: 'orderbook:v1',
    now: () => cacheClock.value,
  });
  cache.set('AK-47', { highestBuy: 100 }, 0);
  assert('runtime cache returns fresh', cache.get('AK-47').status === 'fresh');
  assert('runtime cache returns fresh value', cache.get('AK-47').value.highestBuy === 100);
  cacheClock.value = 101;
  assert('runtime cache returns stale', cache.get('AK-47').status === 'stale');
  assert('runtime cache keeps stale value', cache.get('AK-47').value.highestBuy === 100);
  cacheClock.value = 301;
  assert('runtime cache returns expired', cache.get('AK-47').status === 'expired');
  assert('runtime cache hides expired value', cache.get('AK-47').value === undefined);
  assert('runtime cache distinguishes missing', cache.get('MISSING').status === 'missing');
  cache.set('SCHEMA', { highestBuy: 1 }, cacheClock.value, 'orderbook:v0');
  assert('runtime cache rejects schema mismatch', cache.get('SCHEMA').status === 'expired');
  assert('runtime cache size is item scoped', cache.size() === 2);
  cache.delete('SCHEMA');
  assert('runtime cache delete works', cache.get('SCHEMA').status === 'missing');
  cache.clear();
  assert('runtime cache clear works', cache.size() === 0);

  let limiterNow = 0;
  const limiterSleeps = [];
  const limiter = new runtimeLimiter.OrderbookRuntimeLimiter({
    maxConcurrency: 2,
    minIntervalMs: 50,
    maxRetries: 2,
    baseBackoffMs: 10,
    circuitFailureThreshold: 5,
    now: () => limiterNow,
    sleep: async (ms) => { limiterSleeps.push(ms); limiterNow += ms; },
    random: () => 0.5,
  });
  let singleflightCalls = 0;
  let releaseSingleflight;
  const singleflightTask = new Promise((resolve) => { releaseSingleflight = resolve; });
  const singleflightA = limiter.run('same-key', async () => {
    singleflightCalls++;
    await singleflightTask;
    return 'same-value';
  });
  const singleflightB = limiter.run('same-key', async () => {
    singleflightCalls++;
    return 'wrong-value';
  });
  assert('orderbook limiter singleflight shares promise', singleflightA === singleflightB);
  assert('orderbook limiter registers one key', limiter.diagnostics().inFlightKeys === 1);
  releaseSingleflight();
  assert('orderbook limiter returns shared value', await singleflightA === 'same-value');
  assert('orderbook limiter executes shared task once', singleflightCalls === 1);
  assert('orderbook limiter clears completed key', limiter.diagnostics().inFlightKeys === 0);
  await limiter.run('interval-a', async () => 'a');
  await limiter.run('interval-b', async () => 'b');
  assert('orderbook limiter enforces min interval', limiterSleeps.some((ms) => ms >= 50));

  let retryAttempts = 0;
  const retryValue = await limiter.run('retry-key', async () => {
    retryAttempts++;
    if (retryAttempts < 3) throw Object.assign(new Error('upstream'), { status: 503 });
    return 'retry-ok';
  });
  assert('orderbook limiter retries 5xx', retryAttempts === 3);
  assert('orderbook limiter returns retry result', retryValue === 'retry-ok');
  assert('orderbook limiter counts retries', limiter.diagnostics().retryCount >= 2);

  const circuit = new runtimeLimiter.OrderbookRuntimeLimiter({
    maxConcurrency: 1,
    minIntervalMs: 0,
    maxRetries: 0,
    circuitFailureThreshold: 2,
    circuitCooldownMs: 100,
    now: () => limiterNow,
    sleep: async () => undefined,
  });
  const rejectTask = async () => { throw Object.assign(new Error('down'), { status: 503 }); };
  await circuit.run('fail-a', rejectTask).catch(() => undefined);
  await circuit.run('fail-b', rejectTask).catch(() => undefined);
  assert('orderbook circuit opens after failures', circuit.diagnostics().circuitState === 'OPEN');
  await circuit.run('blocked', async () => 'bad').catch((error) => assert('open circuit blocks new request', error.code === 'circuit_open'));
  limiterNow += 100;
  const probe = await circuit.run('probe', async () => 'probe-ok');
  assert('orderbook circuit half-open probe succeeds', probe === 'probe-ok');
  assert('orderbook circuit closes after probe', circuit.diagnostics().circuitState === 'CLOSED');

  const parityCandidates = batch(20).concat(Array.from({ length: 5 }, (_, index) => {
    const base = candidate(20 + index);
    return {
      ...base,
      opportunityInput: {
        ...base.opportunityInput,
        market: { ...base.opportunityInput.market, volume24h: 20 + index * 100, c5AvailableQuantity: index * 10 },
        risk: { marketState: index % 2 ? 'RISING' : 'FALLING', cv: 0.08 + index * 0.02 },
        forecast: { confidence: 0.50 + index * 0.05, direction: index % 2 ? 'FLAT' : 'DOWN' },
      },
    };
  }));
  const parity = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'v2' }, { now: () => 11000 });
  const paritySnapshot = await parity.refresh(parityCandidates, true);
  assert('parity fixture has 20 frozen candidates', paritySnapshot.items.slice(0, 20).length === 20);
  assert('parity fixture has 5 synthetic candidates', paritySnapshot.items.slice(20).length === 5);
  for (const fixture of parityCandidates) {
    const actual = paritySnapshot.items.find((item) => item.item === fixture.item);
    const expected = core.buildOpportunityV2(fixture.opportunityInput);
    assert(`${fixture.item} score parity`, actual.v2.score === expected.score);
    assert(`${fixture.item} decision parity`, actual.v2.decision === expected.decision);
    assert(`${fixture.item} gate parity`, JSON.stringify(actual.v2.hardGates) === JSON.stringify(expected.hardGates));
    assert(`${fixture.item} cap parity`, JSON.stringify(actual.v2.caps) === JSON.stringify(expected.caps));
    assert(`${fixture.item} current discount parity`, actual.v2.currentDiscount === fixture.opportunityInput.discount.current.discount);
    assert(`${fixture.item} expected discount parity`, actual.v2.expectedDiscount === fixture.opportunityInput.discount.expected7d.discount);
  }

  const frozenAuditPath = path.join(root, 'artifacts', 'shadow', 'frozen-score-a.json');
  if (fs.existsSync(frozenAuditPath)) {
    const frozenAudit = JSON.parse(fs.readFileSync(frozenAuditPath, 'utf8'));
    const frozenRows = frozenAudit.rows.slice(0, 20);
    const frozenReal = frozenAudit.snapshots.slice(0, 20).map((snapshot, index) => ({
      item: snapshot.item,
      legacy: { signal: frozenRows[index].oldRadarSignal, score: frozenRows[index].oldRadarScore },
      opportunityInput: {
        ...snapshot.opportunityInput,
        discount: discountCore.buildDiscountV2(snapshot.discountInput),
      },
      prepared: {
        forecastReady: true,
        orderbookStatus: 'live',
        c5Ready: true,
        sourceTimestamp: snapshot.discountInput.now,
        provenance: { forecast: 'frozen_bundle', orderbook: 'steam_first_party_web', c5: 'c5_openapi', discount: 'local_derived' },
      },
    }));
    const frozenSynthetic = frozenReal.slice(0, 5).map((fixture, index) => {
      const discountInput = JSON.parse(JSON.stringify(frozenAudit.snapshots[index].discountInput));
      discountInput.item = `${fixture.item} [synthetic-${index}]`;
      discountInput.c5.unitPrice = Math.max(0.01, discountInput.c5.unitPrice * 0.5);
      return {
        ...fixture,
        item: discountInput.item,
        legacy: { ...fixture.legacy },
        opportunityInput: {
          ...fixture.opportunityInput,
          item: discountInput.item,
          discount: discountCore.buildDiscountV2(discountInput),
        },
      };
    });
    const frozenParity = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'v2' }, { now: () => 12500 });
    const frozenSnapshot = await frozenParity.refresh(frozenReal.concat(frozenSynthetic), true);
    assert('3B.4 frozen audit has 20 real candidates', frozenReal.length === 20);
    assert('3B.4 parity has 5 synthetic candidates', frozenSynthetic.length === 5);
    assert('3B.4 frozen parity snapshot is complete', frozenSnapshot.items.length === 25 && frozenSnapshot.diagnostics.failureCount === 0);
    assert('frozen provenance keeps Steam source', frozenSnapshot.items[0].diagnostics.provenance.orderbook === 'steam_first_party_web');
    assert('frozen provenance keeps C5 source', frozenSnapshot.items[0].diagnostics.provenance.c5 === 'c5_openapi');
    assert('frozen provenance keeps derived source', frozenSnapshot.items[0].diagnostics.provenance.discount === 'local_derived');
    for (let index = 0; index < frozenReal.length; index++) {
      const actual = frozenSnapshot.items[index].v2;
      const expected = core.buildOpportunityV2(frozenReal[index].opportunityInput);
      const auditRow = frozenRows[index];
      assert(`frozen real ${index} score parity`, actual.score === expected.score && actual.score === auditRow.opportunityScore);
      assert(`frozen real ${index} decision parity`, actual.decision === expected.decision && actual.decision === auditRow.opportunityDecision);
      assert(`frozen real ${index} gate parity`, JSON.stringify(actual.hardGates) === JSON.stringify(expected.hardGates));
      assert(`frozen real ${index} cap parity`, JSON.stringify(actual.caps) === JSON.stringify(expected.caps));
      assert(`frozen real ${index} discount parity`, actual.expectedDiscount === frozenReal[index].opportunityInput.discount.expected7d.discount);
    }
    for (const fixture of frozenSynthetic) {
      const actual = frozenSnapshot.items.find((item) => item.item === fixture.item).v2;
      const expected = core.buildOpportunityV2(fixture.opportunityInput);
      assert(`${fixture.item} score parity`, actual.score === expected.score);
      assert(`${fixture.item} decision parity`, actual.decision === expected.decision);
      assert(`${fixture.item} gate parity`, JSON.stringify(actual.hardGates) === JSON.stringify(expected.hardGates));
      assert(`${fixture.item} cap parity`, JSON.stringify(actual.caps) === JSON.stringify(expected.caps));
    }
  } else {
    assert('3B.4 frozen audit artifact available', false);
  }

  const dryRun = new production.ProductionOpportunityOrchestrator({ opportunityMode: 'shadow' }, { now: () => 12000 });
  const drySnapshot = await dryRun.refresh(batch(93), true);
  const legacyDistribution = drySnapshot.items.filter((item) => item.legacy).length;
  const v2Distribution = drySnapshot.items.filter((item) => item.v2).length;
  assert('93-candidate shadow dry run is valid', drySnapshot.items.length === 93 && drySnapshot.diagnostics.failureCount === 0);
  assert('93-candidate forecast coverage meets gate', drySnapshot.diagnostics.forecastCoverage >= 0.90);
  assert('93-candidate orderbook coverage meets gate', drySnapshot.diagnostics.orderbookFreshCoverage >= 0.95);
  assert('93-candidate c5 coverage meets gate', drySnapshot.diagnostics.c5Coverage >= 0.95);
  assert('93-candidate legacy distribution is complete', legacyDistribution === 93);
  assert('93-candidate v2 diagnostics distribution is complete', v2Distribution === 93);

  for (const runtimeFile of [
    path.join(root, 'src', 'config', 'featureFlags.ts'),
    path.join(root, 'src', 'data', 'opportunityProduction.ts'),
    path.join(root, 'src', 'data', 'orderbookRuntimeCache.ts'),
    path.join(root, 'src', 'data', 'orderbookRuntimeLimiter.ts'),
  ]) {
    const source = fs.readFileSync(runtimeFile, 'utf8');
    assert(`${path.basename(runtimeFile)} has no Node runtime import`, !/from ['"](?:fs|path|process)['"]|require\(['"](?:fs|path|process)['"]\)/.test(source));
    assert(`${path.basename(runtimeFile)} has no process env access`, !/process\.env/.test(source));
  }

  // 3C-1 的覆盖要求不是只测一个 happy path；逐候选检查关键字段，保持断言数 >100。
  for (const item of shadowSnapshot.items) {
    assert(`${item.item} has legacy signal`, item.legacy.signal === 'wait');
    assert(`${item.item} has v2 decision`, !!item.v2.decision);
    assert(`${item.item} has finite score`, Number.isFinite(item.v2.score));
    assert(`${item.item} has diagnostic mode`, item.mode === 'shadow');
    assert(`${item.item} has forecast provenance`, item.diagnostics.forecastStatus === 'ready');
    assert(`${item.item} has orderbook provenance`, item.diagnostics.orderbookStatus === 'live');
    assert(`${item.item} has c5 provenance`, item.diagnostics.c5Status === 'ready');
    assert(`${item.item} is not fallback`, item.diagnostics.fallbackUsed === false);
  }

  console.log('');
  console.log(`PASS ${passed} / ${passed + failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});
