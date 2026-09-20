// ssr_live_check.cjs —— 实网验证：直连 Steam 市场页抓历史（零 cookie）是否可用
// 用法: node scripts/ssr_live_check.cjs
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, '.ssr-live');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execSync(
  'npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(out) +
    ' ' + JSON.stringify(path.join(root, 'src', 'data', 'steamHistorySsr.ts')),
  { cwd: root, stdio: 'pipe', shell: true },
);
const m = require(path.join(out, 'steamHistorySsr.js'));

const names = process.argv.slice(2);
if (names.length === 0) names.push('Sealed Dead Hand Terminal', 'Kilowatt Case');

(async () => {
  let fail = 0;
  for (const name of names) {
    try {
      const pts = await m.fetchSteamHistorySsr(name, 365);
      const first = pts[0];
      const last = pts[pts.length - 1];
      console.log(`PASS ${name} -> ${pts.length} days, ${first.date} .. ${last.date}, last ¥${last.price}`);
      if (pts.length < 30) { fail++; console.log('  WARN 点数偏少'); }
    } catch (e) {
      fail++;
      console.log(`FAIL ${name} -> ${e.message}`);
    }
  }
  console.log(fail === 0 ? 'ALL SSR LIVE CHECKS PASSED' : `${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
