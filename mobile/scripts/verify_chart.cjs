// verify_chart.cjs —— 趋势图路径契约（v1.8.5 闪退修复回归）
// 用法: node scripts/verify_chart.cjs
//
// 背景：react-native-svg 原生 PathParser 遇到非法 d（不以 M 开头 / 含 NaN）会抛
// IllegalArgumentException，主线程未捕获 → 进程被杀（无 JS 报错，表现为直接闪退）。
// 线上堆栈：java.lang.IllegalArgumentException: Unexpected character 'L'
//           (i=1, s= L -240.0 132.0 L 44.0 132.0 Z)
// 本测试断言 buildTrendPaths 永不产出这种路径。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, '.chart-build');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execSync(
  'npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(out) +
    ' ' + JSON.stringify(path.join(root, 'src', 'components', 'chartPaths.ts')),
  { cwd: root, stdio: 'pipe', shell: true },
);

const cp = require(path.join(out, 'chartPaths.js'));
const build = cp.buildTrendPaths;
const isValid = cp.isValidSvgPath;

let failed = 0, passed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? '  got: ' + JSON.stringify(extra) : '')); }
}

const GEOM = { width: 340, height: 160, volumeHeight: 40 };
const PRED = { p25: 90, p50: 100, p75: 110 };

// 1) 线上崩溃复现：0 个历史点 + 有预测
//    修复前：linePath = ""、areaPath = " L x y L x y Z"（无 M 起始）→ 原生解析崩溃
//    线上真实堆栈（Xiaomi 14，1200x2670）：
//      Unexpected character 'L' (i=1, s= L -240.0 132.0 L 44.0 132.0 Z)
//    其中 -240.0 = PADDING_LEFT(44) - (points.length-1)*xStep，points 为空时 xStep=chartW。
const empty = build([], PRED, GEOM);
assert('0 点 + 有预测：返回非 null（有预测可画）', empty !== null, empty === null);
assert('0 点 + 有预测：linePath 为 null（不渲染折线）', empty && empty.linePath === null, empty && empty.linePath);
assert('0 点 + 有预测：areaPath 为 null', empty && empty.areaPath === null, empty && empty.areaPath);
assert('0 点 + 有预测：predPath 为 null（无历史线则不画扇区）', empty && empty.predPath === null, empty && empty.predPath);
// 直接断言「不再产出线上那条非法路径」
const legacyBad = ' L -240.0 132.0 L 44.0 132.0 Z';
assert('不再产出线上崩溃路径', empty && empty.areaPath !== legacyBad, empty && empty.areaPath);

// 2) 1 个历史点 + 有预测（第二危险的边界：仍不足以成线）
const one = build([{ price: 100, volume: 5 }], PRED, GEOM);
assert('1 点 + 有预测：linePath 为 null', one && one.linePath === null, one && one.linePath);
assert('1 点 + 有预测：predPath 为 null', one && one.predPath === null, one && one.predPath);

// 3) 2 个点（最小可画）
const two = build([{ price: 100, volume: 5 }, { price: 110, volume: 7 }], null, GEOM);
assert('2 点：linePath 以 M 开头', two && /^M\s/.test(two.linePath), two && two.linePath);
assert('2 点：areaPath 合法', two && isValid(two.areaPath), two && two.areaPath);

// 4) 正常历史 + 预测：所有路径合法
const many = [];
for (let i = 0; i < 30; i++) many.push({ price: 100 + Math.sin(i / 3) * 10, volume: 10 + i });
const full = build(many, PRED, GEOM);
assert('30 点 + 预测：linePath 合法', full && isValid(full.linePath), full && full.linePath);
assert('30 点 + 预测：areaPath 合法', full && isValid(full.areaPath), full && full.areaPath);
assert('30 点 + 预测：predPath 合法', full && isValid(full.predPath), full && full.predPath);
assert('30 点 + 预测：predP50 存在且有限', full && full.predP50 && Number.isFinite(full.predP50.x) && Number.isFinite(full.predP50.y), full && full.predP50);

// 5) 预测含 NaN / 0 / 负值：必须整体忽略预测（不产生非法路径）
for (const bad of [{ p25: NaN, p50: 100, p75: 110 }, { p25: 90, p50: 0, p75: 110 }, { p25: -1, p50: 100, p75: 110 }, { p25: Infinity, p50: 100, p75: 110 }]) {
  const r = build(many, bad, GEOM);
  assert('非法预测 ' + JSON.stringify(bad) + '：predPath 为 null', r && r.predPath === null, r && r.predPath);
  assert('非法预测 ' + JSON.stringify(bad) + '：linePath 仍合法', r && isValid(r.linePath), r && r.linePath);
}

// 6) 历史价格含 NaN/0/负值：过滤后按有效点计算，路径仍合法
const dirty = [
  { price: 100, volume: 1 },
  { price: NaN, volume: 2 },
  { price: 0, volume: 3 },
  { price: -5, volume: 4 },
  { price: 120, volume: 5 },
];
const dr = build(dirty, null, GEOM);
assert('脏数据：linePath 合法（只取有效点）', dr && isValid(dr.linePath), dr && dr.linePath);

// 7) 全部无效 → null（调用方渲染空态）
const allBad = build([{ price: NaN }, { price: 0 }, { price: -1 }], null, GEOM);
assert('全无效点：返回 null', allBad === null, allBad);

// 8) 价格完全相等（价格区间为 0）：不产生 NaN
const flat = build([{ price: 50, volume: 1 }, { price: 50, volume: 2 }, { price: 50, volume: 3 }], null, GEOM);
assert('价格恒等：linePath 合法', flat && isValid(flat.linePath), flat && flat.linePath);
assert('价格恒等：areaPath 合法', flat && isValid(flat.areaPath), flat && flat.areaPath);

// 9) 宽度/高度异常：不崩、不产生 NaN
for (const g of [{ width: 0, height: 0, volumeHeight: 0 }, { width: NaN, height: 160, volumeHeight: 40 }, { width: 340, height: -10, volumeHeight: 0 }]) {
  const r = build(many, PRED, g);
  assert('异常几何 ' + JSON.stringify(g) + '：路径合法', r === null || (isValid(r.linePath) && isValid(r.areaPath) && isValid(r.predPath)), r);
}

// 10) 所有非空路径统一校验
for (const [label, r] of [['empty', empty], ['one', one], ['two', two], ['full', full], ['dirty', dr], ['flat', flat]]) {
  if (!r) continue;
  assert('统一校验 ' + label + '：line/area/pred 均合法', isValid(r.linePath) && isValid(r.areaPath) && isValid(r.predPath));
}

console.log('');
console.log(`PASS ${passed} / ${passed + failed}`);
if (failed > 0) { console.log('CHART PATH CONTRACT TESTS FAILED'); process.exit(1); }
console.log('ALL CHART PATH CONTRACT TESTS PASSED');
