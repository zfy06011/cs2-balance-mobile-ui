// V3-PHASE-3B.3：Prepare/Freeze Steam orderbook bundle。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(__dirname, '.orderbook-prepare-build');
fs.rmSync(buildDir, { recursive: true, force: true }); fs.mkdirSync(buildDir, { recursive: true });
const source = (p) => path.join(root, 'src', p);
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(buildDir) + ' ' + JSON.stringify(source('providers/steam/steamOrderbook.ts')), { cwd: root, stdio: 'pipe', shell: true });
const { SteamOrderbookProvider } = require(path.join(buildDir, 'steamOrderbook.js'));
const cache = require('./persistent_orderbook_cache.cjs');
function argValue(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback; }
function candidateHash(names) { return crypto.createHash('sha256').update(names.slice().sort().join('\n')).digest('hex').slice(0, 8); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function readNames() {
  const bundlePath = argValue('--forecast-bundle', null);
  if (bundlePath) { const bundle = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), bundlePath), 'utf8')); return { names: Object.keys(bundle.items), candidateHash: bundle.candidateHash }; }
  const namesPath = argValue('--names', null);
  if (!namesPath) throw new Error('需要 --forecast-bundle 或 --names');
  const names = fs.readFileSync(path.resolve(process.cwd(), namesPath), 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return { names, candidateHash: candidateHash(names) };
}
async function main() {
  const { names, candidateHash: hash } = readNames();
  const cacheDir = path.resolve(process.cwd(), argValue('--cache-dir', path.join('artifacts', 'orderbook-cache')));
  if (process.argv.includes('--clear-cache')) fs.rmSync(cacheDir, { recursive: true, force: true });
  const now = Date.now() + (Number(argValue('--now-offset-ms', 0)) || 0);
  const freshTtlMs = Number(argValue('--fresh-ttl-ms', cache.FRESH_TTL_MS)) || cache.FRESH_TTL_MS;
  const staleTtlMs = Number(argValue('--stale-ttl-ms', cache.STALE_TTL_MS)) || cache.STALE_TTL_MS;
  const maxConcurrency = Math.max(1, Math.min(2, Number(argValue('--concurrency', 2)) || 2));
  const minIntervalMs = Math.max(250, Number(argValue('--min-interval-ms', 400)) || 400);
  const timeoutMs = Math.max(1000, Number(argValue('--timeout-ms', 6000)) || 6000);
  const maxLiveRaw = argValue('--max-live-requests', null);
  const maxLiveRequests = maxLiveRaw == null ? names.length : Math.max(0, Number(maxLiveRaw) || 0);
  const forceLive = process.argv.includes('--force-live');
  const items = {};
  const inflight = new Map();
  let lastLiveAt = 0;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;
  let retryCount = 0;
  let liveAttemptCount = 0;
  let liveSuccessCount = 0;
  let http429Count = 0;
  let http5xxCount = 0;
  let timeoutCount = 0;
  let circuitOpenCount = 0;
  let freshCount = 0;
  let staleCount = 0;
  let failedCount = 0;
  let liveCount = 0;
  const started = Date.now();
  async function liveFetch(item) {
    const existing = inflight.get(item); if (existing) return existing;
    const promise = (async () => {
      if (Date.now() < circuitOpenUntil) { circuitOpenCount++; throw Object.assign(new Error('circuit_open'), { code: 'circuit_open' }); }
      if (liveAttemptCount >= maxLiveRequests) throw Object.assign(new Error('request_budget_exhausted'), { code: 'request_budget_exhausted' });
      const wait = lastLiveAt + minIntervalMs - Date.now(); if (wait > 0) await sleep(wait); lastLiveAt = Date.now(); liveAttemptCount++;
      const provider = new SteamOrderbookProvider({ timeoutMs, retries: 1, minRequestIntervalMs: 0 });
      try {
        const result = await provider.getOrderbook(item);
        consecutiveFailures = 0; liveSuccessCount++;
        return result;
      } catch (error) {
        retryCount += error?.attempts > 1 ? error.attempts - 1 : 0;
        if (error?.status === 429) http429Count++;
        if (error?.status >= 500) http5xxCount++;
        if (error?.code === 'timeout') timeoutCount++;
        consecutiveFailures++;
        if (consecutiveFailures >= 5) circuitOpenUntil = Date.now() + 30000;
        throw error;
      }
    })();
    inflight.set(item, promise); promise.finally(() => inflight.delete(item)).catch(() => undefined); return promise;
  }
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++; if (index >= names.length) return;
      const item = names[index];
      const cached = forceLive ? { status: 'miss' } : cache.read(cacheDir, item, now, freshTtlMs, staleTtlMs);
      if (cached.status === 'fresh') { freshCount++; items[item] = { item, status: 'cache_fresh', highestBuy: cached.entry.highestBuy, lowestSell: cached.entry.lowestSell, buyLevels: cached.entry.buyLevels, sellLevels: cached.entry.sellLevels, spread: cached.entry.lowestSell - cached.entry.highestBuy, spreadPct: (cached.entry.lowestSell - cached.entry.highestBuy) / cached.entry.lowestSell, fetchedAt: cached.entry.fetchedAt, cacheAgeMs: cached.ageMs, sourceKind: 'steam_first_party_web', retrievalSource: 'persistent_cache', retryCount: 0, quality: 1 }; continue; }
      const staleEntry = cached.status === 'stale' ? cached.entry : null;
      try {
        const live = await liveFetch(item);
        cache.write(cacheDir, live);
        const spread = live.lowestSell - live.highestBuy;
        liveCount++;
        items[item] = { item, status: 'live', highestBuy: live.highestBuy, lowestSell: live.lowestSell, buyLevels: live.buyLevels, sellLevels: live.sellLevels, spread, spreadPct: live.spreadPct, fetchedAt: live.fetchedAt, cacheAgeMs: 0, sourceKind: 'steam_first_party_web', retrievalSource: 'live', retryCount: 0, quality: 1 };
      } catch (error) {
        if (staleEntry) {
          staleCount++;
          items[item] = { item, status: 'cache_stale', highestBuy: staleEntry.highestBuy, lowestSell: staleEntry.lowestSell, buyLevels: staleEntry.buyLevels, sellLevels: staleEntry.sellLevels, spread: staleEntry.lowestSell - staleEntry.highestBuy, spreadPct: (staleEntry.lowestSell - staleEntry.highestBuy) / staleEntry.lowestSell, fetchedAt: staleEntry.fetchedAt, cacheAgeMs: cached.ageMs, sourceKind: 'steam_first_party_web', retrievalSource: 'persistent_cache', fallbackReason: 'live_refresh_failed', httpStatus: error?.status, retryCount: error?.attempts ? error.attempts - 1 : 0, quality: 0.5 };
        } else {
          failedCount++;
          items[item] = { item, status: 'failed', sourceKind: 'steam_first_party_web', retrievalSource: 'live', fallbackReason: error?.code || error?.message || 'live_failed', httpStatus: error?.status, retryCount: error?.attempts ? error.attempts - 1 : 0, quality: 0 };
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, names.length) }, () => worker()));
  const completedAt = Date.now();
  const bundle = { createdAt: completedAt, candidateHash: hash, manifest: { candidateCount: names.length, liveCount, cacheFreshCount: freshCount, cacheStaleCount: staleCount, failedCount, inFlightAtFreeze: 0 }, items };
  const out = path.resolve(process.cwd(), argValue('--out', path.join('artifacts', 'shadow', `orderbook-bundle-${Date.now()}.json`)));
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(bundle, null, 2), 'utf8');
  const stats = cache.stats(cacheDir);
  console.log(JSON.stringify({ out, manifest: bundle.manifest, liveAttemptCount, liveSuccessCount, persistentFreshHitCount: freshCount, persistentStaleHitCount: staleCount, http429Count, http5xxCount, timeoutCount, retryCount, circuitOpenCount, durationMs: completedAt - started, cacheStats: stats }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
