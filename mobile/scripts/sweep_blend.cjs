// sweep_blend.cjs —— 回测调参：扫描 momentumBlend，选 MAE/RMSE/方向/覆盖综合最优
// 用法: node scripts/sweep_blend.cjs
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.sweep-build');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const coreDir = path.join(root, 'src', 'core');
execSync(
  'npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) +
    ' ' + JSON.stringify(path.join(coreDir, 'prediction.ts')) + ' ' + JSON.stringify(path.join(coreDir, 'types.ts')),
  { cwd: root, stdio: 'pipe', shell: true },
);
const { BaselinePredictorV3, BaselinePredictorV4 } = require(path.join(outDir, 'prediction.js'));
const fixture = JSON.parse(fs.readFileSync(path.resolve(root, '..', 'backend', 'scripts', 'backtest_fixture.json'), 'utf-8'));
const H = 7;
const W = 200;

function evaluate(make) {
  let n = 0, ae = 0, se = 0, dh = 0, dt = 0, cov = 0;
  for (const b of fixture.boxes) {
    const pr = b.points.map((p) => p[1]);
    const ts = b.points.map((p) => p[0] * 1000);
    const vo = b.points.map((p) => p[2]);
    if (pr.length < W + H + 1) continue;
    for (let i = W; i + H < pr.length; i++) {
      const hist = pr.slice(0, i + 1);
      let pred;
      try {
        pred = make().predict({
          marketHashName: b.name,
          prices: hist,
          predictedAt: new Date(ts[i]),
          timestamps: ts.slice(0, i + 1),
          volumes: vo.slice(0, i + 1),
          volume: vo[i],
          volumeHistory: vo.slice(0, i + 1).slice(-60),
        });
      } catch { continue; }
      const a = pr[i + H];
      const e = pred.p50 - a;
      n++; ae += Math.abs(e); se += e * e;
      const pd = pred.p50 - hist[hist.length - 1];
      const ad = a - hist[hist.length - 1];
      if (pd !== 0 && ad !== 0) { dt++; if ((pd > 0) === (ad > 0)) dh++; }
      if (a >= pred.p10 && a <= pred.p90) cov++;
    }
  }
  return n ? { n, mae: ae / n, rmse: Math.sqrt(se / n), dir: (dh / dt) * 100, cov: (cov / n) * 100 } : null;
}

const rows = [];
const r3 = evaluate(() => new BaselinePredictorV3());
rows.push(['V3', r3]);
for (const w of [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
  rows.push(['V4 blend=' + w, evaluate(() => new BaselinePredictorV4(7, 21, 0.5, 15, 3, 0.94, 0.02, 0.5, 180, w))]);
}

console.log('模型              样本     MAE      RMSE    方向%   覆盖%');
for (const [label, r] of rows) {
  if (!r) { console.log(label.padEnd(18) + ' n/a'); continue; }
  console.log(
    label.padEnd(18) + String(r.n).padStart(6) + '  ' +
    r.mae.toFixed(4) + '  ' + r.rmse.toFixed(4) + '  ' + r.dir.toFixed(1).padStart(5) + '  ' + r.cov.toFixed(1).padStart(5),
  );
}
