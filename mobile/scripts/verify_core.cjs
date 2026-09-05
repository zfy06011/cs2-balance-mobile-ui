// verify_core.cjs —— TS 核心引擎 vs Python 后端基准 交叉验证脚本
// 用法: npm run verify:core
// 编译 src/core/*.ts 到 scripts/.verify-build，再用与 backend/scripts/baseline.json
// （Python services 模块同一组输入）相同的输入跑 TS，逐项断言。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.verify-build');
const coreDir = path.join(root, 'src', 'core');
const baselinePath = path.resolve(root, '..', 'backend', 'scripts', 'baseline.json');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const tscArgs = ['profit.ts', 'prediction.ts', 'radar.ts', 'simulation.ts', 'fees.ts', 'types.ts', 'buy.ts']
  .map((f) => JSON.stringify(path.join(coreDir, f)))
  .join(' ');
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + tscArgs, {
  cwd: root,
  stdio: 'pipe',
  shell: true,
});

const p = (f) => require(path.join(outDir, f));
const { ProfitCalculator } = p('profit.js');
const { BaselinePredictor, BaselinePredictorV2, normalCdf } = p('prediction.js');
const { evaluateRadar } = p('radar.js');
const { simulate, reverseTarget } = p('simulation.js');
const { DEFAULT_FEES } = p('fees.js');
const { checkPurchase, buildBuySummary } = p('buy.js');

const BASELINE = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
let failed = 0;
let passed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra ? '  got: ' + extra : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

// ---------- 1. 收益模型 ----------
const calc = new ProfitCalculator();
const pr = calc.calculate(10, 15);
const bp = BASELINE.profit;
assert('profit.steam_net_receive=' + bp.steam_net_receive, near(pr.steam_net_receive, bp.steam_net_receive, 1e-4), pr.steam_net_receive);
assert('profit.net_profit=' + bp.net_profit, near(pr.net_profit, bp.net_profit, 1e-4), pr.net_profit);
assert('profit.roi=' + bp.roi, near(pr.roi, bp.roi, 1e-6), pr.roi);
assert('profit.breakeven=' + bp.breakeven_sell_price, near(pr.breakeven_sell_price, bp.breakeven_sell_price, 1e-4), pr.breakeven_sell_price);

// ---------- 1b. 预计几折余额 ----------
// 成本 100（含 1% 费用 = 101）→ 预计 Steam 净到手 108 → 101/108 = 0.935185...
const disc = calc.expectedDiscount(100, 108);
assert('profit.expected_discount=101/108', near(disc, 101 / 108, 1e-9), disc);
assert('profit.expected_discount.null_price', calc.expectedDiscount(0, 108) === null && calc.expectedDiscount(-1, 108) === null);
assert('profit.expected_discount.null_receive', calc.expectedDiscount(100, 0) === null && calc.expectedDiscount(100, -5) === null);

// ---------- 1c. 购买保护 ----------
const buyOk = checkPurchase({ buyPrice: 100, qty: 1, steamNetReceivePerUnit: 108 });
assert('buy.ok=true', buyOk.ok === true, JSON.stringify(buyOk.errors));
assert('buy.summary.discount=' + (101 / 108).toFixed(6), near(buyOk.summary.discountNum, 101 / 108, 1e-9), buyOk.summary.discountNum);
assert('buy.summary.discountZhe=9.3518', near(buyOk.summary.discountZhe, (101 / 108) * 10, 1e-6), buyOk.summary.discountZhe);
assert('buy.summary.totalCost=101', near(buyOk.summary.totalCost, 101, 1e-9), buyOk.summary.totalCost);
assert('buy.summary.receive=108', near(buyOk.summary.netReceive, 108, 1e-9), buyOk.summary.netReceive);
const buyMax = checkPurchase({ buyPrice: 150, qty: 1, steamNetReceivePerUnit: 108, protection: { maxBuyPrice: 120 } });
assert('buy.maxBuyPrice.blocked', buyMax.ok === false && buyMax.errors.length === 1, JSON.stringify(buyMax.errors));
const buyTarget = checkPurchase({ buyPrice: 100, qty: 1, steamNetReceivePerUnit: 108, protection: { minTargetDiscount: 9.5 } });
assert('buy.minTargetDiscount.ok', buyTarget.ok === true, JSON.stringify(buyTarget.errors));
const buyTarget2 = checkPurchase({ buyPrice: 100, qty: 1, steamNetReceivePerUnit: 108, protection: { minTargetDiscount: 9 } });
assert('buy.minTargetDiscount.blocked', buyTarget2.ok === false, JSON.stringify(buyTarget2.errors));
const buyBudget = checkPurchase({ buyPrice: 100, qty: 3, steamNetReceivePerUnit: 108, protection: { maxBudget: 250 } });
assert('buy.maxBudget.blocked', buyBudget.ok === false, JSON.stringify(buyBudget.errors));
const buyWarn = checkPurchase({ buyPrice: 100, qty: 1, steamNetReceivePerUnit: 70 });
assert('buy.lossWarning.present', buyWarn.ok === true && buyWarn.warnings.length > 0, JSON.stringify(buyWarn.warnings));

// ---------- 2. 预测 ----------
const pred = new BaselinePredictor().predict({
  marketHashName: 'Test Case',
  prices: [8, 9, 10, 11, 12],
  breakevenPrice: 10.1,
  predictedAt: new Date('2026-09-05T00:00:00Z'),
});
const pbb = BASELINE.prediction;
for (const q of ['p10', 'p25', 'p50', 'p75', 'p90']) {
  assert('pred.' + q + '=' + pbb[q], near(pred[q], pbb[q], 1e-4), pred[q]);
}
assert('pred.prob_profit=' + pbb.prob_profit, near(pred.prob_profit, pbb.prob_profit, 1e-4), pred.prob_profit);
assert('pred.prob_loss=' + pbb.prob_loss, near(pred.prob_loss, pbb.prob_loss, 1e-4), pred.prob_loss);
assert('pred.confidence=' + pbb.confidence, near(pred.confidence, pbb.confidence, 1e-4), pred.confidence);
assert('pred.features.momentum=' + pbb.features.momentum, near(pred.features.momentum, pbb.features.momentum, 1e-6), pred.features.momentum);
assert('pred.features.volatility=' + pbb.features.volatility, near(pred.features.volatility, pbb.features.volatility, 1e-6), pred.features.volatility);
assert('pred.target_at +7d', pred.target_at === '2026-09-12T00:00:00.000Z', pred.target_at);
assert('pred.model_version', pred.model_version === 'baseline-momentum-v1', pred.model_version);

// ---------- 2b. 预测 V2（回归趋势 + 量价确认 + 数据不足） ----------
const v2 = new BaselinePredictorV2().predict({
  marketHashName: 'V2 Test Case',
  prices: [10, 10.4, 10.8, 11.3, 11.8],
  breakevenPrice: 10.1,
  predictedAt: new Date('2026-09-05T00:00:00Z'),
  volume: 6000,
  volumeHistory: [2000, 2500, 3000, 5000, 6000],
  popularRank: 12,
});
const pb2 = BASELINE.prediction_v2;
assert('pred_v2.model_version=' + pb2.model_version, v2.model_version === pb2.model_version, v2.model_version);
assert('pred_v2.target_at +7d', v2.target_at === pb2.target_at, v2.target_at);
for (const q of ['p10', 'p25', 'p50', 'p75', 'p90']) {
  assert('pred_v2.' + q + '=' + pb2[q], near(v2[q], pb2[q], 1e-4), v2[q]);
}
assert('pred_v2.prob_profit=' + pb2.prob_profit, near(v2.prob_profit, pb2.prob_profit, 1e-4), v2.prob_profit);
assert('pred_v2.prob_loss=' + pb2.prob_loss, near(v2.prob_loss, pb2.prob_loss, 1e-4), v2.prob_loss);
assert('pred_v2.confidence=' + pb2.confidence, near(v2.confidence, pb2.confidence, 1e-4), v2.confidence);
assert('pred_v2.features.trend_daily=' + pb2.features.trend_daily, near(Number(v2.features.trend_daily), pb2.features.trend_daily, 1e-6), v2.features.trend_daily);
assert('pred_v2.features.momentum=' + pb2.features.momentum, near(Number(v2.features.momentum), pb2.features.momentum, 1e-6), v2.features.momentum);
assert('pred_v2.features.volume_confirm=1.15', Number(v2.features.volume_confirm) === 1.15, v2.features.volume_confirm);
assert('pred_v2.features.volume_ratio=1.92', near(Number(v2.features.volume_ratio), 1.92, 1e-3), v2.features.volume_ratio);
assert('pred_v2.features.popular_rank=12', Number(v2.features.popular_rank) === 12, v2.features.popular_rank);
assert('pred_v2.data_insufficient=false', v2.features.data_insufficient === false, v2.features.data_insufficient);

// 数据不足：单点历史不再拼接假装，输出「平盘 + 低置信度 + 标记」
const v2low = new BaselinePredictorV2().predict({
  marketHashName: 'V2 Low',
  prices: [12],
  breakevenPrice: 10.1,
  predictedAt: new Date('2026-09-05T00:00:00Z'),
});
const pl = BASELINE.prediction_v2_low;
assert('pred_v2_low.p50=' + pl.p50, near(v2low.p50, pl.p50, 1e-4), v2low.p50);
assert('pred_v2_low.p25=' + pl.p25, near(v2low.p25, pl.p25, 1e-4), v2low.p25);
assert('pred_v2_low.confidence=' + pl.confidence, near(v2low.confidence, pl.confidence, 1e-4), v2low.confidence);
assert('pred_v2_low.prob_profit=' + pl.prob_profit, near(v2low.prob_profit, pl.prob_profit, 1e-4), v2low.prob_profit);
assert('pred_v2_low.data_insufficient=true', v2low.features.data_insufficient === true, v2low.features.data_insufficient);
assert('pred_v2_low.trend_daily=0', Number(v2low.features.trend_daily) === 0, v2low.features.trend_daily);

// erf/CDF 合理性（Hermes 无 Math.erf，验证近似精度）
assert('normalCdf(0)=0.5', near(normalCdf(0), 0.5, 1e-4), normalCdf(0));
assert('normalCdf(1.96)~0.975', near(normalCdf(1.96), 0.975, 1e-3), normalCdf(1.96));

// ---------- 3. 雷达 ----------
function radarCase(o) {
  return evaluateRadar({
    market_hash_name: o.market_hash_name,
    c5_buy_price: 10,
    steam_sell_price: o.sell,
    steam_volume: o.vol,
    predicted_p50: o.p50,
    predicted_p25: o.p25,
    breakeven_price: 11.6,
    volatility: o.vola,
  });
}
const rc = (key, o) => {
  const r = radarCase(o);
  const b = BASELINE[key];
  assert(key + '.signal=' + b.signal, r.signal === b.signal, r.signal);
  assert(key + '.expected_roi=' + b.expected_roi, near(r.expected_roi, b.expected_roi, 1e-6), r.expected_roi);
  assert(key + '.pessimistic_roi=' + b.pessimistic_roi, near(r.pessimistic_roi, b.pessimistic_roi, 1e-6), r.pessimistic_roi);
  assert(key + '.risk=' + b.risk_level, r.risk_level === b.risk_level, r.risk_level);
  assert(key + '.liquidity=' + b.liquidity, r.liquidity === b.liquidity, r.liquidity);
  assert(key + '.score=' + b.score, near(r.score, b.score, 1e-6), r.score);
};
rc('radar_buy', { market_hash_name: 'A', sell: 15, vol: 8000, p50: 16, p25: 14.5, vola: 0.02 });
rc('radar_wait', { market_hash_name: 'C', sell: 15, vol: 8000, p50: 16, p25: 14.5, vola: 0.03 });
rc('radar_avoid', { market_hash_name: 'B', sell: 9, vol: 50, p50: 8.5, p25: 7, vola: 0.2 });

// 3b. 雷达-数据不足 + 热门排名：原 buy 场景被封顶为 wait，评分封顶 40
const rInsuf = evaluateRadar({
  market_hash_name: 'Insufficient Case A',
  c5_buy_price: 10,
  steam_sell_price: 15,
  steam_volume: 8000,
  predicted_p50: 16,
  predicted_p25: 14.5,
  breakeven_price: 11.6,
  volatility: 0.02,
  prob_profit: 0.7,
  popular_rank: 5,
  data_insufficient: true,
});
const rbI = BASELINE.radar_insufficient;
assert('radar_insufficient.signal=' + rbI.signal, rInsuf.signal === rbI.signal, rInsuf.signal);
assert('radar_insufficient.expected_roi=' + rbI.expected_roi, near(rInsuf.expected_roi, rbI.expected_roi, 1e-6), rInsuf.expected_roi);
assert('radar_insufficient.score=' + rbI.score, near(rInsuf.score, rbI.score, 1e-6), rInsuf.score);
assert('radar_insufficient.details.data_insufficient', rInsuf.details.data_insufficient === true, String(rInsuf.details.data_insufficient));
assert('radar_insufficient.details.popular_rank=5', Number(rInsuf.details.popular_rank) === 5, String(rInsuf.details.popular_rank));

// ---------- 4. 模拟 ----------
const sim = simulate(1000, [
  { name: 'K1', c5_price: 10, predicted_p50: 16, predicted_p25: 14, prob_loss: 0.1, volume: 8000, risk: 'low', liquidity: 'high' },
  { name: 'K2', c5_price: 8, predicted_p50: 12, predicted_p25: 10.5, prob_loss: 0.15, volume: 3000, risk: 'medium', liquidity: 'medium' },
  { name: 'K3', c5_price: 20, predicted_p50: 28, predicted_p25: 24, prob_loss: 0.2, volume: 600, risk: 'high', liquidity: 'low' },
], 'balanced');
const sb = BASELINE.simulation;
assert('sim.total_buy_cost=' + sb.total_buy_cost, near(sim.total_buy_cost, sb.total_buy_cost, 0.01), sim.total_buy_cost);
assert('sim.receive=' + sb.expected_steam_receive, near(sim.expected_steam_receive, sb.expected_steam_receive, 0.01), sim.expected_steam_receive);
assert('sim.net=' + sb.expected_net_profit, near(sim.expected_net_profit, sb.expected_net_profit, 0.01), sim.expected_net_profit);
assert('sim.roi=' + sb.expected_roi, near(sim.expected_roi, sb.expected_roi, 1e-4), sim.expected_roi);
assert('sim.weighted_loss=' + sb.weighted_loss_prob, near(sim.weighted_loss_prob, sb.weighted_loss_prob, 1e-4), sim.weighted_loss_prob);
assert('sim.items.len=' + sb.items.length, sim.items.length === sb.items.length, sim.items.length);
for (let i = 0; i < sb.items.length; i++) {
  const s = sim.items[i], b = sb.items[i];
  assert('sim.item' + i + '.qty=' + b.qty, s.qty === b.qty, s.qty);
  assert('sim.item' + i + '.cost=' + b.buy_cost, near(s.buy_cost, b.buy_cost, 0.01), s.buy_cost);
  assert('sim.item' + i + '.receive=' + b.expected_receive, near(s.expected_receive, b.expected_receive, 0.01), s.expected_receive);
  assert('sim.item' + i + '.roi=' + b.expected_roi, near(s.expected_roi, b.expected_roi, 1e-4), s.expected_roi);
}

// ---------- 5. 反推 ----------
const rt = reverseTarget(1000, 0.03);
const rb = BASELINE.reverse_target;
assert('reverse.required_budget=' + rb.required_budget, near(rt.required_budget, rb.required_budget, 0.01), rt.required_budget);
assert('reverse.expected_profit=' + rb.expected_profit, near(rt.expected_profit, rb.expected_profit, 0.01), rt.expected_profit);

// ---------- 6. 费率 ----------
assert('fees.steam=0.8696', DEFAULT_FEES.steam_seller_receive_ratio === 0.8696);
assert('fees.c5=0.01', DEFAULT_FEES.c5_buy_fee_ratio === 0.01);

console.log('');
console.log('PASS ' + passed + ' / ' + (passed + failed));
if (failed > 0) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('ALL CORE ASSERTIONS PASSED (TS == Python baseline)');
