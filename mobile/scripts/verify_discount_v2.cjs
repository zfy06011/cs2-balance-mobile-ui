// V3-PHASE-2：Discount Engine v2 + Liquidity Engine 纯函数验证。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.verify-discount-v2');
const src = (name) => path.join(root, 'src', 'core', name);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + [
  src('fees.ts'), src('profit.ts'), src('liquidity.ts'), src('marketQuality.ts'), src('discountV2.ts'),
].map(JSON.stringify).join(' '), { cwd: root, stdio: 'pipe', shell: true });

const compiled = (name) => path.join(outDir, 'core', name);
const { DEFAULT_FEES } = require(compiled('fees.js'));
const { ProfitCalculator } = require(compiled('profit.js'));
const liquidity = require(compiled('liquidity.js'));
const quality = require(compiled('marketQuality.js'));
const discount = require(compiled('discountV2.js'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'discount_v2', 'cases.json'), 'utf8'));

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
function base(overrides = {}) {
  return {
    ...fixture.single,
    c5: { ...fixture.single.c5 },
    steam: { ...fixture.single.steam, buyLevels: fixture.single.steam.buyLevels.map((x) => ({ ...x })), sellLevels: fixture.single.steam.sellLevels.map((x) => ({ ...x })) },
    forecast: fixture.single.forecast ? { ...fixture.single.forecast } : undefined,
    ...overrides,
  };
}

// A：单档足够，验证手续费复用、VWAP、当前折扣和完整成交。
const singleSim = liquidity.simulateSellIntoBuyBook(fixture.single.steam.buyLevels, 10);
assert('A.full_fill', singleSim.filledQuantity === 10 && singleSim.unfilledQuantity === 0);
assert('A.vwap=1.5', near(singleSim.averageSellPrice, 1.5), singleSim.averageSellPrice);
assert('A.slippage=0', near(singleSim.slippagePct, 0), singleSim.slippagePct);
assert('A.gross=15', near(singleSim.grossProceeds, 15), singleSim.grossProceeds);
const single = discount.buildDiscountV2(fixture.single);
const expectedSingleNet = 15 * DEFAULT_FEES.steam_seller_receive_ratio;
assert('A.current.totalNet uses Steam fee', near(single.current.totalNet, expectedSingleNet), single.current.totalNet);
assert('A.current.discount uses C5 fee', near(single.current.discount, 10.1 / expectedSingleNet), single.current.discount);
assert('A.current.vwap', near(single.liquidity.currentVwap, 1.5), single.liquidity.currentVwap);
assert('A.current warnings do not claim partial fill', !single.warnings.includes('partial_fill'));

// B：多档滑点，数量增加时 VWAP 不变好、折扣不变优。
const v1 = liquidity.simulateSellIntoBuyBook(fixture.slippageBuy, 1);
const v3 = liquidity.simulateSellIntoBuyBook(fixture.slippageBuy, 3);
const v10 = liquidity.simulateSellIntoBuyBook(fixture.slippageBuy, 10);
assert('B.qty1 full', v1.filledQuantity === 1 && v1.unfilledQuantity === 0);
assert('B.qty3 full', v3.filledQuantity === 3 && v3.unfilledQuantity === 0);
assert('B.qty10 full', v10.filledQuantity === 10 && v10.unfilledQuantity === 0);
assert('B.vwap qty3=9.8666667', near(v3.averageSellPrice, (10 + 9.8 * 2) / 3), v3.averageSellPrice);
assert('B.vwap does not improve', v3.averageSellPrice <= v1.averageSellPrice && v10.averageSellPrice <= v3.averageSellPrice);
assert('B.slippage nondecreasing', v1.slippagePct <= v3.slippagePct && v3.slippagePct <= v10.slippagePct);
const slippageSteam = { ...base().steam, highestBuy: 10, lowestSell: 10.5, buyLevels: fixture.slippageBuy };
const d1 = discount.buildDiscountV2(base({ quantity: 1, steam: slippageSteam }));
const d10 = discount.buildDiscountV2(base({ quantity: 10, steam: slippageSteam }));
assert('B.discount quantity10 not better', d10.current.discount >= d1.current.discount, `${d1.current.discount} -> ${d10.current.discount}`);
assert('B.worstFillPrice', v10.worstFillPrice === 9.5, v10.worstFillPrice);

// C：盘口不足，部分成交仍返回已成交金额并明确 warning。
const partial = liquidity.simulateSellIntoBuyBook([{ price: 2, quantity: 2, cumulativeQuantity: 999 }], 10);
assert('C.partial filled=2', partial.filledQuantity === 2);
assert('C.partial unfilled=8', partial.unfilledQuantity === 8);
assert('C.partial gross=4', partial.grossProceeds === 4);
assert('C.partial warning', partial.warnings.includes('partial_fill'));
const partialResult = discount.buildDiscountV2(base({ quantity: 10, steam: { ...fixture.single.steam, buyLevels: [{ price: 2, quantity: 2, cumulativeQuantity: 999 }] } }));
assert('C.discount carries partial warning', partialResult.warnings.includes('partial_fill'));
assert('C.discount does not report full fill', partialResult.liquidity.filledQuantity === 2 && partialResult.liquidity.unfilledQuantity === 8);
assert('C.partial quality penalty', partialResult.quality.reasons.includes('partial_fill'));
assert('C.current requestedQuantity=10', partialResult.current.requestedQuantity === 10);
assert('C.current filledQuantity=2', partialResult.current.filledQuantity === 2);
assert('C.current coverage=0.2', near(partialResult.current.liquidationCoverage, 0.2));
assert('C.current filledGross=4', near(partialResult.current.filledGross, 4));
assert('C.current filledNet', near(partialResult.current.filledNet, 4 * DEFAULT_FEES.steam_seller_receive_ratio));
assert('C.filledDiscount is filled-cost discount', near(partialResult.current.filledDiscount, (2 * 1.01) / (4 * DEFAULT_FEES.steam_seller_receive_ratio)));
assert('C.fullPositionDiscount undefined', partialResult.current.fullPositionDiscount === undefined);
assert('C.legacy discount undefined on partial', partialResult.current.discount === undefined);

// D/E：spread 与 crossed book。
const spread = liquidity.calcSpread(90, 100);
assert('D.spread=10', spread.spread === 10);
assert('D.spreadPct denominator lowestSell', near(spread.spreadPct, 0.1));
const crossed = liquidity.calcSpread(101, 100);
assert('E.crossed does not throw', crossed.spread === -1);
assert('E.crossed warning', crossed.warnings.includes('crossed_book'));
const crossedResult = discount.buildDiscountV2(base({ steam: { ...fixture.single.steam, highestBuy: 101, lowestSell: 100 } }));
assert('E.discount crossed warning', crossedResult.warnings.includes('crossed_book'));
assert('E.discount crossed quality', crossedResult.quality.reasons.includes('crossed_book') && crossedResult.quality.score < 1);
assert('E.crossed future disabled', crossedResult.conservative7d === undefined && crossedResult.expected7d === undefined);

// F：低价边界与手续费权威实现。
const calc = new ProfitCalculator(DEFAULT_FEES.c5_buy_fee_ratio, DEFAULT_FEES.steam_seller_receive_ratio);
for (const price of [0.03, 0.05, 0.10, 0.18, 0.19, 0.20, 0.50, 1.00, 10.00, 100.00]) {
  assert(`F.c5 fee ${price}`, near(calc.c5TotalCost(price), price * 1.01), calc.c5TotalCost(price));
  assert(`F.steam fee ${price}`, near(calc.steamNetReceive(price), price * 0.8696), calc.steamNetReceive(price));
}
const low = discount.buildDiscountV2(base({
  c5: { ...fixture.single.c5, unitPrice: 0.18 },
  steam: { ...fixture.single.steam, highestBuy: 0.18, lowestSell: 0.19, buyLevels: [{ price: 0.18, quantity: 10, cumulativeQuantity: 10 }] },
  quantity: 1,
}));
assert('F.low price finite', finiteDeep(low));
assert('F.low price c5 cost included', near(low.current.discount, 0.18 * 1.01 / (0.18 * 0.8696)));

// G/H：可执行容量、1% impact 和 C5 数量上限。
const cap = liquidity.calcExecutableQuantity(fixture.capacityBuy, 10, undefined);
assert('G.depth includes >=9.9 only', cap.depthQuantity === 370, cap.depthQuantity);
assert('G.participation floor=74', cap.executableQuantity === 74, cap.executableQuantity);
assert('G.priceFloor=9.9', near(cap.priceFloor, 9.9), cap.priceFloor);
const capC5 = liquidity.calcExecutableQuantity(fixture.capacityBuy, 10, 20);
assert('H.C5 cap=20', capC5.executableQuantity === 20, capC5.executableQuantity);
const capZero = liquidity.calcExecutableQuantity(fixture.capacityBuy, 10, 0);
assert('H.C5 zero cap=0', capZero.executableQuantity === 0);
const capacityResult = discount.buildDiscountV2(base({ c5: { ...fixture.single.c5, availableQuantity: 20 }, steam: { ...fixture.single.steam, highestBuy: 10, lowestSell: 10.5, buyLevels: fixture.capacityBuy } }));
assert('H.result executable quantity=20', capacityResult.liquidity.executableQuantity === 20);
assert('H.result executable budget includes C5 fee', near(capacityResult.liquidity.executableBudget, 20 * 1.01));

// I：V4 P25/P50 映射未来场景，listing 使用 P50，且明确未建模未来深度。
const future = discount.buildDiscountV2(base({
  c5: { ...fixture.single.c5, unitPrice: 1 },
  steam: { ...fixture.single.steam, highestBuy: 9, lowestSell: 10, buyLevels: [{ price: 9, quantity: 100, cumulativeQuantity: 100 }] },
  forecast: { p25: 8, p50: 10, p75: 12 },
  quantity: 1,
}));
assert('I.conservative exists', future.conservative7d != null);
assert('I.expected exists', future.expected7d != null);
assert('I.listing exists', future.listing7d != null);
assert('I.conservative gross=7.2', near(future.conservative7d.grossPerUnit, 7.2), future.conservative7d);
assert('I.expected gross=9', near(future.expected7d.grossPerUnit, 9), future.expected7d);
assert('I.listing gross=10', near(future.listing7d.grossPerUnit, 10), future.listing7d);
assert('I.future depth warning', future.warnings.includes('future_book_depth_not_modeled'));
assert('I.future orderbook warning', future.warnings.includes('future_orderbook_not_predicted'));
assert('I.future liquidity warning', future.warnings.includes('future_liquidity_not_guaranteed'));
assert('I.future metadata says no orderbook prediction', future.futureModel && future.futureModel.orderbookPredicted === false && future.futureModel.liquidityGuaranteed === false);
assert('I.future ratio marked heuristic', future.futureModel && future.futureModel.ratioKind === 'current_market_heuristic' && near(future.futureModel.currentBuySellRatio, 0.9));
assert('I.future net fee', near(future.expected7d.netPerUnit, 9 * DEFAULT_FEES.steam_seller_receive_ratio));
assert('I.current capacity scope', future.currentLiquidityCapacity.scope === 'current_market_structure');
assert('I.current capacity aliases liquidity', future.currentLiquidityCapacity.executableBudget === future.liquidity.executableBudget);
assert('I.fee model is approximate', future.feeModel.name === 'estimatedSteamNetReceive' && future.feeModel.exact === false);
assert('I.fee approximation warning', future.warnings.includes('steam_fee_model_approximate'));

// J：没有 forecast 不影响 current，但不生成未来场景。
const noForecast = discount.buildDiscountV2(base({ forecast: undefined }));
assert('J.current still exists', noForecast.current != null && noForecast.current.totalNet > 0);
assert('J.no conservative', noForecast.conservative7d === undefined);
assert('J.no expected', noForecast.expected7d === undefined);
assert('J.no listing', noForecast.listing7d === undefined);
assert('J.forecast warning', noForecast.warnings.includes('forecast_missing'));
assert('J.quality reason', noForecast.quality.reasons.includes('forecast_missing'));
assert('J.market quality remains available', noForecast.marketDataQuality.score > 0 && noForecast.marketDataQuality.reasons.every((x) => x !== 'forecast_missing'));
assert('J.forecast quality unavailable', noForecast.forecastQuality.available === false && noForecast.forecastQuality.reasons.includes('forecast_missing'));
const explicitNow = discount.buildDiscountV2(base({
  now: 2_000_000,
  c5: { ...fixture.single.c5, fetchedAt: 1_000_000 },
  steam: { ...fixture.single.steam, fetchedAt: 3_000_000 },
}));
assert('J.explicit now is not replaced by max fetchedAt', explicitNow.quality.reasons.includes('c5_stale'));

// K：固定 now 的 freshness、低质量、空盘和质量扣分。
const staleQuality = quality.calcDataQuality({
  now: 2_000_000,
  c5FetchedAt: 1_000_000,
  steamFetchedAt: 1_000_000,
  steamQuality: 0.4,
  buyLevelsCount: 0,
  crossedBook: true,
  partialFill: true,
}, { staleAfterMs: 100, minQuality: 0.6 });
assert('K.stale true', staleQuality.stale === true);
assert('K.steam stale reason', staleQuality.reasons.includes('steam_stale'));
assert('K.c5 stale reason', staleQuality.reasons.includes('c5_stale'));
assert('K.empty book reason', staleQuality.reasons.includes('buy_book_empty'));
assert('K.crossed reason', staleQuality.reasons.includes('crossed_book'));
assert('K.partial reason', staleQuality.reasons.includes('partial_fill'));
assert('K.low quality reason', staleQuality.reasons.includes('steam_quality_low'));
assert('K.market quality excludes forecast reason', !staleQuality.reasons.includes('forecast_missing'));
assert('K.score clamped', staleQuality.score === 0 && staleQuality.score >= 0 && staleQuality.score <= 1);
const freshQuality = quality.calcDataQuality({
  now: 1_000_500,
  c5FetchedAt: 1_000_000,
  steamFetchedAt: 1_000_000,
  steamQuality: 1,
  buyLevelsCount: 1,
  crossedBook: false,
  partialFill: false,
}, { staleAfterMs: 1000, minQuality: 0.6 });
assert('K.fresh score=1', freshQuality.score === 1 && freshQuality.stale === false);

// 非法输入、不排序、重复档位和 cumulative 不一致不能污染输出。
const normalized = liquidity.normalizeOrderbookLevels([
  { price: 9, quantity: 2, cumulativeQuantity: 999 },
  { price: 10, quantity: 1, cumulativeQuantity: 0 },
  { price: 9, quantity: 3, cumulativeQuantity: -1 },
  { price: -1, quantity: 1, cumulativeQuantity: 1 },
  { price: 8, quantity: NaN, cumulativeQuantity: 1 },
], 'buy');
assert('invalid normalize filters bad levels', normalized.levels.length === 2);
assert('duplicate normalize merges qty', normalized.levels[1].quantity === 5);
assert('normalize sorts buy desc', normalized.levels[0].price === 10 && normalized.levels[1].price === 9);
assert('normalize recomputes cumulative', normalized.levels[0].cumulativeQuantity === 1 && normalized.levels[1].cumulativeQuantity === 6);
const empty = liquidity.simulateSellIntoBuyBook([], 10);
assert('invalid empty book no throw', empty.filledQuantity === 0 && empty.unfilledQuantity === 10);
const zeroQty = discount.buildDiscountV2(base({ quantity: 0 }));
assert('invalid quantity no throw', zeroQty.quantity === 0 && zeroQty.warnings.includes('invalid_quantity'));
const negativeQty = discount.buildDiscountV2(base({ quantity: -1 }));
assert('negative quantity safe', negativeQty.quantity === 0 && finiteDeep(negativeQty));
const invalidForecast = discount.buildDiscountV2(base({ forecast: { p25: 12, p50: 10, p75: 9 } }));
assert('invalid forecast warning', invalidForecast.warnings.includes('invalid_forecast'));
assert('invalid forecast current remains', invalidForecast.current.totalNet > 0);
const invalidSpread = discount.buildDiscountV2(base({ steam: { ...fixture.single.steam, highestBuy: NaN, lowestSell: Infinity } }));
assert('invalid spread finite', finiteDeep(invalidSpread) && invalidSpread.liquidity.spread === 0);
assert('invalid market data quality reason', invalidSpread.marketDataQuality.reasons.includes('market_data_invalid'));
const availableNaN = liquidity.calcExecutableQuantity(fixture.capacityBuy, 10, NaN);
assert('available NaN safe', availableNaN.executableQuantity === 0 && availableNaN.warnings.includes('invalid_c5_available_quantity'));

// 通用不变量。
for (const result of [single, d1, d10, partialResult, low, capacityResult, future, noForecast, zeroQty, negativeQty, invalidForecast, invalidSpread]) {
  assert('invariant finite output', finiteDeep(result));
  assert('invariant quality in range', result.quality.score >= 0 && result.quality.score <= 1);
  assert('invariant nonnegative fills', result.liquidity.filledQuantity >= 0 && result.liquidity.unfilledQuantity >= 0);
  assert('invariant executable nonnegative', result.liquidity.executableQuantity >= 0 && result.liquidity.executableBudget >= 0);
}

console.log('');
console.log('PASS ' + passed + ' / ' + (passed + failed));
if (failed > 0) {
  console.log(failed + ' FAILED');
  process.exitCode = 1;
} else {
  console.log('ALL DISCOUNT V2 + LIQUIDITY ASSERTIONS PASSED');
}
