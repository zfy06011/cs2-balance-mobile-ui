// Shadow/CLI 专用持久历史缓存，不保存任何凭证。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function itemHash(item) {
  return crypto.createHash('sha256').update(String(item), 'utf8').digest('hex');
}
function itemPath(cacheDir, item) {
  return path.join(cacheDir, 'items', `${itemHash(item)}.json`);
}
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function normalizePoints(points) {
  const sorted = (Array.isArray(points) ? points : []).filter((point) => point && finite(point.ts) && point.ts > 0 && finite(point.price) && point.price > 0).sort((a, b) => a.ts - b.ts);
  const byDay = new Map();
  for (const point of sorted) {
    const day = new Date(point.ts).toISOString().slice(0, 10);
    const current = byDay.get(day);
    if (current) {
      current.ts = point.ts;
      current.price = point.price;
      current.volume += finite(point.volume) ? point.volume : 0;
    } else {
      byDay.set(day, { ts: point.ts, price: point.price, volume: finite(point.volume) ? point.volume : 0 });
    }
  }
  return [...byDay.values()].sort((a, b) => a.ts - b.ts);
}
function canonical(entry) {
  return JSON.stringify({ schemaVersion: entry.schemaVersion, item: entry.item, points: entry.points });
}
function checksum(entry) { return crypto.createHash('sha256').update(canonical(entry), 'utf8').digest('hex'); }
function validatePoints(points) {
  if (!Array.isArray(points) || points.length === 0) return false;
  for (let i = 0; i < points.length; i++) {
    if (!points[i] || !finite(points[i].ts) || points[i].ts <= 0 || !finite(points[i].price) || points[i].price <= 0) return false;
    if (i > 0 && points[i].ts < points[i - 1].ts) return false;
  }
  return true;
}
function safeMkdir(cacheDir) { fs.mkdirSync(path.join(cacheDir, 'items'), { recursive: true }); }
function quarantine(file, reason) {
  try {
    const target = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, target);
    return { reason, quarantined: true, path: target };
  } catch {
    return { reason, quarantined: false };
  }
}

function readHistoryCache(cacheDir, item, options = {}) {
  const requiredPointCount = options.requiredPointCount ?? 3;
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const file = itemPath(cacheDir, item);
  if (!fs.existsSync(file)) return { hit: false, reason: 'missing' };
  let entry;
  try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { hit: false, ...quarantine(file, 'json_parse_failed') }; }
  if (!entry || entry.schemaVersion !== SCHEMA_VERSION) return { hit: false, ...quarantine(file, 'schema_mismatch') };
  if (entry.item !== item) return { hit: false, ...quarantine(file, 'item_mismatch') };
  if (entry.pointCount !== entry.points?.length) return { hit: false, ...quarantine(file, 'point_count_mismatch') };
  if (entry.checksum !== checksum(entry)) return { hit: false, ...quarantine(file, 'checksum_mismatch') };
  if (!validatePoints(entry.points) || entry.pointCount < requiredPointCount) return { hit: false, ...quarantine(file, 'invalid_or_insufficient_points') };
  const age = now - Number(entry.fetchedAt);
  const lastTimestamp = entry.lastTimestamp ?? entry.points[entry.points.length - 1].ts;
  if (!finite(entry.fetchedAt) || age > ttlMs || lastTimestamp <= 0) return { hit: false, reason: age > ttlMs ? 'stale' : 'invalid_freshness' };
  return { hit: true, entry, retrievalSource: 'persistent_cache', cacheHit: true };
}

function writeHistoryCache(cacheDir, input) {
  const points = normalizePoints(input.points);
  if (points.length === 0) throw new Error('cannot_persist_empty_history');
  const entry = {
    schemaVersion: SCHEMA_VERSION,
    item: input.item,
    source: input.source,
    originSource: 'steam_first_party_web',
    fetchedAt: input.fetchedAt ?? Date.now(),
    firstTimestamp: points[0].ts,
    lastTimestamp: points[points.length - 1].ts,
    pointCount: points.length,
    requiredPointCount: input.requiredPointCount ?? 3,
    points,
    parserVersion: input.parserVersion,
  };
  entry.checksum = checksum(entry);
  safeMkdir(cacheDir);
  const target = itemPath(cacheDir, input.item);
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(entry));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temp, target);
  return { entry, persisted: true, path: target };
}

function cacheStats(cacheDir) {
  const dir = path.join(cacheDir, 'items');
  if (!fs.existsSync(dir)) return { itemCount: 0, totalBytes: 0, avgBytes: 0, largestBytes: 0 };
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  const sizes = files.map((file) => fs.statSync(path.join(dir, file)).size);
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  return { itemCount: files.length, totalBytes, avgBytes: files.length ? totalBytes / files.length : 0, largestBytes: Math.max(0, ...sizes) };
}

module.exports = { SCHEMA_VERSION, DEFAULT_TTL_MS, itemHash, normalizePoints, checksum, readHistoryCache, writeHistoryCache, cacheStats, itemPath };

