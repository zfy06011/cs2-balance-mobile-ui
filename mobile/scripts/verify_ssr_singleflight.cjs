// verify_ssr_singleflight.cjs —— 验证 SSR 抓取「单飞 + 全局串行」逻辑（打桩 fetch，不联网）
// 用法: node scripts/verify_ssr_singleflight.cjs
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, '.ssr-sf');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execSync(
  'npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(out) +
    ' ' + JSON.stringify(path.join(root, 'src', 'data', 'steamHistorySsr.ts')),
  { cwd: root, stdio: 'pipe', shell: true },
);

let failed = 0, passed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? '  got: ' + JSON.stringify(extra) : '')); }
}

// 打桩：统计真实 fetch 次数与并发峰值
let fetchCount = 0;
let concurrent = 0;
let peakConcurrent = 0;
let inFlightNow = 0;
const delays = [];

global.fetch = async (url, init) => {
  fetchCount++;
  inFlightNow++;
  peakConcurrent = Math.max(peakConcurrent, inFlightNow);
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 60));
  delays.push(Date.now() - t0);
  inFlightNow--;
  // 构造一个最小可解析的 SSR 页（双重编码 JSON）
  const inner = {
    queryData: JSON.stringify({
      queries: [{
        queryKey: ['market', 'pricehistory', 730, 'X'],
        state: { data: { prices: [{ time: 1756684800, price_median: 10, purchases: 1 }] } },
      }],
    }),
  };
  const html = '<html><script>window.SSR.renderContext=JSON.parse(' + JSON.stringify(JSON.stringify(inner)) + ');</script></html>';
  return { ok: true, status: 200, text: async () => html };
};

const m = require(path.join(out, 'steamHistorySsr.js'));

(async () => {
  // 1) 同名并发 5 次 → 只应发生 1 次真实下载
  fetchCount = 0; peakConcurrent = 0;
  const same = await Promise.all([
    m.fetchSteamHistorySsr('Same Case', 365),
    m.fetchSteamHistorySsr('Same Case', 365),
    m.fetchSteamHistorySsr('Same Case', 365),
    m.fetchSteamHistorySsr('Same Case', 365),
    m.fetchSteamHistorySsr('Same Case', 365),
  ]);
  assert('同名并发只下载 1 次', fetchCount === 1, fetchCount);
  assert('同名并发 5 个结果都成功', same.every((x) => Array.isArray(x) && x.length === 1), same.map((x) => x.length));

  // 2) 不同名并发 3 个 → 全局串行，并发峰值必须是 1
  fetchCount = 0; peakConcurrent = 0;
  await Promise.all([
    m.fetchSteamHistorySsr('A Case', 365),
    m.fetchSteamHistorySsr('B Case', 365),
    m.fetchSteamHistorySsr('C Case', 365),
  ]);
  assert('不同名共下载 3 次', fetchCount === 3, fetchCount);
  assert('全局串行：并发峰值 = 1', peakConcurrent === 1, peakConcurrent);

  // 3) 串行后仍能重复调用（链不会卡死）
  fetchCount = 0;
  await m.fetchSteamHistorySsr('D Case', 365);
  await m.fetchSteamHistorySsr('D Case', 365);
  assert('串行链可重复使用（第二次为新下载）', fetchCount === 2, fetchCount);

  // 4) 失败不应污染后续调用
  let failOnce = true;
  const realFetch = global.fetch;
  global.fetch = async () => { if (failOnce) { failOnce = false; throw new Error('boom'); } return realFetch(); };
  let threw = false;
  try { await m.fetchSteamHistorySsr('E Case', 365); } catch { threw = true; }
  assert('首次失败抛出', threw === true);
  const ok = await m.fetchSteamHistorySsr('E Case', 365);
  assert('失败后同名重试可成功', Array.isArray(ok) && ok.length === 1, ok && ok.length);
  global.fetch = realFetch;

  console.log('');
  console.log(`PASS ${passed} / ${passed + failed}`);
  if (failed > 0) { console.log('SSR SINGLE-FLIGHT TESTS FAILED'); process.exit(1); }
  console.log('ALL SSR SINGLE-FLIGHT TESTS PASSED');
})();
