/**
 * D1 数据访问层。
 * 使用最小结构类型（不依赖 @cloudflare/workers-types），运行时与 wrangler 注入的 D1Database 结构兼容。
 */
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean }>;
}
export interface D1DatabaseLike {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown[]>;
}

export interface HistoryRow {
  ts: number;
  price: number;
  volume: number;
}
export interface ItemRow {
  name: string;
  gid: string | null;
  last_ts: number | null;
  points: number;
}

/** D1 batch 单次上限（官方 100 条），超出分片 */
const BATCH_MAX = 100;

export async function getGid(db: D1DatabaseLike, name: string): Promise<string | null> {
  const row = await db.prepare('SELECT gid FROM gid_map WHERE market_hash_name = ?').bind(name).first<{ gid: string }>();
  return row?.gid ?? null;
}

export async function setGid(db: D1DatabaseLike, name: string, gid: string, nowSec: number): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO gid_map (market_hash_name, gid, resolved_at) VALUES (?, ?, ?)')
    .bind(name, gid, nowSec)
    .run();
}

export async function getLastTs(db: D1DatabaseLike, name: string): Promise<number | null> {
  const row = await db.prepare('SELECT MAX(ts) AS m FROM history WHERE market_hash_name = ?').bind(name).first<{ m: number | null }>();
  return row?.m ?? null;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 插入新点（INSERT OR REPLACE，按 (name, ts) 去重）。返回写入行数。 */
export async function upsertHistory(
  db: D1DatabaseLike,
  name: string,
  points: Array<{ ts: number; price: number; volume: number }>,
): Promise<number> {
  if (points.length === 0) return 0;
  const groups = chunk(points, BATCH_MAX);
  for (const g of groups) {
    const stmts = g.map((p) =>
      db
        .prepare('INSERT OR REPLACE INTO history (market_hash_name, ts, price, volume) VALUES (?, ?, ?, ?)')
        .bind(name, p.ts, p.price, p.volume),
    );
    await db.batch(stmts);
  }
  return points.length;
}

export async function getHistory(db: D1DatabaseLike, name: string, sinceTs: number, limit = 10000): Promise<HistoryRow[]> {
  const r = await db
    .prepare('SELECT ts, price, volume FROM history WHERE market_hash_name = ? AND ts >= ? ORDER BY ts ASC LIMIT ?')
    .bind(name, sinceTs, limit)
    .all<HistoryRow>();
  return r.results;
}

export async function listItems(db: D1DatabaseLike, limit: number): Promise<ItemRow[]> {
  const r = await db
    .prepare(
      'SELECT h.market_hash_name AS name, MAX(h.ts) AS last_ts, COUNT(*) AS points, ' +
        '(SELECT g.gid FROM gid_map g WHERE g.market_hash_name = h.market_hash_name) AS gid ' +
        'FROM history h GROUP BY h.market_hash_name ORDER BY last_ts DESC LIMIT ?',
    )
    .bind(limit)
    .all<{ name: string; last_ts: number | null; points: number; gid: string | null }>();
  return r.results.map((row) => ({ name: row.name, gid: row.gid, last_ts: row.last_ts, points: row.points }));
}

export async function listAllHistoryNames(db: D1DatabaseLike): Promise<string[]> {
  const r = await db.prepare('SELECT DISTINCT market_hash_name AS name FROM history').all<{ name: string }>();
  return r.results.map((x) => x.name);
}

export async function getMeta(db: D1DatabaseLike, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM run_meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1DatabaseLike, key: string, value: string): Promise<void> {
  await db.prepare('INSERT OR REPLACE INTO run_meta (key, value) VALUES (?, ?)').bind(key, value).run();
}