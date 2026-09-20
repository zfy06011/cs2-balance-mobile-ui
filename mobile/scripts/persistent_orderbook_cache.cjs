const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SCHEMA_VERSION = 1;
const FRESH_TTL_MS = 2 * 60 * 1000;
const STALE_TTL_MS = 10 * 60 * 1000;
function hash(item) { return crypto.createHash('sha256').update(String(item), 'utf8').digest('hex'); }
function fileOf(dir, item) { return path.join(dir, 'items', `${hash(item)}.json`); }
function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function canonical(entry) { return JSON.stringify({ schemaVersion: entry.schemaVersion, item: entry.item, highestBuy: entry.highestBuy, lowestSell: entry.lowestSell, buyLevels: entry.buyLevels, sellLevels: entry.sellLevels, fetchedAt: entry.fetchedAt }); }
function checksum(entry) { return crypto.createHash('sha256').update(canonical(entry), 'utf8').digest('hex'); }
function validLevels(levels) { return Array.isArray(levels) && levels.length > 0 && levels.every((x) => x && finite(x.price) && x.price > 0 && finite(x.quantity) && x.quantity >= 0); }
function quarantine(file, reason) { try { const target = `${file}.corrupt-${Date.now()}`; fs.renameSync(file, target); return { reason, quarantined: true }; } catch { return { reason, quarantined: false }; } }
function read(dir, item, now = Date.now(), freshTtlMs = FRESH_TTL_MS, staleTtlMs = STALE_TTL_MS) {
  const file = fileOf(dir, item);
  if (!fs.existsSync(file)) return { status: 'miss', reason: 'missing' };
  let entry; try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { status: 'miss', ...quarantine(file, 'json_parse_failed') }; }
  if (!entry || entry.schemaVersion !== SCHEMA_VERSION) return { status: 'miss', ...quarantine(file, 'schema_mismatch') };
  if (entry.item !== item) return { status: 'miss', ...quarantine(file, 'item_mismatch') };
  if (entry.checksum !== checksum(entry)) return { status: 'miss', ...quarantine(file, 'checksum_mismatch') };
  if (!finite(entry.highestBuy) || entry.highestBuy <= 0 || !finite(entry.lowestSell) || entry.lowestSell <= 0 || !validLevels(entry.buyLevels) || !validLevels(entry.sellLevels) || !finite(entry.fetchedAt)) return { status: 'miss', ...quarantine(file, 'invalid_payload') };
  const age = Math.max(0, now - entry.fetchedAt);
  if (age <= freshTtlMs) return { status: 'fresh', entry, ageMs: age };
  if (age <= staleTtlMs) return { status: 'stale', entry, ageMs: age };
  return { status: 'expired', entry, ageMs: age };
}
function write(dir, input) {
  if (!finite(input.highestBuy) || input.highestBuy <= 0 || !finite(input.lowestSell) || input.lowestSell <= 0 || !validLevels(input.buyLevels) || !validLevels(input.sellLevels)) throw new Error('invalid_orderbook_cache_payload');
  fs.mkdirSync(path.join(dir, 'items'), { recursive: true });
  const entry = { schemaVersion: SCHEMA_VERSION, item: input.item, highestBuy: input.highestBuy, lowestSell: input.lowestSell, buyLevels: input.buyLevels, sellLevels: input.sellLevels, fetchedAt: input.fetchedAt ?? Date.now(), sourceKind: 'steam_first_party_web' };
  entry.checksum = checksum(entry);
  const target = fileOf(dir, input.item); const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(temp, 'w'); try { fs.writeFileSync(fd, JSON.stringify(entry)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, target);
  return { entry, path: target };
}
function stats(dir) { const d = path.join(dir, 'items'); if (!fs.existsSync(d)) return { itemCount: 0, totalBytes: 0, avgBytes: 0, largestBytes: 0 }; const files = fs.readdirSync(d).filter((x) => x.endsWith('.json')); const sizes = files.map((x) => fs.statSync(path.join(d, x)).size); const totalBytes = sizes.reduce((a, b) => a + b, 0); return { itemCount: files.length, totalBytes, avgBytes: files.length ? totalBytes / files.length : 0, largestBytes: Math.max(0, ...sizes) }; }
module.exports = { SCHEMA_VERSION, FRESH_TTL_MS, STALE_TTL_MS, hash, fileOf, checksum, read, write, stats };

