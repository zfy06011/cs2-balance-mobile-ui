// gen_backtest_fixture.cjs —— 从 Steam SSR 直连抓取若干箱历史，生成回测 fixture
// 用法: node --use-system-ca scripts/gen_backtest_fixture.cjs
// 产物: backend/scripts/backtest_fixture.json  { generatedAt, boxes: [{ name, points: [[ts, price, volume], ...] }] }
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, '.fixture-build');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execSync(
  'npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(out) +
    ' ' + JSON.stringify(path.join(root, 'src', 'data', 'steamHistorySsr.ts')),
  { cwd: root, stdio: 'pipe', shell: true },
);
const m = require(path.join(out, 'steamHistorySsr.js'));

const NAMES = [
  'Kilowatt Case',
  'Revolution Case',
  'Recoil Case',
  'Dreams & Nightmares Case',
  'Fracture Case',
  'Gallery Case',
  'Sealed Dead Hand Terminal',
  'Operation Riptide Case',
];

(async () => {
  const boxes = [];
  for (const name of NAMES) {
    try {
      const daily = await m.fetchSteamHistorySsr(name, 900);
      if (daily.length < 60) { console.log(`skip ${name} (${daily.length} pts)`); continue; }
      const points = daily.map((p) => [Math.floor(new Date(`${p.date}T08:00:00.000Z`).getTime() / 1000), p.price, p.volume ?? 0]);
      boxes.push({ name, points });
      console.log(`ok ${name}: ${daily.length} days`);
    } catch (e) {
      console.log(`fail ${name}: ${e.message}`);
    }
  }
  const target = path.resolve(root, '..', 'backend', 'scripts', 'backtest_fixture.json');
  fs.writeFileSync(target, JSON.stringify({ generatedAt: new Date().toISOString(), boxes }, null, 0));
  console.log(`\nwrote ${boxes.length} boxes -> ${target} (${(fs.statSync(target).size / 1024).toFixed(1)} KB)`);
})();
