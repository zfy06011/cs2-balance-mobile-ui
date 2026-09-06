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

const tscArgs = ['profit.ts', 'prediction.ts', 'radar.ts', 'simulation.ts', 'fees.ts', 'types.ts', 'buy.ts', 'steamSync.ts', 'advice.ts', 'rss.ts']
  .map((f) => JSON.stringify(path.join(coreDir, f)))
  .join(' ');
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + tscArgs, {
  cwd: root,
  stdio: 'pipe',
  shell: true,
});

// steam.ts 在 src/data 下（依赖形状与 core 不同），单独编译一份
const outDirSteam = path.join(__dirname, '.verify-steam');
fs.rmSync(outDirSteam, { recursive: true, force: true });
fs.mkdirSync(outDirSteam, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDirSteam) + ' ' + JSON.stringify(path.join(root, 'src', 'data', 'steam.ts')), {
  cwd: root,
  stdio: 'pipe',
  shell: true,
});

// c5.ts 同理单独编译
const outDirC5 = path.join(__dirname, '.verify-c5');
fs.rmSync(outDirC5, { recursive: true, force: true });
fs.mkdirSync(outDirC5, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDirC5) + ' ' + JSON.stringify(path.join(root, 'src', 'data', 'c5.ts')), {
  cwd: root,
  stdio: 'pipe',
  shell: true,
});

const p = (f) => require(path.join(outDir, f));
const { ProfitCalculator } = p('profit.js');
const { BaselinePredictor, BaselinePredictorV2, BaselinePredictorV3, normalCdf, computeEventAdjust, STEAM_SALE_EVENTS_2026, MARKET_EVENTS } = p('prediction.js');
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

// ---------- 2d. 预测 V3（EW 加权回归 + EWMA 波动率 + 连续量价 + 自适应限幅） ----------
const v3 = new BaselinePredictorV3().predict({
  marketHashName: 'V3 Test Case',
  prices: [10, 10.4, 10.8, 11.3, 11.8],
  breakevenPrice: 10.1,
  predictedAt: new Date('2026-09-05T00:00:00Z'),
  volume: 6000,
  volumeHistory: [2000, 2500, 3000, 5000, 6000],
  popularRank: 12,
});
const pb3 = BASELINE.prediction_v3;
assert('pred_v3.model_version=' + pb3.model_version, v3.model_version === pb3.model_version, v3.model_version);
for (const q of ['p10', 'p25', 'p50', 'p75', 'p90']) {
  assert('pred_v3.' + q + '=' + pb3[q], near(v3[q], pb3[q], 1e-4), v3[q]);
}
assert('pred_v3.prob_profit=' + pb3.prob_profit, near(v3.prob_profit, pb3.prob_profit, 1e-4), v3.prob_profit);
assert('pred_v3.confidence=' + pb3.confidence, near(v3.confidence, pb3.confidence, 1e-4), v3.confidence);
assert('pred_v3.trend_daily=' + pb3.features.trend_daily, near(Number(v3.features.trend_daily), pb3.features.trend_daily, 1e-6), v3.features.trend_daily);
assert('pred_v3.volatility=' + pb3.features.volatility, near(Number(v3.features.volatility), pb3.features.volatility, 1e-6), v3.features.volatility);
assert('pred_v3.volume_confirm=' + pb3.features.volume_confirm, near(Number(v3.features.volume_confirm), Number(pb3.features.volume_confirm), 1e-4), v3.features.volume_confirm);
assert('pred_v3.trend_points=5', Number(v3.features.trend_points) === 5, v3.features.trend_points);
assert('pred_v3.drift_clamp=' + pb3.features.drift_clamp, near(Number(v3.features.drift_clamp), Number(pb3.features.drift_clamp), 1e-6), v3.features.drift_clamp);

const v3ev = new BaselinePredictorV3().predict({
  marketHashName: 'V3 Event Case',
  prices: [10, 10.4, 10.8, 11.3, 11.8],
  breakevenPrice: 10.1,
  predictedAt: new Date('2026-09-05T00:00:00Z'),
  volume: 6000,
  volumeHistory: [2000, 2500, 3000, 5000, 6000],
  popularRank: 12,
  events: [{ kind: 'steam-sale', name: 'Test Sale', start: '2026-09-10', end: '2026-09-16', pressure: 0.03, recoveryDays: 14 }],
});
const pb3e = BASELINE.prediction_v3_event;
assert('pred_v3_event.model_version=' + pb3e.model_version, v3ev.model_version === pb3e.model_version, v3ev.model_version);
for (const q of ['p10', 'p25', 'p50', 'p75', 'p90']) {
  assert('pred_v3_event.' + q + '=' + pb3e[q], near(v3ev[q], pb3e[q], 1e-4), v3ev[q]);
}
assert('pred_v3_event.p50=0.97x', near(Number(v3ev.p50), Number(pb3.p50) * 0.97, 1e-4), v3ev.p50);
assert('pred_v3_event.event_names', v3ev.features.event_names === 'Test Sale', String(v3ev.features.event_names));

const v3low = new BaselinePredictorV3().predict({
  marketHashName: 'V3 Low',
  prices: [12],
  breakevenPrice: 10.1,
  predictedAt: new Date('2026-09-05T00:00:00Z'),
});
const pl3 = BASELINE.prediction_v3_low;
assert('pred_v3_low.p50=' + pl3.p50, near(v3low.p50, pl3.p50, 1e-4), v3low.p50);
assert('pred_v3_low.confidence=' + pl3.confidence, near(v3low.confidence, pl3.confidence, 1e-4), v3low.confidence);
assert('pred_v3_low.data_insufficient=true', v3low.features.data_insufficient === true, v3low.features.data_insufficient);
assert('pred_v2_low.trend_daily=0', Number(v2low.features.trend_daily) === 0, v2low.features.trend_daily);

// ---------- 2c. 预测 V2 + 事件窗口价差修正（Steam 大促等） ----------
const v2ev = new BaselinePredictorV2().predict({
  marketHashName: 'V2 Event Case',
  prices: [10, 10.4, 10.8, 11.3, 11.8],
  breakevenPrice: 10.1,
  predictedAt: new Date('2026-09-05T00:00:00Z'),
  volume: 6000,
  volumeHistory: [2000, 2500, 3000, 5000, 6000],
  popularRank: 12,
  events: [{ kind: 'steam-sale', name: 'Test Sale', start: '2026-09-10', end: '2026-09-16', pressure: 0.03, recoveryDays: 14 }],
});
const pbE = BASELINE.prediction_v2_event;
assert('pred_v2_event.model_version=' + pbE.model_version, v2ev.model_version === pbE.model_version, v2ev.model_version);
assert('pred_v2_event.target_at +7d', v2ev.target_at === pbE.target_at, v2ev.target_at);
for (const q of ['p10', 'p25', 'p50', 'p75', 'p90']) {
  assert('pred_v2_event.' + q + '=' + pbE[q], near(v2ev[q], pbE[q], 1e-4), v2ev[q]);
}
assert('pred_v2_event.prob_profit=' + pbE.prob_profit, near(v2ev.prob_profit, pbE.prob_profit, 1e-4), v2ev.prob_profit);
assert('pred_v2_event.prob_loss=' + pbE.prob_loss, near(v2ev.prob_loss, pbE.prob_loss, 1e-4), v2ev.prob_loss);
assert('pred_v2_event.confidence=' + pbE.confidence, near(v2ev.confidence, pbE.confidence, 1e-4), v2ev.confidence);
assert('pred_v2_event.features.event_active', v2ev.features.event_active === true, String(v2ev.features.event_active));
assert('pred_v2_event.features.event_count=1', Number(v2ev.features.event_count) === 1, String(v2ev.features.event_count));
assert('pred_v2_event.features.event_adjust=-0.03', near(Number(v2ev.features.event_adjust), -0.03, 1e-6), String(v2ev.features.event_adjust));
assert('pred_v2_event.features.event_kinds', v2ev.features.event_kinds === 'steam-sale', String(v2ev.features.event_kinds));
assert('pred_v2_event.features.event_names', v2ev.features.event_names === 'Test Sale', String(v2ev.features.event_names));
assert('pred_v2_event.p50=0.97x', near(Number(v2ev.p50), Number(pb2.p50) * 0.97, 1e-4), Number(v2ev.p50));
assert('pred_v2_event.confidence=0.9x', near(Number(v2ev.confidence), Number(pb2.confidence) * 0.9, 1e-4), Number(v2ev.confidence));

// 事件纯函数：窗口内压制 / 结束后回补 / 无事件不修正（与 Python compute_event_adjust 同口径）
const evtSale = { kind: 'steam-sale', name: 'Test Sale', start: '2026-09-10', end: '2026-09-16', pressure: 0.03, recoveryDays: 14 };
const adjSale = computeEventAdjust(new Date('2026-09-12T00:00:00Z'), [evtSale]);
assert('event_adjust.sale_factor=0.97', near(adjSale.factor, 0.97, 1e-9), adjSale.factor);
assert('event_adjust.sale_count=1', adjSale.count === 1, adjSale.count);
const adjRebound = computeEventAdjust(new Date('2026-09-23T00:00:00Z'), [evtSale]);
// d = 23-16 = 7 → 1 + 0.03×(1-7/14) = 1.015（线性回补）
assert('event_adjust.rebound_factor=1.015', near(adjRebound.factor, 1.015, 1e-9), adjRebound.factor);
assert('event_adjust.rebound_count=1', adjRebound.count === 1, adjRebound.count);
const adjNone = computeEventAdjust(new Date('2026-08-01T00:00:00Z'), [evtSale]);
assert('event_adjust.no_hit=1', near(adjNone.factor, 1, 1e-9) && adjNone.count === 0, adjNone.factor);
assert('event_calendar.2026.len=4', STEAM_SALE_EVENTS_2026.length === 4, STEAM_SALE_EVENTS_2026.length);
assert('event_calendar.2026.summer', STEAM_SALE_EVENTS_2026.some((e) => e.start === '2026-06-25' && e.end === '2026-07-09'), JSON.stringify(STEAM_SALE_EVENTS_2026));
// 综合日历（2025-2027）：大促压制 / Major 与春节提振 / 政策冲击
assert('market_events.count>=16', MARKET_EVENTS.length >= 16, MARKET_EVENTS.length);
const eaBoost = computeEventAdjust(new Date('2026-06-10T12:00:00.000Z'), [{ kind: 'major', name: 'MajorX', start: '2026-06-02', end: '2026-06-21', pressure: 0.02 }]);
assert('event_adjust.boost=1.02', near(eaBoost.factor, 1.02, 1e-9), eaBoost.factor);
const eaBoostPre = computeEventAdjust(new Date('2026-05-31T12:00:00.000Z'), [{ kind: 'major', name: 'MajorX', start: '2026-06-02', end: '2026-06-21', pressure: 0.02 }]);
assert('event_adjust.boost_pre=1.01', near(eaBoostPre.factor, 1.01, 1e-9), eaBoostPre.factor);
const eaCny = computeEventAdjust(new Date('2026-02-17T12:00:00.000Z'), MARKET_EVENTS);
assert('event_adjust.cny_hit', eaCny.count >= 1 && eaCny.factor > 1, JSON.stringify(eaCny));
const eaShock = computeEventAdjust(new Date('2025-10-24T12:00:00.000Z'), MARKET_EVENTS);
assert('event_adjust.shock=0.92', near(eaShock.factor, 0.92, 1e-9), eaShock.factor);

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

// 3c. 雷达-事件价差修正：大促压制（event_adjust=-0.03）买入机会加分 +6，
//     有效卖出价 = 16×0.97 = 15.52（引擎传入还原后原始 P50，雷达乘回 (1+event_adjust)）
const rEv = evaluateRadar({
  market_hash_name: 'Event Case A',
  c5_buy_price: 10,
  steam_sell_price: 15,
  steam_volume: 8000,
  predicted_p50: 16,
  predicted_p25: 14.5,
  breakeven_price: 11.6,
  volatility: 0.02,
  event_adjust: -0.03,
});
const rbE = BASELINE.radar_event;
assert('radar_event.signal=' + rbE.signal, rEv.signal === rbE.signal, rEv.signal);
assert('radar_event.expected_roi=' + rbE.expected_roi, near(rEv.expected_roi, rbE.expected_roi, 1e-6), rEv.expected_roi);
assert('radar_event.pessimistic_roi=' + rbE.pessimistic_roi, near(rEv.pessimistic_roi, rbE.pessimistic_roi, 1e-6), rEv.pessimistic_roi);
assert('radar_event.risk=' + rbE.risk_level, rEv.risk_level === rbE.risk_level, rEv.risk_level);
assert('radar_event.liquidity=' + rbE.liquidity, rEv.liquidity === rbE.liquidity, rEv.liquidity);
assert('radar_event.score=' + rbE.score, near(rEv.score, rbE.score, 1e-6), rEv.score);
assert('radar_event.details.event_adjust=-0.03', Number(rEv.details.event_adjust) === -0.03, String(rEv.details.event_adjust));
assert('radar_event.details.predicted_p50=15.52', near(Number(rEv.details.predicted_p50), 15.52, 1e-6), String(rEv.details.predicted_p50));
const rEvNone = evaluateRadar({
  market_hash_name: 'Event Case A',
  c5_buy_price: 10,
  steam_sell_price: 15,
  steam_volume: 8000,
  predicted_p50: 16,
  predicted_p25: 14.5,
  breakeven_price: 11.6,
  volatility: 0.02,
});
assert('radar_event.offset_vs_none=+6', near(rEv.score - rEvNone.score, 6, 1e-6), rEv.score - rEvNone.score);

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

// ---------- 7. Steam 库存同步：双键匹配 + 自动导入 ----------
const { planSteamSync, estimateCooldown, buildEmptySyncReason } = p('steamSync.js');

// ---------- 8. Steam 官方历史价格解析 ----------
const { parsePriceHistory, parseWebApiInventory, normalizeSteamId, fetchSteamInventoryWebApi } = require(path.join(outDirSteam, 'steam.js'));
// skinport.ts + c5.ts 同理单独编译（同目录，公共根直接输出到 outDirSk）
const outDirSk = path.join(__dirname, '.verify-skinport');
fs.rmSync(outDirSk, { recursive: true, force: true });
fs.mkdirSync(outDirSk, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDirSk) + ' ' + JSON.stringify(path.join(root, 'src', 'data', 'skinport.ts')) + ' ' + JSON.stringify(path.join(root, 'src', 'data', 'c5.ts')), {
  cwd: root,
  stdio: 'pipe',
  shell: true,
});
const { parseSkinportHistory } = require(path.join(outDirSk, 'skinport.js'));

// ---------- 10. C5 买入参考 + 库存卖出时机 ----------
const { buildC5BuyAdvice, buildSellAdvice } = p('advice.js');
// ---------- 11. RSS 解析 + 事件标记（软件内实时事件源） ----------
const { parseRss, tagTitle, filterRecent } = p('rss.js');
const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
<item><title><![CDATA[Counter-Strike 2 Update: 交易保护调整 Trade Protection]]></title><link>https://blog.counter-strike.net/a</link><pubDate>Mon, 23 Oct 2025 12:00:00 +0000</pubDate></item>
<item><title>IEM Cologne Major 2026 Champions Crowned</title><link>https://blog.counter-strike.net/b</link><pubDate>Sun, 21 Jun 2026 18:00:00 +0000</pubDate></item>
<item><title>Steam 秋季特卖现已开始 Autumn Sale</title><link>https://store.steampowered.com/c</link><pubDate>Wed, 01 Oct 2025 10:00:00 +0000</pubDate></item>
<item><title>新武器箱 Kilowatt Case 上架</title><link>https://store.steampowered.com/d</link><pubDate>Mon, 03 Feb 2025 09:00:00 +0000</pubDate></item>
</channel></rss>`;
const feed = parseRss(sampleXml, '测试源', 10);
assert('rss.parse_len=4', feed.length === 4, feed.length);
assert('rss.cdata_title', /交易保护调整/.test(feed[0].title), feed[0].title);
assert('rss.date_iso', feed[0].date === '2025-10-23T12:00:00.000Z', feed[0].date);
assert('rss.tag_policy', tagTitle('CS2 更新：交易保护机制调整').includes('policy'));
assert('rss.tag_boost', tagTitle('PGL Major Singapore 冠军诞生').includes('boost'));
assert('rss.tag_case', tagTitle('新武器箱 Kilowatt Case 上架').includes('case'));
assert('rss.tag_sale', tagTitle('Steam 秋季特卖 Autumn Sale 开始').includes('sale'));
const recentOnly = filterRecent(feed, 45, new Date('2025-11-01T00:00:00.000Z').getTime());
assert('rss.recent_filter', recentOnly.length === 2 && recentOnly[0].date === '2025-10-23T12:00:00.000Z', JSON.stringify(recentOnly.map((x) => x.date)));
assert('rss.empty_safe', parseRss('', 'x').length === 0 && parseRss('<html>not rss</html>', 'x').length === 0);

// ---------- 12. Steam Web API 库存解析（IEconService，含交易保护箱） ----------
const expSoon = new Date(Date.now() + 3 * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
const webApiPayload = {
  total_inventory_count: 2,
  assets: [
    { appid: '730', contextid: '2', assetid: '1', classid: 'c1', instanceid: 'i1', amount: '1', cache_expiration: expSoon },
    { appid: '730', contextid: '2', assetid: '2', classid: 'c2', instanceid: 'i2', amount: '3' },
  ],
  descriptions: [
    { classid: 'c1', instanceid: 'i1', market_hash_name: 'Kilowatt Case', market_name: '千瓦武器箱', tradable: 0, marketable: 1 },
    { classid: 'c2', instanceid: 'i2', market_hash_name: 'Revolver Case', market_name: '左轮武器箱', tradable: 1, marketable: 1 },
  ],
};
const webInv = parseWebApiInventory(webApiPayload);
assert('webapi.parse_len=2', webInv.items.length === 2 && webInv.assetCount === 2, webInv.items.length);
assert('webapi.total', webInv.totalInventoryCount === 2, webInv.totalInventoryCount);
const kw = webInv.items.find((x) => x.name === 'Kilowatt Case');
const rv = webInv.items.find((x) => x.name === 'Revolver Case');
assert('webapi.protected_days', !!kw && kw.tradable === false && kw.tradableRestrictionDays != null && kw.tradableRestrictionDays >= 2 && kw.tradableRestrictionDays <= 4, JSON.stringify(kw));
assert('webapi.unlocked', !!rv && rv.tradable === true && rv.amount === 3, JSON.stringify(rv));
// 空列表但 total>0（Steam 报告 N 件但 assets 为空）：引擎据此区分「真空库存」与「返回异常」（context 16 失败场景）
const emptyInv = parseWebApiInventory({ total_inventory_count: 5, assets: [], descriptions: [] });
assert('webapi.empty_total_kept', emptyInv.items.length === 0 && emptyInv.assetCount === 0 && emptyInv.totalInventoryCount === 5, JSON.stringify(emptyInv));
assert('steam.norm_digits', normalizeSteamId('76561198000000000') === '76561198000000000', normalizeSteamId('76561198000000000'));
assert('steam.norm_profiles_url', normalizeSteamId('https://steamcommunity.com/profiles/76561198000000000') === '76561198000000000', normalizeSteamId('https://steamcommunity.com/profiles/76561198000000000'));
assert('steam.norm_vanity_rejects', (() => { try { normalizeSteamId('myvanity'); return false; } catch { return true; } })(), 'vanity should be rejected by normalizeSteamId');

// ---------- 12b. 模拟 INV_SCRIPT 修复后的合并场景（context2 空 + context16 有物品） ----------
const ctx2Empty = { success: true, total_inventory_count: 0, assets: [], descriptions: [] };
const ctx16Protected = {
  success: true, total_inventory_count: 2,
  assets: [
    { appid: '730', contextid: '16', assetid: '10', classid: 'c10', instanceid: 'i10', amount: '1' },
    { appid: '730', contextid: '16', assetid: '11', classid: 'c11', instanceid: 'i11', amount: '2' },
  ],
  descriptions: [
    { classid: 'c10', instanceid: 'i10', market_hash_name: 'Dreams & Nightmares Case', tradable: 0, marketable: 0 },
    { classid: 'c11', instanceid: 'i11', market_hash_name: 'CS:GO Weapon Case', tradable: 0, marketable: 0 },
  ],
};
// 模拟修复后的 merge 逻辑：扁平 concat
const mergedAssets = [].concat(ctx2Empty.assets, ctx16Protected.assets);
const mergedDescRaw = [].concat(ctx2Empty.descriptions, ctx16Protected.descriptions);
const seenD = {}; const dedupedDesc = [];
for (const dd of mergedDescRaw) { const k = dd.classid + '|' + dd.instanceid; if (!seenD[k]) { seenD[k] = true; dedupedDesc.push(dd); } }
const mergedPayload = { total_inventory_count: mergedAssets.length, assets: mergedAssets, descriptions: dedupedDesc };
const mergedInv = parseWebApiInventory(mergedPayload);
assert('webapi.merge_ctx16_len=2', mergedInv.items.length === 2, mergedInv.items.length);
assert('webapi.merge_ctx16_assetCount=2', mergedInv.assetCount === 2, mergedInv.assetCount);
const dn = mergedInv.items.find((x) => x.name === 'Dreams & Nightmares Case');
const wc = mergedInv.items.find((x) => x.name === 'CS:GO Weapon Case');
assert('webapi.merge_ctx16_protected', !!dn && dn.tradable === false && dn.amount === 1, JSON.stringify(dn));
assert('webapi.merge_ctx16_qty', !!wc && wc.amount === 2 && wc.tradable === false, JSON.stringify(wc));

// ---------- 12c. v1.5.6：Steam 官方 response 包装解析回归 ----------
// 官方 GetInventoryItemsWithDescriptions 实际返回 {"response":{...}}（同 GetPlayerSummaries）。
// 此前解析层只认 result/裸对象 → 数据被整体丢弃 → 永远空库存/0/?。
const wrappedInv = parseWebApiInventory({ response: webApiPayload });
assert('webapi.response_wrapper_parse', wrappedInv.items.length === 2 && wrappedInv.assetCount === 2 && wrappedInv.totalInventoryCount === 2, JSON.stringify(wrappedInv));
const wrappedEmpty = parseWebApiInventory({ response: { success: 1, total_inventory_count: 5, assets: [], descriptions: [] } });
assert('webapi.response_wrapper_empty', wrappedEmpty.items.length === 0 && wrappedEmpty.assetCount === 0 && wrappedEmpty.totalInventoryCount === 5, JSON.stringify(wrappedEmpty));
// 兼容 result 包裹（历史会话抓取格式）
const wrappedResult = parseWebApiInventory({ result: webApiPayload });
assert('webapi.result_wrapper_parse', wrappedResult.items.length === 2 && wrappedResult.totalInventoryCount === 2, JSON.stringify(wrappedResult));

// ---------- 13. Skinport 实际成交解析 ----------
const skPayload = [
  {
    market_hash_name: 'Kilowatt Case',
    currency: 'CNY',
    sales: [{
      last_7_days: { min: 9.2, max: 11, avg: '10.1', median: 10, volume: 320 },
      last_30_days: { min: 8.8, max: 11.5, avg: 10.3, median: 10.2, volume: 1500 },
      last_90_days: { min: 8, max: 12, avg: 9.9, median: 9.8, volume: 4300 },
      last_365_days: { min: 7.5, max: 12, avg: 9.5, median: 9.4, volume: 18000 },
    }],
  },
];
const sk = parseSkinportHistory(skPayload);
assert('skinport.parse', !!sk['Kilowatt Case'], Object.keys(sk).join(','));
assert('skinport.d7', sk['Kilowatt Case'].d7.avg === 10.1 && sk['Kilowatt Case'].d7.volume === 320, JSON.stringify(sk['Kilowatt Case'].d7));
assert('skinport.d365', sk['Kilowatt Case'].d365.min === 7.5, JSON.stringify(sk['Kilowatt Case'].d365));
assert('skinport.wrapped', Object.keys(parseSkinportHistory({ items: skPayload })).length === 1);
assert('skinport.empty', Object.keys(parseSkinportHistory(null)).length === 0);

const NOW_MS = new Date('2026-09-25T12:00:00.000Z').getTime();
const hist30 = [];
for (let i = 30; i >= 1; i--) hist30.push({ t: NOW_MS - i * 86400000, price: 10 + (30 - i) * 0.02 }); // 缓涨至 ~10.58
hist30.push({ t: NOW_MS - 2 * 3600000, price: 9.5 }); // 近期跳水
const adv = buildC5BuyAdvice(hist30, 9.5, NOW_MS);
assert('c5_advice.now', adv.now === 9.5, adv.now);
assert('c5_advice.good', adv.suggested === 'good', adv.suggested);
assert('c5_advice.percentile_low', adv.percentile7d != null && adv.percentile7d <= 30, adv.percentile7d);
assert('c5_advice.change1d', adv.change1d != null && adv.change1d < 0, adv.change1d);
const histHigh = [];
for (let i = 30; i >= 1; i--) histHigh.push({ t: NOW_MS - i * 86400000, price: 9 + (30 - i) * 0.02 }); // 9.0 → ~9.58
const advHigh = buildC5BuyAdvice(histHigh, 20, NOW_MS); // 当前 20，远高于近 7 天区间 → wait
assert('c5_advice.high_wait', advHigh.suggested === 'wait', advHigh.suggested);
assert('c5_advice.empty', buildC5BuyAdvice([], null, NOW_MS).suggested === 'ok');

const EVENTS = [
  { name: '测试秋促', start: '2026-10-01', end: '2026-10-08' },
];
// 解锁日 10-03 在活动内 → 等活动结束
const s1 = buildSellAdvice('2026-10-03T08:00:00.000Z', false, EVENTS, new Date('2026-09-25T12:00:00.000Z'));
assert('sell_advice.in_event', s1.code === 'wait_event_pass', JSON.stringify(s1));
// 解锁日 10-12 在回补期（结束 10-08 + 14 天）→ 解锁尽快卖
const s2 = buildSellAdvice('2026-10-12T08:00:00.000Z', false, EVENTS, new Date('2026-09-25T12:00:00.000Z'));
assert('sell_advice.recovery', s2.code === 'sell_at_unlock' && /回补/.test(s2.text), JSON.stringify(s2));
// 已可上架且今天在活动内 → 等回补
const s3 = buildSellAdvice('2026-09-25T11:00:00.000Z', true, EVENTS, new Date('2026-10-05T12:00:00.000Z'));
assert('sell_advice.tradable_in_event', s3.code === 'wait_recovery', JSON.stringify(s3));
// 已可上架、无活动 → 立即卖
const s4 = buildSellAdvice('2026-09-25T11:00:00.000Z', true, EVENTS, new Date('2026-09-25T12:00:00.000Z'));
assert('sell_advice.sell_now', s4.code === 'sell_now', JSON.stringify(s4));
// 解锁 09-28，活动 10-01 开始（3 天后）→ 解锁立即卖
const s5 = buildSellAdvice('2026-09-28T08:00:00.000Z', false, EVENTS, new Date('2026-09-25T12:00:00.000Z'));
assert('sell_advice.before_event', s5.code === 'sell_at_unlock' && /立即卖出/.test(s5.text), JSON.stringify(s5));
// boost 事件（Major）：解锁在窗口内 → 尽快卖；已可上架 → 好时机
const BOOST = [{ name: 'MajorY', start: '2026-11-25', end: '2026-12-13', pressure: 0.02, impact: 'boost' }];
const s6 = buildSellAdvice('2026-11-28T08:00:00.000Z', false, BOOST, new Date('2026-11-20T12:00:00.000Z'));
assert('sell_advice.boost_unlock', s6.code === 'sell_at_unlock' && /提振/.test(s6.text), JSON.stringify(s6));
const s7 = buildSellAdvice('2026-11-20T11:00:00.000Z', true, BOOST, new Date('2026-11-28T12:00:00.000Z'));
assert('sell_advice.boost_now', s7.code === 'sell_now' && /较好的卖出时机/.test(s7.text), JSON.stringify(s7));
// 回归：MarketEvent 直传（有 kind 无 impact）→ 方向按 kind 推断，Major 不得被当成压制
const s8 = buildSellAdvice('2026-11-28T08:00:00.000Z', false, [{ kind: 'major', name: 'MajorZ', start: '2026-11-25', end: '2026-12-13', pressure: 0.02 }], new Date('2026-11-20T12:00:00.000Z'));
assert('sell_advice.kind_infer_boost', /提振/.test(s8.text) && !/压制/.test(s8.text), JSON.stringify(s8));
// 长周期指标：90 天数据 → vol90Pct/distFromMin90d 有值且参与建议
const longSeries = [];
for (let i = 90; i >= 1; i--) longSeries.push({ t: NOW_MS - i * 86400000, price: 8 + Math.sin(i / 6) * 0.6 + (90 - i) * 0.005 });
const advLong = buildC5BuyAdvice(hist30, 9.5, NOW_MS, { longHistory: longSeries });
assert('c5_advice.long_metrics', advLong.vol90Pct != null && advLong.vol90Pct > 0 && advLong.distFromMin90d != null && advLong.longTrend90 != null, JSON.stringify({ v: advLong.vol90Pct, d: advLong.distFromMin90d, t: advLong.longTrend90 }));const histSample = [
  ['2026-06-01T00:00:00.000', '10.5', '123'],
  ['2026-06-02T00:00:00.000', '¥ 11.20', '456'],
  ['2026-06-03T00:00:00.000', '---', '789'], // 无效价格 → 丢弃
  ['bad-date', '9.99'], // 无效日期 → 丢弃
  ['2026-06-04T00:00:00.000', '12.34'], // 无成交量 → null
];
const histPts = parsePriceHistory(histSample, 60);
assert('price_hist.parse_len=3', histPts.length === 3, histPts.length);
assert('price_hist.date', histPts[0].date === '2026-06-01' && histPts[2].date === '2026-06-04', JSON.stringify(histPts));
assert('price_hist.price', near(histPts[1].price, 11.2, 1e-9), histPts[1].price);
assert('price_hist.volume', histPts[0].volume === 123 && histPts[2].volume === null);
assert('price_hist.days_slice', parsePriceHistory(histSample, 2).length === 2 && parsePriceHistory(histSample, 2)[0].date === '2026-06-02');
assert('price_hist.empty', parsePriceHistory(null, 60).length === 0 && parsePriceHistory([], 60).length === 0);

// ---------- 9. C5 官方历史价格解析（弹性提取 dates/prices） ----------
const { parseC5Trend } = require(path.join(outDirC5, 'c5.js'));
const c5Wrapped = {
  status: 200,
  data: { data: { dates: [1756752000, 1756838400, 'invalid', 1757011200000], prices: ['8.50', 9.2, 9.9, '-'] } },
};
const c5Pts = parseC5Trend(c5Wrapped, 60);
assert('c5_hist.parse_len=2', c5Pts.length === 2, JSON.stringify(c5Pts));
assert('c5_hist.date', c5Pts[0].date === '2025-09-01' && c5Pts[1].date === '2025-09-02', JSON.stringify(c5Pts));
assert('c5_hist.price', near(c5Pts[0].price, 8.5, 1e-9) && near(c5Pts[1].price, 9.2, 1e-9));
assert('c5_hist.days_slice', parseC5Trend(c5Wrapped, 1).length === 1 && parseC5Trend(c5Wrapped, 1)[0].price === 9.2);
assert('c5_hist.empty', parseC5Trend({ data: {} }, 60).length === 0 && parseC5Trend(null, 60).length === 0);
const NOW = new Date('2026-09-05T12:00:00.000Z');
const syncItems = [
  { name: 'Kilowatt Case', cnName: '千瓦武器箱', amount: 2, tradable: false, tradableRestrictionDays: 5 },
  { name: 'Revolver Case', cnName: '左轮武器箱', amount: 1, tradable: true, tradableRestrictionDays: 0 },
  { name: 'Dreams & Nightmares Case', cnName: '梦魇武器箱', amount: 3, tradable: false, tradableRestrictionDays: 7 },
];
const syncRows = [
  { id: 1, item_name: '千瓦武器箱' }, // 中文名（手动录入）→ 经 cnName 匹配
  { id: 2, item_name: 'Kilowatt Case', steam_unlock_est_at: '2026-09-08T00:00:00.000Z' }, // 英文名匹配，历史估计更早 → min
  { id: 3, item_name: '不存在的箱子' }, // Steam 没有 → notFound
];
const plan = planSteamSync(syncRows, syncItems, NOW);
assert('steam_sync.matched=2', plan.matched === 2, plan.matched);
assert('steam_sync.notFound=1', plan.notFound === 1, plan.notFound);
assert('steam_sync.imported=2', plan.imported === 2 && plan.newEntries.length === 2, plan.imported);
assert('steam_sync.updates.len=2', plan.updates.length === 2, plan.updates.length);
const up1 = plan.updates.find((u) => u.id === 1);
const up2 = plan.updates.find((u) => u.id === 2);
assert('steam_sync.cn_match.est=+5d', up1 && up1.patch.steam_unlock_est_at === '2026-09-10T12:00:00.000Z', up1 && up1.patch.steam_unlock_est_at);
assert('steam_sync.min_est=prev', up2 && up2.patch.steam_unlock_est_at === '2026-09-08T00:00:00.000Z', up2 && up2.patch.steam_unlock_est_at);
const impRevolver = plan.newEntries.find((e) => e.item_name === 'Revolver Case');
const impDreams = plan.newEntries.find((e) => e.item_name === 'Dreams & Nightmares Case');
assert('steam_sync.import_tradable', !!impRevolver && impRevolver.steam_tradable === true && impRevolver.quantity === 1 && impRevolver.source === 'steam_sync', JSON.stringify(impRevolver));
assert('steam_sync.import_cooldown=+7d', !!impDreams && impDreams.steam_tradable === false && impDreams.quantity === 3 && impDreams.steam_unlock_est_at === '2026-09-12T12:00:00.000Z', JSON.stringify(impDreams));
assert('steam_sync.unlocked=1', plan.unlocked === 1, plan.unlocked);
assert('steam_sync.no_dup_import', plan.newEntries.every((e) => e.item_name !== 'Kilowatt Case'));
assert('steam_sync.est_unlocked_now', estimateCooldown({ tradable: true, tradableRestrictionDays: null }, null, NOW).estAt === NOW.toISOString());
assert('steam_sync.est_default_7d', estimateCooldown({ tradable: false, tradableRestrictionDays: null }, null, NOW).estAt === '2026-09-12T12:00:00.000Z');

// 空库存诊断（v1.5.3）：context 2/16 各自 report 总数 + SteamID 昵称，区分「ID 填错」与「Valve 不返回保护期物品」
assert('empty_reason.ctx16_error', buildEmptySyncReason({ ctx16Error: 'HTTP 429', assetCount: 0, totalInventoryCount: 0, ctx2Total: 0, ctx16Total: null, playerName: '言念如一' }).includes('context 16）失败：HTTP 429') && buildEmptySyncReason({ ctx16Error: 'HTTP 429', assetCount: 0, totalInventoryCount: 0, ctx2Total: 0, ctx16Total: null, playerName: '言念如一' }).includes('context 2 报 0 件、context 16 报 ? 件'));
assert('empty_reason.all_zero', buildEmptySyncReason({ assetCount: 0, totalInventoryCount: 0, ctx2Total: 0, ctx16Total: 0, playerName: '言念如一' }).includes('该账号 CS2 库存里没有任何物品') && buildEmptySyncReason({ assetCount: 0, totalInventoryCount: 0, ctx2Total: 0, ctx16Total: 0, playerName: '言念如一' }).includes('昵称「言念如一」'));
assert('empty_reason.all_zero_hint', buildEmptySyncReason({ assetCount: 0, totalInventoryCount: 0, ctx2Total: 0, ctx16Total: 0, playerName: '言念如一' }).includes('请用 Steam 登录后的会话同步验证'));
assert('empty_reason.nickname_missing', buildEmptySyncReason({ assetCount: 0, totalInventoryCount: 0, ctx2Total: 0, ctx16Total: 0, playerName: null }).includes('无法取得该 SteamID 昵称'));
assert('empty_reason.has_asset_no_case', buildEmptySyncReason({ assetCount: 2, totalInventoryCount: 2, ctx2Total: 2, ctx16Total: 0, playerName: '言念如一' }).includes('Steam 库存可见 2 件物品，但没有武器箱'));
assert('empty_reason.weird_empty', buildEmptySyncReason({ assetCount: 0, totalInventoryCount: 5, ctx2Total: 5, ctx16Total: 0, playerName: null }).includes('报告共 5 件但列表为空'));

// ---------- 12d. v1.5.6：端到端 mock Steam Web API（response 包装） ----------
// 直接驱动 fetchSteamInventoryWebApi：context 2/16 + GetPlayerSummaries 全部返回
// {"response":{...}} 包装，验证 fetchContext 解包后能读到真实库存与总数。
(async () => {
  const realFetch = globalThis.fetch;
  const fakeResp = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('GetInventoryItemsWithDescriptions')) {
      const m = /contextid=(\d+)/.exec(u);
      const contextId = m ? m[1] : '2';
      if (contextId === '2') {
        return fakeResp({ response: { success: 1, total_inventory_count: 1, assets: [
          { appid: '730', contextid: '2', assetid: '1', classid: 'c1', instanceid: 'i1', amount: '1' },
        ], descriptions: [
          { classid: 'c1', instanceid: 'i1', market_hash_name: 'Kilowatt Case', market_name: '千瓦武器箱', tradable: 1, marketable: 1 },
        ] } });
      }
      return fakeResp({ response: { success: 1, total_inventory_count: 0, assets: [], descriptions: [] } });
    }
    if (u.includes('GetPlayerSummaries')) {
      return fakeResp({ response: { players: [{ personaname: '言念如一' }] } });
    }
    throw new Error('unexpected url: ' + u);
  };
  try {
    const webApiResult = await fetchSteamInventoryWebApi('TEST_KEY', '76561198000000000');
    assert('webapi.e2e_response_wrapper', webApiResult.assetCount === 1 && webApiResult.ctx2Total === 1 && webApiResult.ctx16Total === 0 && webApiResult.items.length === 1 && webApiResult.items[0].name === 'Kilowatt Case' && webApiResult.items[0].cnName === '千瓦武器箱' && webApiResult.playerName === '言念如一', JSON.stringify(webApiResult));
  } finally {
    globalThis.fetch = realFetch;
  }
})().then(() => {
  console.log('');
  console.log('PASS ' + passed + ' / ' + (passed + failed));
  if (failed > 0) { console.log(failed + ' FAILED'); process.exit(1); }
  console.log('ALL CORE ASSERTIONS PASSED (TS == Python baseline)');
}).catch((e) => {
  console.error('E2E ERROR ' + e);
  process.exit(1);
});
