// V3-PHASE-3A：Opportunity Engine v2 纯决策层验证。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.verify-opportunity-v2');
const core = (name) => path.join(root, 'src', 'core', name);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + [
  core('opportunityV2.ts'), core('types/opportunity.ts'), core('discountV2.ts'), core('liquidity.ts'), core('marketQuality.ts'), core('fees.ts'), core('profit.ts'),
].map(JSON.stringify).join(' '), { cwd: root, stdio: 'pipe', shell: true });

const opportunity = require(path.join(outDir, 'core', 'opportunityV2.js'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'opportunity_v2', 'cases.json'), 'utf8'));

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
function near(a, b, epsilon = 1e-9) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
}
function finiteDeep(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteDeep);
  if (value && typeof value === 'object') return Object.values(value).every(finiteDeep);
  return true;
}

function makeDiscount(spec = {}) {
  const requested = spec.requestedQuantity ?? 10;
  const coverage = spec.coverage ?? 1;
  const marketScore = spec.marketScore ?? 0.95;
  const forecastAvailable = spec.forecastAvailable !== false;
  const forecastScore = spec.forecastConfidence ?? 0.90;
  const capacity = spec.capacity ?? 1000;
  const spreadPct = spec.spreadPct ?? 0.01;
  const expected = spec.expected ?? 0.75;
  const conservative = spec.conservative ?? 0.80;
  const price = spec.price ?? 10;
  const quality = { score: marketScore, stale: spec.stale === true, reasons: [], marketData: { score: marketScore, stale: spec.stale === true, reasons: [] }, forecast: { available: forecastAvailable, ...(forecastAvailable ? { score: forecastScore } : {}), reasons: [] }, overall: marketScore };
  return {
    item: 'Fixture Case',
    quantity: requested,
    current: {
      grossPerUnit: price,
      netPerUnit: price * 0.8696,
      totalNet: price * requested * 0.8696,
      discount: 0.80,
      filledQuantity: Math.floor(requested * coverage),
      requestedQuantity: requested,
      liquidationCoverage: coverage,
      filledGross: price * requested * coverage,
      filledNet: price * requested * coverage * 0.8696,
      filledDiscount: 0.80,
      fullPositionDiscount: coverage === 1 ? 0.80 : undefined,
    },
    conservative7d: conservative == null ? undefined : { grossPerUnit: 8, netPerUnit: 6.9568, totalNet: 69.568, discount: conservative },
    expected7d: expected == null ? undefined : { grossPerUnit: 7.5, netPerUnit: 6.522, totalNet: 65.22, discount: expected },
    listing7d: { grossPerUnit: 8, netPerUnit: 6.9568, totalNet: 69.568, discount: 0.70 },
    futureModel: { orderbookPredicted: false, liquidityGuaranteed: false, usesCurrentBuySellRatio: true, currentBuySellRatio: 0.99, ratioKind: 'current_market_heuristic' },
    liquidity: { spread: price * spreadPct, spreadPct, currentVwap: price, slippagePct: 0, executableQuantity: Math.floor(capacity / 1.01), executableBudget: capacity, filledQuantity: Math.floor(requested * coverage), unfilledQuantity: Math.ceil(requested * (1 - coverage)) },
    currentLiquidityCapacity: { scope: 'current_market_structure', executableQuantity: Math.floor(capacity / 1.01), executableBudget: capacity },
    marketDataQuality: { score: marketScore, stale: spec.stale === true, reasons: [] },
    forecastQuality: { available: forecastAvailable, ...(forecastAvailable ? { score: forecastScore } : {}), reasons: [] },
    feeModel: { name: 'estimatedSteamNetReceive', kind: spec.feeExact === false ? 'approximate' : 'exact', exact: spec.feeExact !== false, receiveRatio: 0.8696, unit: 'CNY', note: 'fixture' },
    quality,
    warnings: [],
  };
}

function makeInput(spec = {}) {
  return {
    item: 'Fixture Case',
    discount: makeDiscount(spec),
    market: {
      ...(spec.volumeMissing ? {} : { volume24h: spec.volume24h ?? 5000 }),
      ...(spec.c5Missing ? {} : { c5AvailableQuantity: spec.c5Quantity ?? 200 }),
      highestBuy: spec.price ?? 10,
      lowestSell: (spec.price ?? 10) * (1 + (spec.spreadPct ?? 0.01)),
    },
    risk: { marketState: spec.marketState ?? 'STABLE', cv: spec.cv ?? 0.03 },
    ...(spec.forecastAvailable === false ? {} : { forecast: { confidence: spec.forecastConfidence ?? 0.90, direction: 'UP' } }),
    feeModel: { kind: spec.feeExact === false ? 'approximate' : 'exact', exact: spec.feeExact !== false },
    evaluationBudget: spec.evaluationBudget,
  };
}

const cases = fixture.cases.map((spec) => ({ spec, result: opportunity.buildOpportunityV2(makeInput(spec)) }));
for (const { spec, result } of cases) {
  assert(`${spec.name}.finite`, finiteDeep(result));
  assert(`${spec.name}.score range`, result.score >= 0 && result.score <= 100);
  assert(`${spec.name}.budget nonnegative`, result.suggestedMaxBudget >= 0);
  assert(`${spec.name}.all breakdown range`, Object.values(result.breakdown).every((x) => x >= 0 && x <= 100));
  assert(`${spec.name}.confidence range`, result.confidence.marketData >= 0 && result.confidence.marketData <= 1 && result.confidence.overall >= 0 && result.confidence.overall <= 1);
  assert(`${spec.name}.hard gates stable array`, Array.isArray(result.hardGates) && Array.isArray(result.caps));
  assert(`${spec.name}.reasons are codes`, result.reasons.every((x) => /^[a-z0-9_]+$/.test(x)));
  assert(`${spec.name}.warnings are codes`, result.warnings.every((x) => /^[a-z0-9_]+$/.test(x)));
  if (spec.expectedDecision) {
    if (spec.expectedDecision === 'not_avoid') assert(`${spec.name}.not avoid`, result.decision !== 'avoid', result.decision);
    else if (spec.expectedDecision === 'not_excellent') assert(`${spec.name}.not excellent`, result.decision !== 'excellent', result.decision);
    else assert(`${spec.name}.decision=${spec.expectedDecision}`, result.decision === spec.expectedDecision, result.decision);
  }
}

const ideal = cases.find((x) => x.spec.name === 'ideal').result;
assert('ideal excellent score threshold', ideal.score >= 85);
assert('ideal has future boundary warning', ideal.warnings.includes('future_orderbook_not_predicted') && ideal.warnings.includes('future_liquidity_not_guaranteed'));
assert('thin has capacity hard gate', cases.find((x) => x.spec.name === 'thin_liquidity').result.hardGates.includes('current_capacity_too_small'));
assert('bad discount has expected gate', cases.find((x) => x.spec.name === 'bad_discount').result.hardGates.includes('expected_discount_not_viable'));
assert('chaos cap is watch', cases.find((x) => x.spec.name === 'chaos').result.caps.includes('chaos_cap_watch'));
assert('low fee cap is watch', cases.find((x) => x.spec.name === 'low_approx_fee').result.caps.includes('approximate_fee_low_price_cap_watch'));
assert('stale cap is watch', cases.find((x) => x.spec.name === 'stale').result.caps.includes('market_data_stale'));
assert('low quality gate', cases.find((x) => x.spec.name === 'low_market_quality').result.hardGates.includes('market_data_quality_low'));
assert('forecast missing cap', cases.find((x) => x.spec.name === 'forecast_missing').result.caps.includes('forecast_missing_cap_watch'));
assert('volume missing neutral warning', cases.find((x) => x.spec.name === 'volume_missing').result.warnings.includes('volume_missing'));
assert('c5 missing neutral warning', cases.find((x) => x.spec.name === 'c5_supply_missing').result.warnings.includes('c5_supply_missing'));
assert('partial coverage cap', cases.find((x) => x.spec.name === 'partial_coverage').result.caps.includes('coverage_too_low_cap_watch'));

// 单调性：容量增加不降低分数，折扣变差不提高分数，spread 变差不提高 liquidity。
const capLow = opportunity.buildOpportunityV2(makeInput({ capacity: 100 }));
const capHigh = opportunity.buildOpportunityV2(makeInput({ capacity: 1000 }));
assert('capacity monotonic score', capHigh.score >= capLow.score, `${capLow.score} -> ${capHigh.score}`);
const discountGood = opportunity.buildOpportunityV2(makeInput({ conservative: 0.75, expected: 0.70 }));
const discountBad = opportunity.buildOpportunityV2(makeInput({ conservative: 0.90, expected: 0.95 }));
assert('discount monotonic score', discountGood.score >= discountBad.score, `${discountGood.score} -> ${discountBad.score}`);
const spreadTight = opportunity.buildOpportunityV2(makeInput({ spreadPct: 0.01 }));
const spreadWide = opportunity.buildOpportunityV2(makeInput({ spreadPct: 0.08 }));
assert('spread monotonic liquidity', spreadTight.breakdown.liquidity >= spreadWide.breakdown.liquidity);
const qualityGood = opportunity.buildOpportunityV2(makeInput({ marketScore: 0.95 }));
const qualityBad = opportunity.buildOpportunityV2(makeInput({ marketScore: 0.65 }));
assert('quality monotonic score', qualityGood.score >= qualityBad.score);

// Hard gate always beats a high raw score; score still remains finite and inspectable.
const gate = opportunity.buildOpportunityV2(makeInput({ capacity: 10, conservative: 0.70, expected: 0.70 }));
assert('hard gate beats raw score', gate.decision === 'avoid' && gate.score > 50);

// Weight and curve audit.
assert('weights sum 1', near(Object.values(opportunity.DEFAULT_OPPORTUNITY_CONFIG.weights).reduce((a, b) => a + b, 0), 1));
assert('discount curve lower is better', opportunity.scoreLowerBetter(0.75, opportunity.DEFAULT_OPPORTUNITY_CONFIG.discountBands) === 100 && opportunity.scoreLowerBetter(1.0, opportunity.DEFAULT_OPPORTUNITY_CONFIG.discountBands) === 10);
assert('discount curve linear interpolation', near(opportunity.scoreLowerBetter(0.785, opportunity.DEFAULT_OPPORTUNITY_CONFIG.discountBands), 92.5));
assert('volume curve higher is better', opportunity.scoreHigherBetter(10000, opportunity.DEFAULT_OPPORTUNITY_CONFIG.volumeBands) === 100 && opportunity.scoreHigherBetter(5, opportunity.DEFAULT_OPPORTUNITY_CONFIG.volumeBands) === 0);
assert('all fixture decisions finite', cases.every((x) => Number.isFinite(x.result.score) && Number.isFinite(x.result.suggestedMaxBudget)));

console.log('');
console.log('PASS ' + passed + ' / ' + (passed + failed));
if (failed > 0) {
  console.log(failed + ' FAILED');
  process.exitCode = 1;
} else {
  console.log('ALL OPPORTUNITY V2 ASSERTIONS PASSED');
}

