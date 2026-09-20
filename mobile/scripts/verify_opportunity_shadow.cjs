// V3-PHASE-3B：Shadow helper 纯函数验证，不访问网络、不触发生产 Radar。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.verify-opportunity-shadow');
const source = path.join(root, 'src', 'core', 'opportunityShadow.ts');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + JSON.stringify(source), { cwd: root, stdio: 'pipe', shell: true });
const shadow = require(path.join(outDir, 'core', 'opportunityShadow.js'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'opportunity_shadow', 'cases.json'), 'utf8'));

let passed = 0;
let failed = 0;
function assert(name, condition, extra) {
  if (condition) {
    passed++;
    console.log('PASS ' + name);
  } else {
    failed++;
    console.log('FAIL ' + name + (extra == null ? '' : '  got: ' + extra));
  }
}
function opportunity(decision, extra = {}) {
  return {
    item: 'X', score: extra.score ?? 80, decision, suggestedMaxBudget: extra.budget ?? 80,
    breakdown: { discount: 80, liquidity: 80, volume: 50, c5Supply: 50, risk: 70, forecast: 60, dataQuality: 80 },
    hardGates: extra.hardGates ?? [], caps: extra.caps ?? [], reasons: ['discount_attractive'],
    warnings: extra.warnings ?? [], confidence: { marketData: 0.9, forecast: 0.8, overall: 0.87 },
  };
}
function discount(extra = {}) {
  const market = { score: 0.9, stale: false, reasons: [] };
  const forecast = { available: true, score: 0.8, reasons: [] };
  return {
    item: 'X', quantity: 10,
    current: { grossPerUnit: 10, netPerUnit: 8.696, totalNet: 86.96, discount: 0.8, filledQuantity: 10, requestedQuantity: 10, liquidationCoverage: 1, filledGross: 100, filledNet: 86.96 },
    conservative7d: { grossPerUnit: 8, netPerUnit: 6.9568, totalNet: 69.568, discount: 0.8 },
    expected7d: { grossPerUnit: 7.5, netPerUnit: 6.522, totalNet: 65.22, discount: 0.75 },
    listing7d: { grossPerUnit: 8, netPerUnit: 6.9568, totalNet: 69.568, discount: 0.7 },
    futureModel: { orderbookPredicted: false, liquidityGuaranteed: false, usesCurrentBuySellRatio: true, currentBuySellRatio: 0.99, ratioKind: 'current_market_heuristic' },
    liquidity: { spread: 0.1, spreadPct: 0.01, executableQuantity: 100, executableBudget: 100, filledQuantity: 10, unfilledQuantity: 0 },
    currentLiquidityCapacity: { scope: 'current_market_structure', executableQuantity: 100, executableBudget: 100 },
    marketDataQuality: market, forecastQuality: forecast,
    feeModel: { name: 'estimatedSteamNetReceive', kind: 'approximate', exact: false, receiveRatio: 0.8696, unit: 'CNY', note: 'fixture' },
    quality: { score: 0.9, stale: false, reasons: [], marketData: market, forecast, overall: 0.87 }, warnings: [], ...extra,
  };
}
function diagnostics(extra = {}) {
  return { orderbookOk: true, discountOk: true, opportunityOk: true, latencyMs: 10, missingFields: [], ...extra };
}

for (const c of fixture.disagreementCases) {
  assert(`mapping ${c.old}->${c.decision}`, shadow.classifyDisagreement(c.old, opportunity(c.decision)) === c.expected);
}
assert('old buy mapping positive', shadow.oldRadarToClass('buy') === 'positive');
assert('old wait mapping neutral', shadow.oldRadarToClass('wait') === 'neutral');
assert('old avoid mapping negative', shadow.oldRadarToClass('avoid') === 'negative');
assert('old unknown mapping unknown', shadow.oldRadarToClass('something') === 'unknown');
assert('unknown agreement degrades to other', shadow.classifyDisagreement('unknown', opportunity('watch')) === 'DISAGREE_OTHER');
assert('approx fee cap classification', shadow.classifyDisagreement('wait', opportunity('watch', { caps: ['approximate_fee_low_price_cap_watch'] })) === 'AGREE_NEUTRAL');
assert('chaos cap classification for unknown', shadow.classifyDisagreement('unknown', opportunity('watch', { caps: ['chaos_cap_watch'] })) === 'NEW_CAPPED_BY_CHAOS');
assert('stale cap classification for unknown', shadow.classifyDisagreement('unknown', opportunity('watch', { caps: ['market_data_stale'] })) === 'NEW_CAPPED_BY_STALE');
assert('liquidity cap classification for unknown', shadow.classifyDisagreement('unknown', opportunity('avoid', { hardGates: ['current_capacity_too_small'] })) === 'NEW_AVOID_LOW_CAPACITY');

const row = shadow.buildShadowRow({
  item: 'Dreams & Nightmares Case',
  oldRadar: { signal: 'buy', score: 82 },
  discount: discount(),
  opportunity: opportunity('buy', { score: 78, budget: 66 }),
  volume24h: 5000,
  c5AvailableQuantity: 200,
  marketState: 'STABLE',
  diagnostics: diagnostics(),
});
assert('row item', row.item === 'Dreams & Nightmares Case');
assert('row old signal', row.oldRadarSignal === 'buy' && row.oldRadarClass === 'positive');
assert('row new decision', row.opportunityDecision === 'buy' && row.opportunityScore === 78);
assert('row budget', row.suggestedMaxBudget === 66 && row.currentLiquidityCapacity === 100);
assert('row discounts', row.conservativeDiscount === 0.8 && row.expectedDiscount === 0.75 && row.listingDiscount === 0.7);
assert('row market values', row.volume24h === 5000 && row.c5AvailableQuantity === 200 && row.marketState === 'STABLE');
assert('row quality values', row.marketDataQuality === 0.9 && row.forecastQuality === 0.8 && row.forecastAvailable === true);
assert('row diagnostics copied', row.diagnostics.orderbookOk && row.diagnostics.latencyMs === 10);
assert('row arrays copied', row.hardGates !== opportunity('buy').hardGates && row.reasons.includes('discount_attractive'));
assert('row JSON has no credential fields', !/app[-_]?key|cookie|token|session/i.test(JSON.stringify(row)));

const rows = [
  row,
  shadow.buildShadowRow({ item: 'A', oldRadar: { signal: 'wait', score: 40 }, discount: discount(), opportunity: opportunity('excellent', { score: 95 }), diagnostics: diagnostics({ latencyMs: 30 }) }),
  shadow.buildShadowRow({ item: 'B', oldRadar: { signal: 'avoid', score: 10 }, discount: discount(), opportunity: opportunity('avoid', { score: 10 }), diagnostics: diagnostics({ latencyMs: 20, stale: true }) }),
  shadow.buildShadowRow({ item: 'C', oldRadar: { signal: 'buy', score: 80 }, discount: discount(), opportunity: opportunity('watch', { score: 80, caps: ['chaos_cap_watch'] }), diagnostics: diagnostics({ latencyMs: 50, missingFields: ['forecast', 'volume24h'] }) }),
];
const sorted = shadow.sortShadowRows(rows);
assert('sort top score first', sorted[0].opportunityScore === 95 && sorted[0].item === 'A');
assert('sort tie deterministic by item', shadow.sortShadowRows([row, { ...row, item: 'AA', opportunityScore: row.opportunityScore }])[0].item === 'AA');
assert('topN limit', shadow.topShadowRows(rows, 2).length === 2);
const summary = shadow.summarizeShadowRows(rows, 1234);
assert('summary total', summary.totalItems === 4);
assert('summary success', summary.successItems === 4 && summary.successRate === 1);
assert('summary duration', summary.totalDurationMs === 1234);
assert('summary avg latency', summary.avgLatencyMs === 27.5);
assert('summary p50', summary.p50LatencyMs === 20);
assert('summary p95', summary.p95LatencyMs === 50);
assert('summary stale', summary.staleCount === 1);
assert('summary missing forecast', summary.missingForecastCount === 1);
assert('summary missing volume', summary.missingVolumeCount === 1);
assert('summary old distribution', summary.oldDistribution.buy === 2 && summary.oldDistribution.wait === 1 && summary.oldDistribution.avoid === 1);
assert('summary new distribution', summary.newDistribution.buy === 1 && summary.newDistribution.excellent === 1 && summary.newDistribution.watch === 1 && summary.newDistribution.avoid === 1);
assert('summary disagreements', summary.disagreementDistribution.AGREE_POSITIVE >= 1 && summary.disagreementDistribution.AGREE_NEGATIVE >= 1);

const failedRow = shadow.buildShadowRow({
  item: 'Failed Case',
  oldRadar: { signal: 'wait', score: 20 },
  discount: discount(),
  opportunity: opportunity('avoid', { hardGates: ['current_capacity_too_small'], warnings: ['future_orderbook_not_predicted'] }),
  diagnostics: diagnostics({ orderbookOk: false, discountOk: false, opportunityOk: false, http429: true, missingFields: ['c5.unitPrice', 'forecast', 'c5AvailableQuantity'] }),
});
const failedSummary = shadow.summarizeShadowRows([...rows, failedRow]);
assert('summary failed item', failedSummary.failedItems === 1);
assert('summary orderbook failure', failedSummary.orderbookFailureCount === 1);
assert('summary discount failure', failedSummary.discountFailureCount === 1);
assert('summary opportunity failure', failedSummary.opportunityFailureCount === 1);
assert('summary 429 count', failedSummary.http429Count === 1 && failedSummary.http429Rate === 0.2);
assert('summary c5 failure', failedSummary.c5FailureCount === 1);
assert('summary missing c5 supply', failedSummary.missingC5SupplyCount === 1);
assert('failed row disagreement uses low capacity gate', failedRow.disagreement === 'NEW_AVOID_LOW_CAPACITY');
assert('failed row preserves 429 diagnostic', failedRow.diagnostics.http429 === true);
assert('failed row preserves future warning', failedRow.warnings.includes('future_orderbook_not_predicted'));
assert('budget never exceeds capacity', row.suggestedMaxBudget <= row.currentLiquidityCapacity);
assert('row missing fields empty', row.diagnostics.missingFields.length === 0);
assert('summary total includes failed row', failedSummary.totalItems === 5);
assert('summary success rate is finite', Number.isFinite(failedSummary.successRate));
assert('top rows stable for repeated sort', JSON.stringify(shadow.sortShadowRows(rows).map((x) => x.item)) === JSON.stringify(shadow.sortShadowRows(rows).map((x) => x.item)));
assert('bottom row is avoid', shadow.sortShadowRows(rows).at(-1).opportunityDecision === 'avoid');
assert('disagreement code stable', row.disagreement === 'AGREE_POSITIVE');
assert('unknown old signal remains unknown', shadow.buildShadowRow({ item: 'Unknown', discount: discount(), opportunity: opportunity('watch'), diagnostics: diagnostics() }).oldRadarClass === 'unknown');
assert('missing latency p50 safe', shadow.summarizeShadowRows([{ ...row, diagnostics: diagnostics({ latencyMs: undefined }) }]).p50LatencyMs === 0);
assert('missing latency avg safe', shadow.summarizeShadowRows([{ ...row, diagnostics: diagnostics({ latencyMs: undefined }) }]).avgLatencyMs === 0);
assert('topN zero empty', shadow.topShadowRows(rows, 0).length === 0);
assert('topN over limit capped', shadow.topShadowRows(rows, 100).length === rows.length);
assert('serialized row has no app key', !JSON.stringify(row).includes('C5_APP_KEY'));

async function testBounded() {
  let active = 0;
  let peak = 0;
  const result = await shadow.mapBounded([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });
  assert('bounded result order', JSON.stringify(result) === JSON.stringify([2, 4, 6, 8, 10, 12]));
  assert('bounded concurrency', peak <= 2, peak);
}

testBounded().then(() => {
  console.log('');
  console.log('PASS ' + passed + ' / ' + (passed + failed));
  if (failed > 0) {
    console.log(failed + ' FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL OPPORTUNITY SHADOW ASSERTIONS PASSED');
  }
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
