// V3-PHASE-2.1：Steam 低价手续费模型审计。
// 结论应保持 PASS-B：验证项目既有固定比例模型，但不宣称已确认 Steam 低价取整规则。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.verify-steam-fee-audit');
const core = (name) => path.join(root, 'src', 'core', name);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + [
  core('fees.ts'), core('profit.ts'),
].map(JSON.stringify).join(' '), { cwd: root, stdio: 'pipe', shell: true });

const compiled = (name) => path.join(outDir, name);
const { DEFAULT_FEES, STEAM_FEE_MODEL } = require(compiled('fees.js'));
const { ProfitCalculator } = require(compiled('profit.js'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'steam_fee', 'cases.json'), 'utf8'));

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
function near(a, b, epsilon = 1e-12) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
}

const calc = new ProfitCalculator(DEFAULT_FEES.c5_buy_fee_ratio, DEFAULT_FEES.steam_seller_receive_ratio);
assert('model name is estimatedSteamNetReceive', STEAM_FEE_MODEL.name === 'estimatedSteamNetReceive');
assert('model marked approximate', STEAM_FEE_MODEL.kind === 'approximate' && STEAM_FEE_MODEL.exact === false);
assert('model uses CNY', STEAM_FEE_MODEL.unit === 'CNY');
assert('fixture does not claim exact first-party settlement', fixture.exactNetAvailable === false);
console.log('gross\testimated_net\texact_net\tdifference\tdifference_pct\tstatus');
for (const gross of fixture.grossYuan) {
  const estimated = calc.steamNetReceive(gross);
  const expected = gross * DEFAULT_FEES.steam_seller_receive_ratio;
  const row = {
    gross,
    estimated_net: estimated,
    exact_net: null,
    difference: null,
    difference_pct: null,
    status: 'approximate_no_first_party_settlement_fixture',
  };
  console.log([gross.toFixed(2), estimated.toFixed(8), '-', '-', '-', row.status].join('\t'));
  assert(`formula ${gross.toFixed(2)}`, near(estimated, expected), `${estimated} vs ${expected}`);
  assert(`finite ${gross.toFixed(2)}`, Number.isFinite(estimated));
}
assert('default receive ratio=0.8696', DEFAULT_FEES.steam_seller_receive_ratio === 0.8696);
assert('audit explicitly PASS-B', fixture.exactNetAvailable === false && STEAM_FEE_MODEL.exact === false);

console.log('');
console.log('PASS ' + passed + ' / ' + (passed + failed));
if (failed > 0) {
  console.log(failed + ' FAILED');
  process.exitCode = 1;
} else {
  console.log('PASS-B: STEAM FEE MODEL IS EXPLICITLY APPROXIMATE');
}
