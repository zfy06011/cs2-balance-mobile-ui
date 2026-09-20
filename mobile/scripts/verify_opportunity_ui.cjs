// 3C-2 UI selector / formatter / state contract tests。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(os.tmpdir(), 'yu-e-verify-opportunity-ui');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--ignoreConfig', '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--outDir', outDir,
  path.join(root, 'src', 'ui', 'opportunity', 'opportunityFormatters.ts'),
  path.join(root, 'src', 'ui', 'opportunity', 'opportunityLabels.ts'),
  path.join(root, 'src', 'ui', 'opportunity', 'opportunityViewModel.ts'),
], { cwd: root, stdio: 'pipe' });

const formatters = require(path.join(outDir, 'ui', 'opportunity', 'opportunityFormatters.js'));
const labels = require(path.join(outDir, 'ui', 'opportunity', 'opportunityLabels.js'));
// Selector tests use the static Chinese map; stub SQLite-backed runtime name hydration.
const Module = require('module');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request.includes('zhNames')) return { zhNameOf: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
const viewModel = require(path.join(outDir, 'ui', 'opportunity', 'opportunityViewModel.js'));
Module._load = originalLoad;

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

function baseV2(overrides = {}) {
  return {
    score: 82,
    decision: 'buy',
    c5BuyPrice: 7,
    suggestedMaxBudget: 260,
    currentDiscount: 0.88,
    conservativeDiscount: 0.91,
    expectedDiscount: 0.86,
    listingDiscount: 0.82,
    spreadPct: 0.015,
    executableBudget: 240,
    marketDataQuality: 0.95,
    forecastQuality: 0.88,
    marketState: 'STABLE',
    currentFilledQuantity: 10,
    currentRequestedQuantity: 10,
    liquidationCoverage: 1,
    filledDiscount: 0.88,
    reasons: ['discount_attractive'],
    warnings: ['future_orderbook_not_predicted', 'future_liquidity_not_guaranteed'],
    hardGates: [],
    caps: [],
    ...overrides,
  };
}

function item(name, overrides = {}) {
  return {
    item: name,
    generatedAt: 1000,
    mode: 'v2',
    legacy: {
      signal: 'wait',
      score: 42,
      expectedDiscount: 0.91,
      c5BuyPrice: 8,
      steamSellPrice: 10,
      steamNetReceive: 8.7,
      netProfit: 0.7,
      riskLevel: 'medium',
      liquidity: 'high',
    },
    v2: baseV2(),
    diagnostics: {
      forecastStatus: 'ready',
      orderbookStatus: 'live',
      c5Status: 'ready',
      stale: false,
      fallbackUsed: false,
    },
    ...overrides,
  };
}

function snapshot(items, overrides = {}) {
  return {
    generatedAt: 1000,
    mode: 'v2',
    candidateCount: items.length,
    items,
    diagnostics: {
      forecastCoverage: 1,
      orderbookFreshCoverage: 1,
      c5Coverage: 1,
      failureCount: 0,
      stale: false,
      fallbackCount: 0,
      lastRefreshDurationMs: 3,
    },
    ...overrides,
  };
}

assert('format 0.75 as 7.50 折', formatters.formatDiscount(0.75) === '7.50 折');
assert('format 0.926 as 9.26 折', formatters.formatDiscount(0.926) === '9.26 折');
assert('format 1.00 as 10.00 折', formatters.formatDiscount(1) === '10.00 折');
assert('format zero discount safely', formatters.formatDiscount(0) === '0.00 折');
assert('format undefined as --', formatters.formatDiscount(undefined) === '--');
assert('format null as --', formatters.formatDiscount(null) === '--');
assert('format NaN as --', formatters.formatDiscount(Number.NaN) === '--');
assert('format Infinity as --', formatters.formatDiscount(Number.POSITIVE_INFINITY) === '--');
assert('format negative discount as --', formatters.formatDiscount(-0.1) === '--');
assert('format money zero', formatters.formatMoney(0) === '¥0.00');
assert('format money decimal', formatters.formatMoney(20.2) === '¥20.20');
assert('format money large', formatters.formatMoney(1000) === '¥1000.00');
assert('format money invalid', formatters.formatMoney(Number.NaN) === '--');
assert('format capacity wording', formatters.formatCapacity(240) === '当前可执行容量 ¥240.00');
assert('format capacity invalid', formatters.formatCapacity(-1) === '--');
assert('format spread', formatters.formatSpread(0.015) === '1.50%');
assert('format coverage', formatters.formatCoverage(0.9) === '90%');
assert('freshness fresh is quiet', formatters.formatFreshness('fresh') === '');
assert('freshness stale label', formatters.formatFreshness('stale') === '数据已过期');
assert('freshness fallback label', formatters.formatFreshness('fallback') === '使用最近有效数据');
assert('freshness missing label', formatters.formatFreshness('missing') === '数据暂不可用');
assert('market stable label', formatters.formatMarketState('STABLE') === '稳定');
assert('market chaos label', formatters.formatMarketState('CHAOS') === '波动较大');
assert('market unknown label', formatters.formatMarketState('future_state') === '未知');
assert('known reason translated', labels.labelForCode('discount_attractive', 'reason') === '预计折扣有吸引力');
assert('known gate translated', labels.labelForCode('expected_discount_not_viable', 'gate') === '预计到账不足以覆盖 C5 成本');
assert('known cap translated', labels.labelForCode('market_data_stale', 'cap') === '市场数据已过期');
assert('unknown warning safe fallback', labels.labelForCode('made_up_code', 'warning') === '风险提示');
assert('decision excellent translated', labels.decisionLabel('excellent') === '强机会');
assert('legacy buy translated', labels.legacySignalLabel('buy') === '推荐购买');

const buySnapshot = snapshot([item('Fever Case')]);
const buyCard = viewModel.selectOpportunityCard(buySnapshot, 'Fever Case');
assert('v2 buy decision is final decision', buyCard.decision === 'buy');
assert('v2 buy label is Chinese', buyCard.decisionLabel === '可关注买入');
assert('v2 expected discount is first metric', buyCard.expectedDiscountText === '8.60 折');
assert('v2 conservative discount present', buyCard.conservativeDiscountText === '9.10 折');
assert('v2 current full-position discount present', buyCard.currentDiscountText === '8.80 折');
assert('v2 listing marked separately', buyCard.listingDiscountText === '8.20 折');
assert('v2 capacity wording is current', buyCard.capacityText === '当前可执行容量 ¥240.00');
assert('v2 spread present', buyCard.spreadText === '1.50%');
assert('v2 market state present', buyCard.marketStateText === '稳定');
assert('v2 primary reason translated', buyCard.primaryReason === '预计折扣有吸引力');
assert('v2 future warning merged', buyCard.futureLiquidityNotGuaranteed === true);
assert('v2 future warning has no raw code', buyCard.warningLabels.every((label) => !label.includes('future_')));
assert('v2 freshness fresh', buyCard.freshness === 'fresh');
assert('v2 score is secondary', buyCard.scoreText === '82');
assert('v2 c5 price comes from current snapshot', buyCard.c5BuyPriceText === '¥7.00');
assert('v2 net profit uses current snapshot price', buyCard.netProfitText === '¥1.70');

const legacyBuyCannotOverride = viewModel.selectOpportunityCard(snapshot([item('legacy-buy-v2-watch', {
  legacy: { signal: 'buy' },
  v2: baseV2({ decision: 'watch' }),
})]), 'legacy-buy-v2-watch');
assert('legacy buy cannot override v2 watch', legacyBuyCannotOverride.decision === 'watch');

const legacyBuyCannotOverrideAvoid = viewModel.selectOpportunityCard(snapshot([item('legacy-buy-v2-avoid', {
  legacy: { signal: 'buy' },
  v2: baseV2({ decision: 'avoid', score: 99 }),
})]), 'legacy-buy-v2-avoid');
assert('legacy buy cannot override v2 avoid', legacyBuyCannotOverrideAvoid.decision === 'avoid');

for (const [decision, label] of [['excellent', '强机会'], ['buy', '可关注买入'], ['watch', '观察'], ['avoid', '暂不适合']]) {
  const card = viewModel.selectOpportunityCard(snapshot([item(`decision-${decision}`, { v2: baseV2({ decision }) })]), `decision-${decision}`);
  assert(`${decision} final label`, card.decisionLabel === label);
  assert(`${decision} final decision preserved`, card.decision === decision);
}
const highRawAvoid = viewModel.selectOpportunityCard(snapshot([item('high-raw-avoid', { v2: baseV2({ score: 99, decision: 'avoid', hardGates: ['expected_discount_not_viable'] }) })]), 'high-raw-avoid');
assert('high raw score cannot restore avoid', highRawAvoid.decision === 'avoid');
assert('high raw score shows gate reason', highRawAvoid.primaryReason === '预计折扣有吸引力' || highRawAvoid.warningLabels.includes('预计到账不足以覆盖 C5 成本'));

const partial = viewModel.selectOpportunityCard(snapshot([item('partial', {
  v2: baseV2({ currentFilledQuantity: 3, currentRequestedQuantity: 10, liquidationCoverage: 0.3, filledDiscount: 0.88 }),
})]), 'partial');
assert('partial fill does not show full current discount', partial.currentDiscountText === '当前盘口仅可成交 30%');
assert('partial fill separately labels filled discount', partial.currentFilledDiscountText === '已成交部分约 8.80 折');
assert('partial fill remains warning', partial.warningLabels.length >= 2);

const lowFee = viewModel.selectOpportunityCard(snapshot([item('low-fee', {
  v2: baseV2({ caps: ['approximate_fee_low_price_cap_watch'], decision: 'watch' }),
})]), 'low-fee');
assert('low price approximate fee flag', lowFee.lowPriceApproxFee === true);
assert('low price cap does not become buy', lowFee.decision === 'watch');
assert('low price cap translated', lowFee.warningLabels.includes('低价手续费为近似估算，最多观察'));

const stale = viewModel.selectOpportunityCard(snapshot([item('stale', { diagnostics: { forecastStatus: 'ready', orderbookStatus: 'cache_stale', c5Status: 'ready', stale: true, fallbackUsed: false } })], { diagnostics: {
  forecastCoverage: 1, orderbookFreshCoverage: 1, c5Coverage: 1, failureCount: 0, stale: true, fallbackCount: 0, lastRefreshDurationMs: 3,
} }), 'stale');
assert('stale card freshness', stale.freshness === 'stale');
assert('stale card label', stale.freshnessLabel === '数据已过期');
assert('stale card cannot recommend buy', stale.decision === 'watch');
assert('stale card explains the gate', stale.primaryReason === '市场数据已过期');

const incomplete = viewModel.selectOpportunityCard(snapshot([item('incomplete', {
  diagnostics: { forecastStatus: 'ready', orderbookStatus: 'failed', c5Status: 'ready', stale: false, fallbackUsed: false },
})]), 'incomplete');
assert('incomplete card cannot recommend buy', incomplete.decision === 'watch');

const highScoreMissing = viewModel.selectOpportunityCard(snapshot([item('high-score-missing', {
  v2: baseV2({ score: 99, decision: 'buy' }),
  diagnostics: { forecastStatus: 'missing', orderbookStatus: 'failed', c5Status: 'missing', stale: false, fallbackUsed: false },
})]), 'high-score-missing');
assert('high score missing data cannot recommend buy', highScoreMissing.decision !== 'buy' && highScoreMissing.decision !== 'excellent');
assert('incomplete card explains missing orderbook', incomplete.primaryReason === 'Steam 盘口暂不可用');

const staleLegacy = viewModel.selectOpportunityCard(snapshot([item('stale-legacy', {
  v2: undefined,
  legacy: { signal: 'buy', expectedDiscount: 0.8 },
  diagnostics: { forecastStatus: 'missing', orderbookStatus: 'failed', c5Status: 'missing', stale: false, fallbackUsed: true },
})], { mode: 'legacy' }), 'stale-legacy');
assert('fallback legacy buy signal is neutral', staleLegacy.legacySignal !== 'buy');

const fallback = viewModel.selectOpportunityCard(snapshot([item('fallback', { v2: undefined, diagnostics: { forecastStatus: 'missing', orderbookStatus: 'failed', c5Status: 'missing', stale: false, fallbackUsed: true, reason: 'v2_input_missing' } })], { mode: 'legacy' }), 'fallback');
assert('fallback state', fallback.freshness === 'fallback');
assert('fallback label', fallback.freshnessLabel === '使用最近有效数据');
assert('fallback keeps legacy signal', fallback.decision === 'legacy' && fallback.legacySignal === 'wait');
assert('fallback no NaN', !JSON.stringify(fallback).includes('NaN'));

const missing = viewModel.selectOpportunityCard(snapshot([item('missing', { v2: undefined, diagnostics: { forecastStatus: 'missing', orderbookStatus: 'failed', c5Status: 'missing', stale: false, fallbackUsed: false } })]), 'missing');
assert('missing state', missing.freshness === 'missing');
assert('missing does not fabricate discount', missing.expectedDiscountText === '9.10 折');

const shadow = viewModel.selectOpportunityCard(snapshot([item('shadow', { mode: 'shadow' })], { mode: 'shadow' }), 'shadow');
assert('shadow renders legacy decision', shadow.decision === 'legacy');
assert('shadow does not expose v2 decision as primary', shadow.decisionLabel === '可以观察');

const legacy = viewModel.selectOpportunityCard(snapshot([item('legacy', { mode: 'legacy', v2: undefined })], { mode: 'legacy' }), 'legacy');
assert('legacy mode decision isolated', legacy.decision === 'legacy');
assert('legacy expected discount preserved', legacy.expectedDiscountText === '9.10 折');
assert('legacy no future guarantee claim', legacy.futureLiquidityNotGuaranteed === false);

const sorted = viewModel.selectOpportunityCards(snapshot([
  item('avoid-item', { v2: baseV2({ decision: 'avoid', expectedDiscount: 1.1 }) }),
  item('excellent-item', { v2: baseV2({ decision: 'excellent', expectedDiscount: 0.75 }) }),
  item('watch-item', { v2: baseV2({ decision: 'watch', expectedDiscount: 0.9 }) }),
]), { sort: 'decision' });
assert('selector decision sort ranks excellent first', sorted[0].decision === 'excellent');
assert('selector decision sort ranks avoid last', sorted[2].decision === 'avoid');
assert('selector decision sort uses score within decision', viewModel.selectOpportunityCards(snapshot([
  item('buy-low-score', { v2: baseV2({ decision: 'buy', score: 20 }) }),
  item('buy-high-score', { v2: baseV2({ decision: 'buy', score: 80 }) }),
]), { sort: 'decision' })[0].item === 'buy-high-score');
assert('selector query uses machine name', viewModel.selectOpportunityCards(buySnapshot, { query: 'fever' }).length === 1);
assert('selector query uses display name safely', viewModel.selectOpportunityCards(buySnapshot, { query: 'not-found' }).length === 0);
assert('selector decision filter works', viewModel.selectOpportunityCards(sorted.length ? snapshot(sorted.map((card) => item(card.item, { v2: baseV2({ decision: card.decision }) }))) : buySnapshot, { decision: 'watch' }).length === 1);

for (const card of viewModel.selectOpportunityCards(snapshot([
  item('loop-excellent', { v2: baseV2({ decision: 'excellent' }) }),
  item('loop-buy', { v2: baseV2({ decision: 'buy' }) }),
  item('loop-watch', { v2: baseV2({ decision: 'watch' }) }),
  item('loop-avoid', { v2: baseV2({ decision: 'avoid' }) }),
  item('loop-stale', { diagnostics: { forecastStatus: 'ready', orderbookStatus: 'cache_stale', c5Status: 'ready', stale: true, fallbackUsed: false } }),
]))) {
  assert(`${card.item} has a display name`, card.displayNameZh.length > 0);
  assert(`${card.item} has a safe decision label`, card.decisionLabel.length > 0);
  assert(`${card.item} has a finite-safe discount`, card.expectedDiscountText !== 'NaN 折');
  assert(`${card.item} has a freshness state`, ['fresh', 'stale', 'fallback', 'missing'].includes(card.freshness));
}

for (const screen of ['RadarScreen.tsx', 'MarketScreen.tsx', 'HomeScreen.tsx', 'DetailScreen.tsx']) {
  const source = fs.readFileSync(path.join(root, 'src', 'screens', screen), 'utf8');
  assert(`${screen} does not call legacy radar directly`, !source.includes('api.radar('));
  assert(`${screen} does not call legacy markets directly`, !source.includes('api.markets('));
  assert(`${screen} does not build Opportunity in render`, !source.includes('buildOpportunityV2('));
  assert(`${screen} does not build Discount in render`, !source.includes('buildDiscountV2('));
  assert(`${screen} does not import Steam orderbook provider`, !source.includes('steamOrderbook'));
}

const serialized = JSON.stringify({ buyCard, partial, lowFee, stale, fallback, missing });
assert('UI view model has no raw machine code', !serialized.includes('expected_discount_not_viable'));
assert('UI view model has no future code', !serialized.includes('future_orderbook_not_predicted'));
assert('UI view model has no promise/function', !serialized.includes('function'));
assert('UI view model has no credential field', !/(api[_-]?key|cookie|authorization|token)/i.test(serialized));

console.log('');
console.log(`PASS ${passed} / ${passed + failed}`);
if (failed > 0) process.exitCode = 1;

fs.rmSync(outDir, { recursive: true, force: true });
