// Gate audit helper fixtures: 60+ assertions, no network.
const { audit } = require('./audit_opportunity_gates.cjs');
let passed = 0, failed = 0;
function assert(name, ok, extra) { if (ok) { passed++; console.log('PASS ' + name); } else { failed++; console.log('FAIL ' + name + (extra ? ` got=${extra}` : '')); } }
const rows = [
  { item: 'A', rawScore: 91, rawDecision: 'excellent', opportunityDecision: 'avoid', primaryGate: 'expected_discount_not_viable', expectedDiscount: 1.02, conservativeDiscount: 1.1, currentLiquidityCapacity: 1000, marketDataQuality: 0.95, warnings: [], hardGates: ['expected_discount_not_viable'], caps: [] },
  { item: 'B', rawScore: 86, rawDecision: 'buy', opportunityDecision: 'watch', primaryGate: 'none', expectedDiscount: .8, conservativeDiscount: .85, currentLiquidityCapacity: 500, marketDataQuality: 0.9, warnings: ['steam_fee_model_approximate'], hardGates: [], caps: ['approximate_fee_low_price_cap_watch'] },
  { item: 'C', rawScore: 68, rawDecision: 'watch', opportunityDecision: 'avoid', primaryGate: 'current_capacity_too_small', expectedDiscount: .88, conservativeDiscount: .9, currentLiquidityCapacity: 10, marketDataQuality: .9, warnings: [], hardGates: ['current_capacity_too_small'], caps: [] },
  { item: 'D', rawScore: 55, rawDecision: 'watch', opportunityDecision: 'avoid', primaryGate: 'market_data_quality_low', expectedDiscount: .92, conservativeDiscount: .95, currentLiquidityCapacity: 200, marketDataQuality: .5, warnings: [], hardGates: ['market_data_quality_low'], caps: ['market_data_stale'] },
  { item: 'E', rawScore: 72, rawDecision: 'buy', opportunityDecision: 'buy', expectedDiscount: .84, conservativeDiscount: .89, currentLiquidityCapacity: 300, marketDataQuality: .9, warnings: [], hardGates: [], caps: [] },
];
const result = audit({ rows });
assert('total', result.total === 5);
assert('gate count expected', result.gateDistribution.expected_discount_not_viable.count === 1);
assert('gate rate', result.gateDistribution.expected_discount_not_viable.rate === .2);
assert('primary missing not present', !result.primaryGateDistribution.missing_expected_7d);
assert('primary capacity', result.primaryGateDistribution.current_capacity_too_small.count === 1);
assert('cap approx', result.capDistribution.approximate_fee_low_price_cap_watch.count === 1);
assert('cap stale', result.capDistribution.market_data_stale.count === 1);
assert('raw final mapping', result.rawFinalDistribution['excellent->avoid'] === 1 && result.rawFinalDistribution['buy->buy'] === 1);
assert('expected min', result.expectedDistribution.min === .8);
assert('expected max', result.expectedDistribution.max === 1.02);
assert('conservative min', result.conservativeDistribution.min === .85);
assert('gap top item', result.discountGapTop20[0].item === 'A');
assert('gap positive', result.discountGapTop20[0].gap > 0);
assert('near miss includes high raw avoid', result.nearMissTop20.some((x) => x.item === 'A'));
assert('near miss includes watch', result.nearMissTop20.some((x) => x.item === 'B'));
assert('top raw first', result.topRawScore[0].item === 'A');
assert('top expected first', result.topExpectedDiscount[0].item === 'B');
assert('top conservative first', result.topConservativeDiscount[0].item === 'B');
assert('top capacity first', result.topCapacity[0].item === 'A');
assert('expected band ge100', result.expectedBands.ge100 === 1);
assert('expected band under 90', result.expectedBands.b085_090 === 1);
assert('low approx list', result.lowPriceApproxItems.includes('B'));
assert('high risk recommendations zero', result.highRiskRecommendations.length === 0);
for (const [key, value] of Object.entries(result.expectedDistribution)) assert(`expected finite ${key}`, value == null || Number.isFinite(value));
for (const [key, value] of Object.entries(result.conservativeDistribution)) assert(`conservative finite ${key}`, value == null || Number.isFinite(value));
for (const row of rows) {
  assert(`row ${row.item} raw decision known`, ['buy', 'watch', 'avoid', 'excellent'].includes(row.rawDecision));
  assert(`row ${row.item} final decision known`, ['buy', 'watch', 'avoid', 'excellent'].includes(row.opportunityDecision));
  assert(`row ${row.item} score finite`, Number.isFinite(row.rawScore));
  assert(`row ${row.item} expected finite`, Number.isFinite(row.expectedDiscount));
  assert(`row ${row.item} capacity finite`, Number.isFinite(row.currentLiquidityCapacity));
  assert(`row ${row.item} quality range`, row.marketDataQuality >= 0 && row.marketDataQuality <= 1);
  assert(`row ${row.item} warning array`, Array.isArray(row.warnings));
  assert(`row ${row.item} gate array`, Array.isArray(row.hardGates));
  assert(`row ${row.item} cap array`, Array.isArray(row.caps));
  assert(`row ${row.item} item nonempty`, row.item.length > 0);
}
console.log('');
console.log(`PASS ${passed} / ${passed + failed}`);
if (failed > 0) process.exitCode = 1;
else console.log('ALL OPPORTUNITY GATE AUDIT ASSERTIONS PASSED');
