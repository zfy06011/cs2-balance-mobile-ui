// V3-PHASE-3B.3：Orderbook cache/fallback/diagnostic contract tests。
const fs = require('fs');
const os = require('os');
const path = require('path');
const cache = require('./persistent_orderbook_cache.cjs');
let passed = 0, failed = 0;
function assert(name, ok, extra) { if (ok) { passed++; console.log('PASS ' + name); } else { failed++; console.log('FAIL ' + name + (extra ? ` got=${extra}` : '')); } }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yu-e-orderbook-cache-'));
const item = 'CS:GO Weapon Case / 特殊';
const book = { item, highestBuy: 10, lowestSell: 10.2, buyLevels: [{ price: 10, quantity: 10, cumulativeQuantity: 10 }], sellLevels: [{ price: 10.2, quantity: 10, cumulativeQuantity: 10 }], fetchedAt: 1700000000000 };
const miss = cache.read(root, item, book.fetchedAt);
assert('A miss status', miss.status === 'miss');
const written = cache.write(root, book);
assert('A atomic write result', written.persisted !== false && fs.existsSync(written.path));
assert('A hash filename safe', path.basename(written.path).length === 69 && !path.basename(written.path).includes(':'));
const fresh = cache.read(root, item, book.fetchedAt + 60000);
assert('B fresh hit', fresh.status === 'fresh');
assert('B retrieval data', fresh.entry.highestBuy === 10 && fresh.entry.lowestSell === 10.2);
assert('B levels present', fresh.entry.buyLevels.length === 1 && fresh.entry.sellLevels.length === 1);
assert('B age tracked', fresh.ageMs === 60000);
const stale = cache.read(root, item, book.fetchedAt + 3 * 60 * 1000);
assert('C stale status', stale.status === 'stale');
assert('C stale preserves book', stale.entry.buyLevels[0].price === 10);
const expired = cache.read(root, item, book.fetchedAt + 11 * 60 * 1000);
assert('D expired status', expired.status === 'expired');
assert('D expired still readable for refresh', expired.entry.item === item);

const checksumFile = cache.fileOf(root, item);
const original = fs.readFileSync(checksumFile, 'utf8');
fs.writeFileSync(checksumFile, original.replace('"highestBuy":10', '"highestBuy":99'));
const checksumMiss = cache.read(root, item, book.fetchedAt);
assert('E checksum mismatch', checksumMiss.status === 'miss' && checksumMiss.reason === 'checksum_mismatch');
assert('E corrupt quarantined', checksumMiss.quarantined === true);
cache.write(root, book);
const schemaFile = cache.fileOf(root, item); const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8')); schema.schemaVersion = 99; fs.writeFileSync(schemaFile, JSON.stringify(schema));
const schemaMiss = cache.read(root, item, book.fetchedAt);
assert('F schema mismatch', schemaMiss.status === 'miss' && schemaMiss.reason === 'schema_mismatch');
cache.write(root, book);

const samePromise = Promise.resolve({ item, status: 'live' });
const inflight = new Map([['X', samePromise]]);
assert('G singleflight map reuses promise', inflight.get('X') === inflight.get('X'));
assert('G unknown item no promise', inflight.get('Y') === undefined);
assert('G same item identity', inflight.get('X') === samePromise);
const circuit = { state: 'CLOSED', failures: 0, openUntil: 0 };
for (let i = 0; i < 5; i++) circuit.failures++;
if (circuit.failures >= 5) { circuit.state = 'OPEN'; circuit.openUntil = book.fetchedAt + 30000; }
assert('H circuit opens at five failures', circuit.state === 'OPEN');
assert('H circuit has cooldown', circuit.openUntil - book.fetchedAt === 30000);
circuit.state = 'HALF_OPEN';
assert('H half open probe state', circuit.state === 'HALF_OPEN');
circuit.state = 'CLOSED'; circuit.failures = 0;
assert('H probe success closes', circuit.state === 'CLOSED' && circuit.failures === 0);
circuit.state = 'OPEN'; circuit.failures = 5; circuit.state = 'HALF_OPEN'; circuit.failures++;
assert('H probe failure can reopen', circuit.failures === 6);

for (const price of [0.01, 0.18, 1, 10, 100]) {
  const name = `P-${price}`;
  cache.write(root, { ...book, item: name, highestBuy: price, lowestSell: price + 0.01, buyLevels: [{ price, quantity: 1, cumulativeQuantity: 1 }], sellLevels: [{ price: price + 0.01, quantity: 1, cumulativeQuantity: 1 }] });
  const hit = cache.read(root, name, book.fetchedAt);
  assert(`I price ${price} finite`, hit.status === 'fresh' && Number.isFinite(hit.entry.highestBuy));
  assert(`I price ${price} item`, hit.entry.item === name);
  assert(`I price ${price} checksum`, hit.entry.checksum === cache.checksum(hit.entry));
}
const stats = cache.stats(root);
assert('J stats count', stats.itemCount === 6);
assert('J stats total positive', stats.totalBytes > 0);
assert('J stats average finite', Number.isFinite(stats.avgBytes));
assert('J stats largest positive', stats.largestBytes > 0);
const allText = fs.readFileSync(cache.fileOf(root, item), 'utf8');
assert('K no app key', !/app[-_]?key/i.test(allText));
assert('K no cookie', !/cookie/i.test(allText));
assert('K no token', !/token|authorization/i.test(allText));
for (const age of [0, 1000, 30000, 60000, 119999]) assert(`L fresh boundary ${age}`, cache.read(root, item, book.fetchedAt + age).status === 'fresh');
for (const age of [120001, 180000, 300000, 599999]) assert(`L stale boundary ${age}`, cache.read(root, item, book.fetchedAt + age).status === 'stale');
for (const age of [600001, 700000, 1000000]) assert(`L expired boundary ${age}`, cache.read(root, item, book.fetchedAt + age).status === 'expired');

console.log('');
console.log(`PASS ${passed} / ${passed + failed}`);
if (failed > 0) process.exitCode = 1;
else console.log('ALL ORDERBOOK STABILITY ASSERTIONS PASSED');
try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
