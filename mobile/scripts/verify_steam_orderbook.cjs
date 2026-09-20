// V3-PHASE-1：Steam orderbook Spike 离线契约 + 可选在线验证。
// 默认只读 fixture；加 --live 才访问 Steam Community Market。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.verify-orderbook');
const providerPath = path.join(root, 'src', 'providers', 'steam', 'steamOrderbook.ts');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + JSON.stringify(providerPath), {
  cwd: root,
  stdio: 'pipe',
  shell: true,
});

const provider = require(path.join(outDir, 'steamOrderbook.js'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'steam_orderbook_response.json'), 'utf8'));
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

function near(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) <= epsilon;
}

async function runOffline() {
  const parsed = provider.parseSteamOrderbookPayload(fixture, 'Test Case', 1770000000000);
  assert('fixture.sourceKind=steam_first_party_web', parsed.sourceKind === 'steam_first_party_web');
  assert('fixture.highestBuy=142.74', near(parsed.highestBuy, 142.74), parsed.highestBuy);
  assert('fixture.lowestSell=158.12', near(parsed.lowestSell, 158.12), parsed.lowestSell);
  assert('fixture.spread=15.38', near(parsed.spread, 15.38), parsed.spread);
  assert('fixture.spreadPct', near(parsed.spreadPct, 15.38 / 142.74), parsed.spreadPct);
  assert('fixture.buyLevels are per-level quantities', parsed.buyLevels.map((x) => x.quantity).join(',') === '1,2,4');
  assert('fixture.buy cumulative', parsed.buyLevels.map((x) => x.cumulativeQuantity).join(',') === '1,3,7');
  assert('fixture.sell cumulative', parsed.sellLevels.map((x) => x.cumulativeQuantity).join(',') === '2,3,6');
  assert('resolver old Market_LoadOrderSpread', provider.resolveItemNameIdFromListingHtml('Market_LoadOrderSpread( 175917356 )') === '175917356');
  assert('resolver current SSR missing is explicit', provider.resolveItemNameIdFromListingHtml('<html>current SSR</html>') === null);

  const legacy = provider.parseSteamOrderbookPayload({
    success: 1,
    highest_buy_order: 4033,
    lowest_sell_order: 4343,
    buy_order_graph: [
      { price: 40.33, volume: 2 },
      { price: 40.00, volume: 5 },
    ],
    sell_order_graph: [
      { price: 43.43, volume: 3 },
      { price: 44.00, volume: 8 },
    ],
  }, 'Legacy Case', 1770000000000, '175917356');
  assert('legacy.itemNameId', legacy.itemNameId === '175917356');
  assert('legacy.graph prices are already major units', near(legacy.highestBuy, 40.33) && near(legacy.lowestSell, 43.43));
  assert('legacy graph cumulative converted to levels', legacy.buyLevels.map((x) => x.quantity).join(',') === '2,3');

  const malformed = { data: { success: true, data: { amtMaxBuyOrder: 100, amtMinSellOrder: 110, rgCompactBuyOrders: [100], rgCompactSellOrders: [110, 1] } } };
  try {
    provider.parseSteamOrderbookPayload(malformed, 'Malformed');
    assert('malformed compact pair rejected', false);
  } catch (error) {
    assert('malformed compact pair rejected', error.code === 'malformed_response', error.code);
  }

  let fetchCalls = 0;
  let seenUrl = '';
  let seenHeaders = {};
  const fake = new provider.SteamOrderbookProvider({
    minRequestIntervalMs: 0,
    retries: 1,
    backoffMs: 0,
    fetchImpl: async (url, init) => {
      fetchCalls++;
      seenUrl = String(url);
      seenHeaders = init.headers;
      if (fetchCalls === 1) return new Response('', { status: 429 });
      return new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const mocked = await fake.getOrderbook('中文 Case & 特殊');
  const qp = new URL(seenUrl).searchParams.get('qp');
  assert('429 retries once', fetchCalls === 2, fetchCalls);
  assert('name-based qp preserves special name', JSON.stringify(JSON.parse(qp)) === JSON.stringify([730, '中文 Case & 特殊']));
  assert('name-based request type header', seenHeaders['x-valve-request-type'] === 'queryAction');
  assert('mocked response parsed', mocked.buyLevels.length === 3 && mocked.sellLevels.length === 3);
  assert('health success after retry', fake.health().ok === true && fake.health().consecutiveFailures === 0);

  const failure = new provider.SteamOrderbookProvider({
    minRequestIntervalMs: 0,
    retries: 0,
    fetchImpl: async () => new Response('{bad', { status: 200 }),
  });
  try {
    await failure.getOrderbook('Malformed JSON');
    assert('malformed JSON diagnostic', false);
  } catch (error) {
    assert('malformed JSON diagnostic', error.code === 'malformed_response', error.code);
    assert('health failure diagnostic', failure.health().ok === false && failure.health().reason.includes('malformed_response'));
  }
}

async function runLive() {
  const names = [
    'CS:GO Weapon Case',
    'Dreams & Nightmares Case',
    'Kilowatt Case',
    'Revolution Case',
    'Fracture Case',
    'Sealed Dead Hand Terminal',
  ];
  const live = new provider.SteamOrderbookProvider({
    timeoutMs: Number(process.env.STEAM_ORDERBOOK_TIMEOUT_MS || 12000),
    retries: Number(process.env.STEAM_ORDERBOOK_RETRIES || 2),
    minRequestIntervalMs: Number(process.env.STEAM_ORDERBOOK_DELAY_MS || 1200),
  });
  let success = 0;
  console.log('--- 在线验证：' + names.length + ' 个目标物品（串行） ---');
  for (const name of names) {
    const started = Date.now();
    try {
      const result = await live.getOrderbook(name);
      const valid = result.highestBuy > 0 && result.lowestSell > 0 && result.buyLevels.length > 0 && result.sellLevels.length > 0;
      if (valid) success++;
      console.log(JSON.stringify({ name, ok: valid, highestBuy: result.highestBuy, lowestSell: result.lowestSell, spread: result.spread, buyLevels: result.buyLevels.length, sellLevels: result.sellLevels.length, fetchedAt: result.fetchedAt, sourceKind: result.sourceKind, elapsedMs: Date.now() - started }));
    } catch (error) {
      console.log(JSON.stringify({ name, ok: false, code: error.code, status: error.status, message: error.message, attempts: error.attempts, elapsedMs: Date.now() - started }));
    }
  }
  console.log('在线成功率：' + success + '/' + names.length + ' = ' + ((success / names.length) * 100).toFixed(1) + '%');
  console.log('ProviderHealth：' + JSON.stringify(live.health()));
  try {
    await live.resolveItemNameId(names[0]);
    console.log('legacy item_nameid：当前页面仍可解析');
  } catch (error) {
    console.log('legacy item_nameid：' + error.code + '（不影响当前 name-based orderbook）');
  }
  if (success / names.length < 0.9) process.exitCode = 1;
}

runOffline()
  .then(() => process.argv.includes('--live') ? runLive() : undefined)
  .then(() => {
    console.log('');
    console.log('PASS ' + passed + ' / ' + (passed + failed));
    if (failed > 0) process.exitCode = 1;
    else console.log('ALL STEAM ORDERBOOK OFFLINE ASSERTIONS PASSED');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
