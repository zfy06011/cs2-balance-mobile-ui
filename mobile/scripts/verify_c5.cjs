// verify_c5.cjs —— C5GAME OpenAPI 冒烟验证脚本
// 用法: $env:C5_APP_KEY='你的app-key'; npm run verify:c5
// 用真实 app-key 调用 C5 批量价格接口，确认返回价格能进入引擎收益计算。
// 未设置 C5_APP_KEY 时跳过（不把个人凭证写进仓库）。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.verify-c5-build');
const src = (f) => path.join(root, 'src', f);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' +
  [src('data/c5.ts'), src('core/profit.ts'), src('core/types.ts'), src('core/fees.ts')].map((f) => JSON.stringify(f)).join(' '), {
  cwd: root, stdio: 'pipe', shell: true,
});

const { fetchC5Price, fetchC5StatsBulk } = require(path.join(outDir, 'data', 'c5.js'));
const { ProfitCalculator } = require(path.join(outDir, 'core', 'profit.js'));

const KEY = process.env.C5_APP_KEY || '';
if (!KEY) {
  console.log('SKIP 未设置 C5_APP_KEY，跳过在线验证（本地逻辑未变，typecheck 已覆盖）');
  process.exit(0);
}

let failed = 0;
function assert(name, cond, extra) {
  if (cond) { console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? '  got: ' + extra : '')); }
}

async function main() {
  const name = 'AK-47 | Redline (Field-Tested)';
  // 1) 空 key 必须返回 null（手动录入兜底分支）
  assert('空 key 返回 null', (await fetchC5Price(name, '')) === null);


  // 1.5) stat 求购统计（stat 接口，无需 IP 白名单）
  let st = null;
  try {
    st = (await fetchC5StatsBulk(['AK-47 | Redline (Field-Tested)'], KEY))['AK-47 | Redline (Field-Tested)'];
  } catch (e) {
    assert('C5 stat 请求无异常', false, String(e));
  }
  assert('C5 stat 返回对象', st == null || (typeof st === 'object' && 'purchaseMaxPrice' in st), JSON.stringify(st));
  if (st && st.purchaseMaxPrice != null) {
    console.log('C5 ' + name + ' 求购最高价 = ' + st.purchaseMaxPrice + ' 元（可秒出参考）');
  }

  // 2) 真实 app-key 拉取在售最低价（单位：元）
  let price = null;
  try {
    price = await fetchC5Price(name, KEY);
  } catch (e) {
    assert('C5 请求无异常', false, String(e));
  }
  assert('C5 返回正价格', price != null && price > 0 && price < 100000, price);
  if (price == null || price <= 0) {
    console.log('网络或 key 问题，其余断言跳过');
    process.exit(failed ? 1 : 0);
  }
  console.log('C5 ' + name + ' 在售最低价 = ' + price + ' 元');

  // 3) 进入引擎收益计算：C5 买入 → Steam 卖出
  // Steam 卖出到账比例约 86.96%（扣 13%），C5 买入手续费 1%：
  // 需售价约 ≥ C5 价 / 0.8696 / (1-0.01)，取 1.25 倍保证覆盖。
  const calc = new ProfitCalculator();
  const r1 = calc.calculate(price, price * 1.25);
  assert('引擎收益计算通过（ROI 为正）', Number.isFinite(r1.net_profit) && r1.net_profit > 0, JSON.stringify(r1));
  const r2 = calc.calculate(price, price * 0.9);
  assert('引擎收益计算通过（亏损分支）', Number.isFinite(r2.net_profit) && r2.net_profit < 0, JSON.stringify(r2));

  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
