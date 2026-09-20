// V3-PHASE-3B：CLI-only Opportunity v2 Shadow Runner。
// 只读组合 Steam/C5/V4/旧 Radar，绝不接入 App 页面或生产 API。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(__dirname, '.shadow-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });
const source = (p) => path.join(root, 'src', p);
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(buildDir) + ' ' + [
  source('core/opportunityShadow.ts'), source('core/opportunityV2.ts'), source('core/types/opportunity.ts'),
  source('core/discountV2.ts'), source('core/liquidity.ts'), source('core/marketQuality.ts'), source('core/fees.ts'), source('core/profit.ts'),
  source('core/prediction.ts'), source('core/radar.ts'),
  source('providers/steam/steamOrderbook.ts'), source('data/c5.ts'), source('data/caseFilter.ts'), source('data/steam.ts'), source('data/steamHistorySsr.ts'),
].map(JSON.stringify).join(' '), { cwd: root, stdio: 'pipe', shell: true });

const compiled = (p) => path.join(buildDir, p);
const { SteamOrderbookProvider } = require(compiled('providers/steam/steamOrderbook.js'));
const { fetchC5PricesBulk, fetchC5StatsBulk } = require(compiled('data/c5.js'));
const { fetchSteamPrice, searchCases } = require(compiled('data/steam.js'));
const { isTrackedCase } = require(compiled('data/caseFilter.js'));
const { fetchSteamHistorySsr } = require(compiled('data/steamHistorySsr.js'));
const { BaselinePredictorV4 } = require(compiled('core/prediction.js'));
const { evaluateRadar } = require(compiled('core/radar.js'));
const { ProfitCalculator } = require(compiled('core/profit.js'));
const { buildDiscountV2 } = require(compiled('core/discountV2.js'));
const { buildOpportunityV2 } = require(compiled('core/opportunityV2.js'));
const shadow = require(compiled('core/opportunityShadow.js'));

const DEFAULT_NAMES = [
  'CS:GO Weapon Case', 'Dreams & Nightmares Case', 'Kilowatt Case', 'Revolution Case',
  'Fracture Case', 'Sealed Dead Hand Terminal', 'Fever Case', 'Prisma 2 Case',
  'Snakebite Case', 'Clutch Case', 'Danger Zone Case', 'Horizon Case', 'Prisma Case',
  'Spectrum 2 Case', 'Gamma 2 Case', 'Glove Case', 'Chroma 3 Case', 'Operation Wildfire Case',
  'Shadow Case', 'Recoil Case',
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] != null ? process.argv[index + 1] : fallback;
}

function parseNames() {
  const file = argValue('--names', null);
  if (!file) return { names: DEFAULT_NAMES.slice(), poolSourceByName: Object.fromEntries(DEFAULT_NAMES.map((name) => [name, 'manual_fallback'])) };
  const names = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return { names, poolSourceByName: Object.fromEntries(names.map((name) => [name, 'names_file'])) };
}

async function resolveCandidates(limit, forecastBundle, orderbookBundle) {
  const frozenItems = orderbookBundle?.items || forecastBundle?.items;
  if (frozenItems) {
    const names = Object.keys(frozenItems).slice(0, limit);
    return { names, universeCount: Object.keys(forecastBundle.items).length, poolSourceByName: Object.fromEntries(names.map((name) => [name, 'frozen_bundle'])) };
  }
  const parsed = parseNames();
  if (!process.argv.includes('--universe')) return { names: parsed.names.slice(0, limit), universeCount: parsed.names.length, poolSourceByName: parsed.poolSourceByName };
  const names = [];
  const poolSourceByName = {};
  const add = (name, source) => {
    if (!name || names.includes(name)) return;
    names.push(name);
    poolSourceByName[name] = source;
  };
  for (const name of parsed.names) add(name, parsed.poolSourceByName[name] || 'manual_fallback');
  try {
    const hits = await searchCases(Math.max(limit * 2, 100));
    for (const hit of hits) if (isTrackedCase(hit.name)) add(hit.name, 'steam_popular');
  } catch {
    // 保留手工 fallback；runner 会在 summary 中以实际数量体现覆盖范围。
  }
  return { names: names.slice(0, limit), universeCount: names.length, poolSourceByName };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} timeout`), { code: 'timeout' })), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function featureNumber(prediction, name) {
  return num(prediction?.features?.[name]);
}

function errorInfo(error) {
  return { code: error?.code || error?.name || 'error', status: error?.status, message: String(error?.message || error) };
}

function csvCell(value) {
  const text = value == null ? '' : Array.isArray(value) ? value.join('|') : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

const concurrency = Math.max(1, Math.min(4, Number(argValue('--concurrency', 3)) || 3));
const evaluationBudget = Math.max(0, Number(argValue('--budget', 100)) || 100);
const timeoutMs = Math.max(1000, Number(argValue('--timeout-ms', 6000)) || 6000);
const appKey = process.env.C5_APP_KEY || '';
const c5FetchedAt = Date.now();

async function fetchC5Maps(names) {
  if (!appKey) return { prices: {}, stats: {}, error: 'C5_APP_KEY missing' };
  try {
    const [prices, stats] = await Promise.all([
      withTimeout(fetchC5PricesBulk(names, appKey), timeoutMs, 'C5 prices'),
      withTimeout(fetchC5StatsBulk(names, appKey), timeoutMs, 'C5 stats'),
    ]);
    return { prices, stats, error: null };
  } catch (error) {
    return { prices: {}, stats: {}, error: errorInfo(error) };
  }
}

async function runItem(name, maps, poolSource, forecastItem, orderbookItem) {
  const started = Date.now();
  const diagnostics = {
    orderbookOk: false,
    discountOk: false,
    opportunityOk: false,
    latencyMs: undefined,
    http429: false,
    stale: false,
    missingFields: [],
  };
  let orderbook = null;
  let price = null;
  let history = null;
  let prediction = null;
  let c5Price = num(maps.prices[name]);
  const c5Stats = maps.stats[name] || null;
  const c5AvailableQuantity = num(c5Stats?.sellCount);
  const errors = [];

  const provider = new SteamOrderbookProvider({ timeoutMs, retries: 1, minRequestIntervalMs: 0 });
  let orderbookResult;
  let priceResult;
  let historyResult = { status: 'fulfilled', value: null };
  if (orderbookItem) {
    orderbookResult = { status: orderbookItem.status === 'failed' ? 'rejected' : 'fulfilled', value: orderbookItem, reason: new Error(orderbookItem.fallbackReason || 'orderbook_bundle_failed') };
    priceResult = await withTimeout(fetchSteamPrice(name), timeoutMs, 'Steam priceoverview').then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
  } else if (forecastItem) {
    [orderbookResult, priceResult] = await Promise.all([
      provider.getOrderbook(name).then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason })),
      withTimeout(fetchSteamPrice(name), timeoutMs, 'Steam priceoverview').then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason })),
    ]);
  } else {
    [orderbookResult, priceResult, historyResult] = await Promise.allSettled([
      provider.getOrderbook(name),
      withTimeout(fetchSteamPrice(name), timeoutMs, 'Steam priceoverview'),
      fetchSteamHistorySsr(name, 365, timeoutMs),
    ]);
  }
  if (orderbookResult.status === 'fulfilled') {
    orderbook = orderbookResult.value;
    diagnostics.orderbookOk = true;
    diagnostics.stale = orderbookResult.value.status === 'cache_stale';
  } else {
    const info = errorInfo(orderbookResult.reason);
    diagnostics.http429 = info.status === 429;
    errors.push({ source: 'orderbook', ...info });
  }
  if (priceResult.status === 'fulfilled') price = priceResult.value;
  else errors.push({ source: 'priceoverview', ...errorInfo(priceResult.reason) });
  if (historyResult.status === 'fulfilled') history = historyResult.value;
  else errors.push({ source: 'history', ...errorInfo(historyResult.reason) });

  const frozenForecastReady = forecastItem?.readiness?.status === 'ready' && forecastItem.forecast;
  if (frozenForecastReady) {
    const f = forecastItem.forecast;
    prediction = {
      p25: f.p25,
      p50: f.p50,
      p75: f.p75,
      prob_profit: undefined,
      confidence: f.confidence ?? 0.5,
      features: { market_state: f.marketState ?? 'UNKNOWN', latest_price: f.p50, data_insufficient: false, cv: 0, r2: 0, pct_365: 0, volatility: 0 },
    };
  }

  if (c5Price == null) diagnostics.missingFields.push('c5.unitPrice');
  if (num(price?.volume) == null) diagnostics.missingFields.push('volume24h');
  if (c5AvailableQuantity == null) diagnostics.missingFields.push('c5AvailableQuantity');
  if (!frozenForecastReady && (!history || history.length === 0)) diagnostics.missingFields.push('forecast');

  const fallbackBook = orderbook || {
    highestBuy: 0,
    lowestSell: 0,
    buyLevels: [],
    sellLevels: [],
    fetchedAt: 0,
  };
  if (!frozenForecastReady && history && history.length > 0) {
    try {
      const prices = history.map((point) => point.price);
      const timestamps = history.map((point) => Date.parse(`${point.date}T00:00:00.000Z`));
      const volumes = history.map((point) => point.volume ?? 0);
      const breakeven = c5Price != null ? c5Price * 1.01 / 0.8696 : 0;
      prediction = new BaselinePredictorV4().predict({
        marketHashName: name,
        prices,
        timestamps,
        volumes,
        volumeHistory: volumes.slice(-60),
        volume: num(price?.volume) ?? undefined,
        breakevenPrice: breakeven,
        predictedAt: new Date(),
      });
    } catch (error) {
      errors.push({ source: 'prediction', ...errorInfo(error) });
    }
  }

  const quantity = c5Price != null && c5Price > 0 ? Math.max(1, Math.floor(evaluationBudget / (c5Price * 1.01))) : 1;
  const discountInput = {
    item: name,
    c5: { unitPrice: c5Price ?? 0, feeRatio: 0.01, availableQuantity: c5AvailableQuantity ?? undefined, fetchedAt: appKey ? c5FetchedAt : 0 },
    steam: {
      highestBuy: fallbackBook.highestBuy,
      lowestSell: fallbackBook.lowestSell,
      buyLevels: fallbackBook.buyLevels,
      sellLevels: fallbackBook.sellLevels,
      fetchedAt: fallbackBook.fetchedAt,
      currency: 'CNY',
      currencyId: 23,
      quality: diagnostics.orderbookOk ? 1 : 0,
    },
    forecast: prediction ? { p25: prediction.p25, p50: prediction.p50, p75: prediction.p75, confidence: prediction.confidence, marketState: prediction.features.market_state } : undefined,
    quantity,
    now: Date.now(),
  };
  let discount;
  try {
    discount = buildDiscountV2(discountInput);
    diagnostics.discountOk = true;
    diagnostics.stale = discount.marketDataQuality.stale;
  } catch (error) {
    errors.push({ source: 'discount', ...errorInfo(error) });
  }
  if (!discount) {
    // Keep a finite inspectable row without pretending the opportunity calculation succeeded.
    discount = buildDiscountV2({ ...discountInput, c5: { ...discountInput.c5, unitPrice: 0 }, steam: { ...discountInput.steam, highestBuy: 0, lowestSell: 0, buyLevels: [], sellLevels: [] }, forecast: undefined });
  }

  const radar = evaluateRadar({
    market_hash_name: name,
    c5_buy_price: c5Price,
    steam_sell_price: num(price?.lowest_price),
    steam_volume: num(price?.volume) ?? 0,
    predicted_p50: prediction?.p50 ?? null,
    predicted_p25: prediction?.p25 ?? null,
    breakeven_price: c5Price != null ? c5Price * 1.01 / 0.8696 : null,
    volatility: featureNumber(prediction, 'volatility') ?? 0.05,
    prob_profit: prediction?.prob_profit,
    cv: featureNumber(prediction, 'cv'),
    r2: featureNumber(prediction, 'r2'),
    pct_365: featureNumber(prediction, 'pct_365'),
    market_state: prediction?.features?.market_state,
    data_insufficient: prediction?.features?.data_insufficient === true,
  });

  const opportunityInput = {
    item: name,
    discount,
    market: { volume24h: num(price?.volume) ?? undefined, c5AvailableQuantity: c5AvailableQuantity ?? undefined, highestBuy: fallbackBook.highestBuy, lowestSell: fallbackBook.lowestSell },
    risk: { marketState: prediction?.features?.market_state, cv: featureNumber(prediction, 'cv'), r2: featureNumber(prediction, 'r2'), volatility30d: featureNumber(prediction, 'volatility') },
    forecast: prediction ? { confidence: prediction.confidence, direction: (prediction.p50 > (featureNumber(prediction, 'latest_price') ?? prediction.p50) ? 'UP' : 'FLAT') } : undefined,
    feeModel: discount.feeModel,
    evaluationBudget,
  };
  let opportunity;
  try {
    opportunity = buildOpportunityV2(opportunityInput);
    diagnostics.opportunityOk = true;
  } catch (error) {
    errors.push({ source: 'opportunity', ...errorInfo(error) });
    opportunity = buildOpportunityV2({ item: name, discount, market: {} });
  }
  if (errors.length > 0) diagnostics.errorCode = errors.map((error) => `${error.source}:${error.code}`).join('|');
  diagnostics.latencyMs = Date.now() - started;
  const row = shadow.buildShadowRow({
    item: name,
    oldRadar: { signal: radar.signal, score: radar.score },
    discount,
    opportunity,
    poolSource,
    volume24h: num(price?.volume) ?? undefined,
    c5AvailableQuantity: c5AvailableQuantity ?? undefined,
    marketState: prediction?.features?.market_state,
    diagnostics,
  });
  return { row, errors, snapshot: { item: name, discountInput, opportunityInput: { ...opportunityInput, discount: undefined } } };
}

async function main() {
  const limit = Math.max(1, Number(argValue('--limit', 20)) || 20);
  const forecastBundlePath = argValue('--forecast-bundle', null);
  const orderbookBundlePath = argValue('--orderbook-bundle', null);
  const forecastBundle = forecastBundlePath ? JSON.parse(fs.readFileSync(path.resolve(process.cwd(), forecastBundlePath), 'utf8')) : null;
  const orderbookBundle = orderbookBundlePath ? JSON.parse(fs.readFileSync(path.resolve(process.cwd(), orderbookBundlePath), 'utf8')) : null;
  const candidates = await resolveCandidates(limit, forecastBundle, orderbookBundle);
  const names = candidates.names;
  const maps = await fetchC5Maps(names);
  if (maps.error) console.warn('C5 shadow diagnostic:', maps.error);
  const started = Date.now();
  const results = await shadow.mapBounded(names, concurrency, (name) => runItem(name, maps, candidates.poolSourceByName[name], forecastBundle?.items?.[name], orderbookBundle?.items?.[name]));
  const rows = results.map((result) => result.row);
  const summary = shadow.summarizeShadowRows(rows, Date.now() - started);
  const sorted = shadow.sortShadowRows(rows);
  const output = { generatedAt: new Date().toISOString(), universeCount: candidates.universeCount, candidateCount: names.length, sampleNames: names, forecastBundle: forecastBundle ? { candidateHash: forecastBundle.candidateHash, manifest: forecastBundle.manifest } : undefined, orderbookBundle: orderbookBundle ? { candidateHash: orderbookBundle.candidateHash, manifest: orderbookBundle.manifest } : undefined, summary, rows, snapshots: results.map((result) => result.snapshot) };
  const jsonOut = argValue('--json-out', null);
  if (jsonOut) fs.writeFileSync(path.resolve(process.cwd(), jsonOut), JSON.stringify(output, null, 2), 'utf8');
  const csvOut = argValue('--csv-out', null);
  if (csvOut) {
    const columns = ['item', 'oldRadarSignal', 'oldRadarScore', 'opportunityDecision', 'opportunityScore', 'conservativeDiscount', 'expectedDiscount', 'listingDiscount', 'spreadPct', 'currentLiquidityCapacity', 'volume24h', 'c5AvailableQuantity', 'marketDataQuality', 'forecastQuality', 'marketState', 'disagreement', 'hardGates', 'caps', 'reasons', 'warnings'];
    const csv = [columns.join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\n');
    fs.writeFileSync(path.resolve(process.cwd(), csvOut), csv + '\n', 'utf8');
  }
  console.log(JSON.stringify({ summary, top10: sorted.slice(0, 10).map((row) => ({ item: row.item, decision: row.opportunityDecision, score: row.opportunityScore, expectedDiscount: row.expectedDiscount, capacity: row.currentLiquidityCapacity, spreadPct: row.spreadPct, disagreement: row.disagreement })), bottom10: sorted.slice(-10).map((row) => ({ item: row.item, decision: row.opportunityDecision, score: row.opportunityScore, disagreement: row.disagreement })) }, null, 2));
  if (!appKey) console.warn('Shadow run used no C5_APP_KEY; C5-dependent rows are diagnostics only, not a complete acceptance run.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
