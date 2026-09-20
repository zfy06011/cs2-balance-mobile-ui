// V3-PHASE-3B.2S：持久 History Cache 契约测试。
const fs = require('fs');
const os = require('os');
const path = require('path');
const cache = require('./persistent_history_cache.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yu-e-history-cache-'));
let passed = 0, failed = 0;
function assert(name, condition, extra) { if (condition) { passed++; console.log('PASS ' + name); } else { failed++; console.log('FAIL ' + name + (extra ? ` got=${extra}` : '')); } }
function points(count = 10) { return Array.from({ length: count }, (_, i) => ({ ts: 1700000000000 + i * 86400000, price: 1 + i / 100, volume: i + 1 })); }
const now = 1700000000000 + 10 * 86400000;
const item = 'CS:GO Weapon Case / 特殊';

const miss = cache.readHistoryCache(root, item, { now });
assert('A miss returns miss', miss.hit === false && miss.reason === 'missing');
const written = cache.writeHistoryCache(root, { item, source: 'steam_ssr', points: points(), fetchedAt: now, requiredPointCount: 3, parserVersion: 'fixture' });
assert('B write persisted', written.persisted === true && fs.existsSync(written.path));
assert('B hash filename is safe', !path.basename(written.path).includes('/') && path.basename(written.path).length === 69);
assert('B schema version', written.entry.schemaVersion === 1);
assert('B item preserved', written.entry.item === item);
assert('B point count', written.entry.pointCount === 10 && written.entry.points.length === 10);
assert('B first timestamp', written.entry.firstTimestamp === points()[0].ts);
assert('B last timestamp', written.entry.lastTimestamp === points().at(-1).ts);
assert('B checksum length', /^[a-f0-9]{64}$/.test(written.entry.checksum));
assert('B origin source', written.entry.originSource === 'steam_first_party_web');
assert('B retrieval source', written.entry.source === 'steam_ssr');
assert('B parser version', written.entry.parserVersion === 'fixture');

const hit = cache.readHistoryCache(root, item, { now });
assert('C fresh process style hit', hit.hit === true);
assert('C cacheHit true', hit.cacheHit === true);
assert('C retrieval source persistent', hit.retrievalSource === 'persistent_cache');
assert('C points stable', JSON.stringify(hit.entry.points) === JSON.stringify(written.entry.points));
assert('C point count stable', hit.entry.pointCount === 10);
assert('C required points respected', hit.entry.requiredPointCount === 3);

const wrong = cache.readHistoryCache(root, 'Other Case', { now });
assert('D wrong item is miss', wrong.hit === false && wrong.reason === 'missing');
const file = written.path;
const original = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, original.replace('CS:GO Weapon Case / 特殊', 'Other Case'));
const mismatch = cache.readHistoryCache(root, item, { now });
assert('D item mismatch invalidates', mismatch.hit === false && mismatch.reason === 'item_mismatch');
assert('D mismatch quarantine exists', mismatch.quarantined === true);

cache.writeHistoryCache(root, { item, source: 'cloud', points: points(), fetchedAt: now, requiredPointCount: 3 });
const checksumFile = cache.itemPath(root, item);
const checksumText = fs.readFileSync(checksumFile, 'utf8').replace('"price":1.05', '"price":99.05');
fs.writeFileSync(checksumFile, checksumText);
const checksumMiss = cache.readHistoryCache(root, item, { now });
assert('E checksum mismatch invalidates', checksumMiss.hit === false && checksumMiss.reason === 'checksum_mismatch');
assert('E checksum quarantine exists', checksumMiss.quarantined === true);

cache.writeHistoryCache(root, { item, source: 'cloud', points: points(), fetchedAt: now, requiredPointCount: 3 });
const schemaFile = cache.itemPath(root, item);
const schemaEntry = JSON.parse(fs.readFileSync(schemaFile, 'utf8')); schemaEntry.schemaVersion = 99; fs.writeFileSync(schemaFile, JSON.stringify(schemaEntry));
const schemaMiss = cache.readHistoryCache(root, item, { now });
assert('F schema mismatch invalidates', schemaMiss.hit === false && schemaMiss.reason === 'schema_mismatch');
assert('F schema quarantine exists', schemaMiss.quarantined === true);

cache.writeHistoryCache(root, { item, source: 'cloud', points: points(), fetchedAt: now - 2 * 86400000, requiredPointCount: 3 });
const stale = cache.readHistoryCache(root, item, { now, ttlMs: 86400000 });
assert('G stale cache misses', stale.hit === false && stale.reason === 'stale');
assert('G stale file remains recoverable', fs.existsSync(cache.itemPath(root, item)));

cache.writeHistoryCache(root, { item, source: 'cloud', points: points(2), fetchedAt: now, requiredPointCount: 3 });
const insufficient = cache.readHistoryCache(root, item, { now });
assert('H insufficient points misses', insufficient.hit === false && insufficient.reason === 'invalid_or_insufficient_points');

cache.writeHistoryCache(root, { item, source: 'cloud', points: [{ ts: 1700000000000, price: 1, volume: 1 }, { ts: 1700000001000, price: 2, volume: 2 }, { ts: 1700086400000, price: 3, volume: 3 }], fetchedAt: now, requiredPointCount: 2 });
const normalized = cache.readHistoryCache(root, item, { now, requiredPointCount: 2 });
assert('I duplicate day normalized', normalized.hit === true && normalized.entry.points.length === 2);
assert('I same day keeps last price', normalized.entry.points[0].price === 2);
assert('I same day sums volume', normalized.entry.points[0].volume === 3);
assert('I timestamps monotonic', normalized.entry.points[1].ts >= normalized.entry.points[0].ts);

let failedEmpty = false;
try { cache.writeHistoryCache(root, { item, source: 'cloud', points: [], fetchedAt: now }); } catch { failedEmpty = true; }
assert('J empty write rejected', failedEmpty);
cache.writeHistoryCache(root, { item, source: 'cloud', points: points(), fetchedAt: now, requiredPointCount: 3 });
assert('J failed empty write does not remove valid cache', cache.readHistoryCache(root, item, { now }).hit === true);

const stats = cache.cacheStats(root);
assert('K stats item count', stats.itemCount === 1);
assert('K stats bytes positive', stats.totalBytes > 0 && stats.largestBytes > 0);
assert('K stats average positive', stats.avgBytes > 0);
assert('K stats finite', Number.isFinite(stats.totalBytes) && Number.isFinite(stats.avgBytes));
const serialized = fs.readFileSync(cache.itemPath(root, item), 'utf8');
assert('L no C5 key', !/app[-_]?key/i.test(serialized));
assert('L no cookie', !/cookie/i.test(serialized));
assert('L no token', !/token|authorization/i.test(serialized));

for (const count of [3, 4, 5, 10, 20, 50, 100]) {
  const name = `Fixture ${count}`;
  cache.writeHistoryCache(root, { item: name, source: 'cloud', points: points(count), fetchedAt: now, requiredPointCount: 3 });
  const read = cache.readHistoryCache(root, name, { now });
  assert(`M roundtrip ${count}`, read.hit === true && read.entry.pointCount === count);
  assert(`M checksum ${count}`, read.entry.checksum === cache.checksum(read.entry));
  assert(`M source ${count}`, read.entry.source === 'cloud' && read.entry.originSource === 'steam_first_party_web');
}

console.log('');
console.log(`PASS ${passed} / ${passed + failed}`);
if (failed > 0) process.exitCode = 1;
else console.log('ALL HISTORY CACHE ASSERTIONS PASSED');
try { fs.rmSync(root, { recursive: true, force: true }); } catch {}

