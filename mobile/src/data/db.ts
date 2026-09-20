/**
 * db：SQLite 数据库层（expo-sqlite）。
 * - 单例惰性初始化（ensureDb 并发安全）
 * - WAL 模式：读写并发 + 崩溃恢复
 * - 建表/索引全部幂等（CREATE ... IF NOT EXISTS）
 * - 取代原 AsyncStorage「单 key 全量 JSON 读改写」模式
 */
import * as SQLite from 'expo-sqlite';

export const SCHEMA_VERSION = 1;

/** 旧 AsyncStorage key（仅用于 v1.7.0 一次性迁移，迁移后删除） */
export const LEGACY_KEYS = {
  snapshots: '@cs2balance/snapshots_v2',
  inventory: '@cs2balance/inventory_v2',
  orders: '@cs2balance/orders_v2',
  settings: '@cs2balance/settings_v2',
  scan: '@cs2balance/scan_state_v1',
  eventFeed: '@cs2balance/event_feed_v1',
  zhNames: '@cs2balance/zh_names_v1',
} as const;

const DB_NAME = 'cs2balance.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** 建表 + 索引（幂等）。PRAGMA 必须在表创建前设置 WAL。 */
async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      source       TEXT    NOT NULL CHECK (source IN ('steam','c5','c5_hist')),
      kind         TEXT    NOT NULL CHECK (kind IN ('rt','hist')),
      price        REAL    NOT NULL,
      volume       INTEGER,
      fetched_at   TEXT    NOT NULL,
      popular_rank INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_snap_name_source_time ON snapshots(name, source, fetched_at);
    -- 唯一键：实时点(rt)按 (name,source) 去重；历史点(hist)按 (name,source,fetched_at) 去重
    CREATE UNIQUE INDEX IF NOT EXISTS uq_snap_rt
      ON snapshots(name, source) WHERE kind = 'rt';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_snap_hist
      ON snapshots(name, source, fetched_at) WHERE kind = 'hist';

    CREATE TABLE IF NOT EXISTS inventory (
      id                  INTEGER PRIMARY KEY,
      item_name           TEXT    NOT NULL,
      quantity            INTEGER NOT NULL,
      buy_price           REAL    NOT NULL,
      buy_at              TEXT    NOT NULL,
      source              TEXT    NOT NULL,
      steam_synced_at     TEXT,
      steam_tradable      INTEGER,
      steam_unlock_est_at TEXT,
      steam_first_seen_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_inv_name ON inventory(item_name);

    CREATE TABLE IF NOT EXISTS orders (
      id                INTEGER PRIMARY KEY,
      item_name         TEXT    NOT NULL,
      quantity          INTEGER NOT NULL,
      buy_price         REAL    NOT NULL,
      buy_at            TEXT    NOT NULL,
      source            TEXT    NOT NULL,
      expected_discount REAL,
      budget_used       REAL    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_buy_at ON orders(buy_at);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- 单行 JSON 类数据（scan_state / event_feed）
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS zh_names (
      market_hash_name TEXT PRIMARY KEY,
      cn_name          TEXT NOT NULL
    );
  `);
}

/** 获取（并惰性初始化）数据库单例。并发调用共享同一个 Promise。 */
export function ensureDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await initSchema(db);
      await db.runAsync(
        'INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)',
        'schema_version',
        String(SCHEMA_VERSION),
      );
      return db;
    })();
    // 初始化失败时清空 Promise，允许下次重试
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** 读取 meta 值（迁移标记等） */
export async function getMeta(key: string): Promise<string | null> {
  const db = await ensureDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

/** 写入 meta 值 */
export async function setMeta(key: string, value: string): Promise<void> {
  const db = await ensureDb();
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

/** 关闭数据库（测试用） */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    await db.closeAsync();
  } finally {
    dbPromise = null;
  }
}
