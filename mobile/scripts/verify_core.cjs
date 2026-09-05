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

const tscArgs = ['profit.ts', 'prediction.ts', 'radar.ts', 'simulation.ts', 'fees.ts', 'types.ts']
  .map((f) => JSON.stringify(path.join(coreDir, f)))
  .join(' ');
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + tscArgs, {
  cwd: root,
  stdio: 'pipe',
  shell: true,
});

const p = (f) => require(path.join(outDir, f));
const { ProfitCalculator } = p('profit.js');
const { BaselinePredictor, normalCdf } = p('prediction.js');
const { evaluateRadar } = p('radar.js');
const { simulate, reverseTarget } = p('simulation.js');
const { DEFAULT_FEES } = p('fees.js');

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
