-- D1 schema：Steam CS2 武器箱历史价格缓存（零 cookie，来源 = Steam 市场 gid 页 SSR pricehistory / var line1）
CREATE TABLE IF NOT EXISTS gid_map (
  market_hash_name TEXT PRIMARY KEY,
  gid TEXT NOT NULL,
  resolved_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  market_hash_name TEXT NOT NULL,
  ts INTEGER NOT NULL,
  price REAL NOT NULL,
  volume INTEGER NOT NULL,
  PRIMARY KEY (market_hash_name, ts)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_history_name_ts ON history (market_hash_name, ts);

CREATE TABLE IF NOT EXISTS run_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);