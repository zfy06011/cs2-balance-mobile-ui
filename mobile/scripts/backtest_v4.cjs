// backtest_v4.cjs —— 离线回测：walk-forward 对比 V3 与 V4（MAE / RMSE / 方向准确率 / 区间覆盖率）
// 用法: node scripts/backtest_v4.cjs
// 数据源: backend/scripts/backtest_fixture.json（由 gen_backtest_fixture.cjs 生成，离线可跑）
//
// 方法：对每箱，从第 warmup 个点起滚动预测 7 天后价格（只用当时可见的历史），
// 与实际值比较。这是标准 walk-forward，无未来信息泄漏。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.backtest-build');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const coreDir = path.join(root, 'src', 'core');
const files = ['prediction.ts', 'types.ts']
  .map((f) => JSON.stringify(path.join(coreDir, f)))
  .join(' ');
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + files, {
  cwd: root,
  stdio: 'pipe',
  shell: true,
});

const { BaselinePredictorV3, BaselinePredictorV4 } = require(path.join(outDir, 'prediction.js'));

const FIXTURE = path.resolve(root, '..', 'backend', 'scripts', 'backtest_fixture.json');
const HORIZON = 7;
const WARMUP = 200; // 至少 200 天历史才开始预测（保证 V4 长周期特征可用）
const STEP = 1;

function evaluate(model, boxes) {
  let n = 0;
  let sumAbsErr = 0;
  let sumSqErr = 0;
  let sumApe = 0;
  let dirHit = 0;
  let dirTotal = 0;
  let covered = 0;
  for (const box of boxes) {
    const prices = box.points.map((p) => p[1]);
    const ts = box.points.map((p) => p[0] * 1000);
    const vols = box.points.map((p) => p[2]);
    if (prices.length < WARMUP + HORIZON + 1) continue;
    for (let i = WARMUP; i + HORIZON < prices.length; i += STEP) {
      const hist = prices.slice(0, i + 1);
      const histTs = ts.slice(0, i + 1);
      const histVols = vols.slice(0, i + 1);
      const actual = prices[i + HORIZON];
      const at = new Date(ts[i]);
      let pred;
      try {
        pred = model.predict({
          marketHashName: box.name,
          prices: hist,
          predictedAt: at,
          timestamps: histTs,
          volumes: histVols,
          volume: histVols[histVols.length - 1],
          volumeHistory: histVols.slice(-60),
        });
      } catch {
        continue;
      }
      const err = pred.p50 - actual;
      n++;
      sumAbsErr += Math.abs(err);
      sumSqErr += err * err;
      sumApe += Math.abs(err) / actual;
      // 方向：预测涨跌 vs 实际涨跌
      const predDir = pred.p50 - hist[hist.length - 1];
      const actDir = actual - hist[hist.length - 1];
      if (predDir !== 0 && actDir !== 0) {
        dirTotal++;
        if ((predDir > 0) === (actDir > 0)) dirHit++;
      }
      if (actual >= pred.p10 && actual <= pred.p90) covered++;
    }
  }
  if (n === 0) return null;
  return {
    n,
    mae: sumAbsErr / n,
    rmse: Math.sqrt(sumSqErr / n),
    mape: (sumApe / n) * 100,
    dirAcc: dirTotal > 0 ? (dirHit / dirTotal) * 100 : 0,
    coverage: (covered / n) * 100,
  };
}

function fmt(v, d = 4) { return v == null ? '  --  ' : v.toFixed(d); }

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
const boxes = fixture.boxes.filter((b) => b.points.length >= WARMUP + HORIZON + 1);
console.log(`fixture: ${fixture.boxes.length} boxes (${boxes.length} 可用于回测), horizon=${HORIZON}d, warmup=${WARMUP}d`);
console.log(`生成时间: ${fixture.generatedAt}\n`);

const r3 = evaluate(new BaselinePredictorV3(), boxes);
const r4 = evaluate(new BaselinePredictorV4(), boxes);

console.log('模型             样本数    MAE      RMSE     MAPE%    方向准确%   区间覆盖%(P10-P90)');
console.log('----------------------------------------------------------------------------------------');
for (const [label, r] of [['V3 (EW-OLS)', r3], ['V4 (Theil-Sen)', r4]]) {
  if (!r) { console.log(`${label.padEnd(16)} 无足够样本`); continue; }
  console.log(
    `${label.padEnd(16)} ${String(r.n).padStart(6)}  ${fmt(r.mae)}  ${fmt(r.rmse)}  ${fmt(r.mape, 2).padStart(6)}  ${fmt(r.dirAcc, 1).padStart(9)}  ${fmt(r.coverage, 1).padStart(14)}`,
  );
}

if (r3 && r4) {
  const better = r4.mae < r3.mae;
  console.log(`\nV4 vs V3: MAE ${better ? '更低 ✅' : '未更低 ⚠️'}（${fmt(r4.mae)} vs ${fmt(r3.mae)}），RMSE ${r4.rmse < r3.rmse ? '更低 ✅' : '未更低 ⚠️'}，方向准确率 ${r4.dirAcc >= r3.dirAcc ? '不劣 ✅' : '略低 ⚠️'}`);
}
