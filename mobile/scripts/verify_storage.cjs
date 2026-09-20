/**
 * verify_storage.cjs —— 存储层契约验证（SQLite 语义，用 node:sqlite 真实执行）
 * 用法: npm run verify:storage
 *
 * 由于 storage.ts 依赖 expo-sqlite（RN 原生模块，纯 Node 无法 require），
 * 这里用 node:sqlite 建同样的 schema，验证 SQL 语义与 storage.ts 的实现一致：
 *   1. 实时点每 (name, source) 只保留 1 条（部分唯一索引 + ON CONFLICT）
 *   2. 历史点按 (name, source, fetched_at) 去重
 *   3. HISTORY_KEEP 截断最旧
 *   4. inventory / orders id 递增
 *   5. clearAllData 只清 3 表
 */
const { DatabaseSync } = require('node:sqlite');

const HISTORY_KEEP = 730;

let failed = 0;
let passed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? '  got: ' + JSON.stringify(extra) : '')); }
}

/** 建与 db.ts 相同的 schema */
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      source       TEXT    NOT NULL CHECK (source IN ('steam','c5','c5_hist')),
      kind         TEXT    NOT NULL CHECK (kind IN ('rt','hist')),
      price        REAL    NOT NULL,
      volume       INTEGER,
      fetched_at   TEXT    NOT NULL,
      popular_rank INTEGER
    );
    CREATE INDEX idx_snap_name_source_time ON snapshots(name, source, fetched_at);
    CREATE UNIQUE INDEX uq_snap_rt ON snapshots(name, source) WHERE kind = 'rt';
    CREATE UNIQUE INDEX uq_snap_hist ON snapshots(name, source, fetched_at) WHERE kind = 'hist';
    CREATE TABLE inventory (
      id INTEGER PRIMARY KEY, item_name TEXT NOT NULL, quantity INTEGER NOT NULL,
      buy_price REAL NOT NULL, buy_at TEXT NOT NULL, source TEXT NOT NULL,
      steam_synced_at TEXT, steam_tradable INTEGER, steam_unlock_est_at TEXT, steam_first_seen_at TEXT
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY, item_name TEXT NOT NULL, quantity INTEGER NOT NULL,
      buy_price REAL NOT NULL, buy_at TEXT NOT NULL, source TEXT NOT NULL,
      expected_discount REAL, budget_used REAL NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE zh_names (market_hash_name TEXT PRIMARY KEY, cn_name TEXT NOT NULL);
  `);
  return db;
}

/** 与 storage.addSnapshot 相同的 SQL */
function addSnapshot(db, snap) {
  db.prepare(`
    INSERT INTO snapshots (name, source, kind, price, volume, fetched_at, popular_rank)
    VALUES (?, ?, 'rt', ?, ?, ?, ?)
    ON CONFLICT(name, source) WHERE kind = 'rt'
    DO UPDATE SET price = excluded.price, volume = excluded.volume,
                  fetched_at = excluded.fetched_at, popular_rank = excluded.popular_rank
  `).run(snap.name, snap.source, snap.price, snap.volume ?? null, snap.fetchedAt, snap.popular_rank ?? null);
}

/** 与 storage.pruneHistory 相同的 SQL */
function pruneHistory(db, name, source) {
  db.prepare(`
    DELETE FROM snapshots WHERE kind = 'hist' AND name = ? AND source = ? AND id NOT IN (
      SELECT id FROM snapshots WHERE kind = 'hist' AND name = ? AND source = ?
      ORDER BY fetched_at DESC LIMIT ?
    )
  `).run(name, source, name, source, HISTORY_KEEP);
}

/** 与 storage.insertHistBatched 相同的批量多行 INSERT（每批 120 行 × 5 参数，v1.8.1） */
const HIST_BATCH_ROWS = 120;
function insertHistBatched(db, name, source, rows) {
  let added = 0;
  for (let i = 0; i < rows.length; i += HIST_BATCH_ROWS) {
    const batch = rows.slice(i, i + HIST_BATCH_ROWS);
    const params = [];
    for (const r of batch) params.push(name, source, r.price, r.volume, r.fetchedAt);
    const res = db.prepare(
      `INSERT OR IGNORE INTO snapshots (name, source, kind, price, volume, fetched_at, popular_rank)
       VALUES ${batch.map(() => "(?, ?, 'hist', ?, ?, ?, NULL)").join(', ')}`
    ).run(...params);
    if (res.changes > 0) added += res.changes;
  }
  return added;
}

/** 与 storage.mergeSteamHistory 相同的写入（批量版，v1.8.1） */
function mergeSteamHistory(db, name, points) {
  const rows = points.map((pt) => ({ price: pt.price, volume: pt.volume ?? null, fetchedAt: `${pt.date}T08:00:00.000Z` }));
  const added = insertHistBatched(db, name, 'steam', rows);
  if (added > 0) pruneHistory(db, name, 'steam');
  return added;
}

console.log('--- 1. 实时点每 (name, source) 只保留 1 条 ---');
{
  const db = makeDb();
  addSnapshot(db, { name: 'A', source: 'steam', price: 10, volume: 5, fetchedAt: '2026-01-01T10:00:00.000Z' });
  addSnapshot(db, { name: 'A', source: 'steam', price: 12, volume: 6, fetchedAt: '2026-01-01T11:00:00.000Z' });
  const rows = db.prepare(`SELECT price, fetched_at FROM snapshots WHERE name='A' AND source='steam'`).all();
  assert('实时点只 1 条', rows.length === 1, rows.length);
  assert('实时点被更新为最新值', rows[0].price === 12 && rows[0].fetched_at === '2026-01-01T11:00:00.000Z', rows[0]);
  // 不同 source 互不影响
  addSnapshot(db, { name: 'A', source: 'c5', price: 8, volume: null, fetchedAt: '2026-01-01T10:00:00.000Z' });
  const cnt = db.prepare(`SELECT COUNT(*) AS c FROM snapshots WHERE name='A'`).get().c;
  assert('steam/c5 各留 1 条', cnt === 2, cnt);
  db.close();
}

console.log('--- 2. 历史点按 (name, source, fetched_at) 去重 ---');
{
  const db = makeDb();
  const added1 = mergeSteamHistory(db, 'A', [
    { date: '2026-01-01', price: 10, volume: 5 },
    { date: '2026-01-02', price: 11, volume: 6 },
  ]);
  assert('首次导入 2 点', added1 === 2, added1);
  const added2 = mergeSteamHistory(db, 'A', [
    { date: '2026-01-01', price: 99, volume: 9 },  // 重复日期，应忽略
    { date: '2026-01-03', price: 12, volume: 7 },  // 新点
  ]);
  assert('重复日期被忽略，只新增 1 点', added2 === 1, added2);
  const rows = db.prepare(`SELECT price FROM snapshots WHERE name='A' ORDER BY fetched_at`).all();
  assert('历史共 3 点', rows.length === 3, rows.length);
  assert('重复日期保留原值 10（未被 99 覆盖）', rows[0].price === 10, rows[0].price);
  db.close();
}

console.log('--- 3. 历史点裁剪到 HISTORY_KEEP ---');
{
  const db = makeDb();
  const pts = [];
  for (let i = 0; i < 800; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    pts.push({ date: d, price: 10 + i * 0.01, volume: 1 });
  }
  mergeSteamHistory(db, 'A', pts);
  const cnt = db.prepare(`SELECT COUNT(*) AS c FROM snapshots WHERE name='A' AND kind='hist'`).get().c;
  assert('裁剪到 HISTORY_KEEP=730', cnt === HISTORY_KEEP, cnt);
  const oldest = db.prepare(`SELECT fetched_at FROM snapshots WHERE name='A' ORDER BY fetched_at ASC LIMIT 1`).get();
  // 800 点保留最新 730 → 最旧应为第 70 天（index 70）
  const expectOldest = pts[800 - HISTORY_KEEP].date + 'T08:00:00.000Z';
  assert('保留的是最新 730 点（最旧=第71天）', oldest.fetched_at === expectOldest, oldest.fetched_at);
  db.close();
}

console.log('--- 4. c5_hist 可同时含日线与日内点 ---');
{
  const db = makeDb();
  const ins = db.prepare(`
    INSERT OR IGNORE INTO snapshots (name, source, kind, price, volume, fetched_at, popular_rank)
    VALUES (?, 'c5_hist', 'hist', ?, NULL, ?, NULL)
  `);
  ins.run('A', 10, '2026-01-01T08:00:00.000Z');   // 日线
  ins.run('A', 10.5, '2026-01-01T15:30:00.000Z'); // 同日日内点
  const cnt = db.prepare(`SELECT COUNT(*) AS c FROM snapshots WHERE name='A'`).get().c;
  assert('同日日线+日内点共存', cnt === 2, cnt);
  // 同 fetched_at 重复写入被忽略
  const r = ins.run('A', 99, '2026-01-01T15:30:00.000Z');
  assert('同 fetched_at 重复写入被忽略', r.changes === 0, r.changes);
  db.close();
}

console.log('--- 5. inventory / orders id 递增 ---');
{
  const db = makeDb();
  const nextId = (t) => (db.prepare(`SELECT MAX(id) AS m FROM ${t}`).get().m ?? 0) + 1;
  const id1 = nextId('inventory');
  db.prepare(`INSERT INTO inventory (id,item_name,quantity,buy_price,buy_at,source) VALUES (?,?,?,?,?,?)`)
    .run(id1, 'X', 1, 10, '2026-01-01', 'c5game');
  const id2 = nextId('inventory');
  db.prepare(`INSERT INTO inventory (id,item_name,quantity,buy_price,buy_at,source) VALUES (?,?,?,?,?,?)`)
    .run(id2, 'Y', 2, 20, '2026-01-02', 'c5game');
  assert('inventory id 递增 1,2', id1 === 1 && id2 === 2, [id1, id2]);

  const oid1 = nextId('orders');
  db.prepare(`INSERT INTO orders (id,item_name,quantity,buy_price,buy_at,source,expected_discount,budget_used) VALUES (?,?,?,?,?,?,?,?)`)
    .run(oid1, 'X', 1, 10, '2026-01-01', 'c5game', 0.9, 10);
  assert('orders id 从 1 开始', oid1 === 1, oid1);
  db.close();
}

console.log('--- 6. clearAllData 只清 3 表，settings 保留 ---');
{
  const db = makeDb();
  addSnapshot(db, { name: 'A', source: 'steam', price: 10, volume: 1, fetchedAt: '2026-01-01T00:00:00.000Z' });
  db.prepare(`INSERT INTO inventory (id,item_name,quantity,buy_price,buy_at,source) VALUES (1,'X',1,10,'2026-01-01','c5game')`).run();
  db.prepare(`INSERT INTO orders (id,item_name,quantity,buy_price,buy_at,source,expected_discount,budget_used) VALUES (1,'X',1,10,'2026-01-01','c5game',0.9,10)`).run();
  db.prepare(`INSERT INTO settings (key,value) VALUES ('c5AppKey','"secret"')`).run();
  // 模拟 clearAllData({snapshots:true, inventory:true, orders:true})
  db.exec(`DELETE FROM snapshots; DELETE FROM inventory; DELETE FROM orders;`);
  const snaps = db.prepare('SELECT COUNT(*) AS c FROM snapshots').get().c;
  const inv = db.prepare('SELECT COUNT(*) AS c FROM inventory').get().c;
  const ord = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  const st = db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
  assert('snapshots 已清空', snaps === 0, snaps);
  assert('inventory 已清空', inv === 0, inv);
  assert('orders 已清空', ord === 0, ord);
  assert('settings 保留', st === 1, st);
  db.close();
}

console.log('--- 7. settings KV 存取往返 ---');
{
  const db = makeDb();
  const next = { refreshCount: 20, c5AppKey: 'k', buyMaxPrice: 0 };
  const ins = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  for (const k of Object.keys(next)) ins.run(k, JSON.stringify(next[k]));
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const back = {};
  for (const r of rows) back[r.key] = JSON.parse(r.value);
  assert('settings 往返一致', JSON.stringify(back) === JSON.stringify(next), back);
  db.close();
}

console.log('--- 8. zh_names 主键替换 ---');
{
  const db = makeDb();
  const ins = db.prepare('INSERT OR REPLACE INTO zh_names (market_hash_name, cn_name) VALUES (?,?)');
  ins.run('A', '甲');
  ins.run('A', '乙');
  const rows = db.prepare('SELECT cn_name FROM zh_names WHERE market_hash_name=?').all('A');
  assert('同名中文名被替换', rows.length === 1 && rows[0].cn_name === '乙', rows);
  db.close();
}

console.log('--- 9. 批量合并与逐行合并结果一致（v1.8.1 闪退修复的契约） ---');
{
  const pts = [];
  for (let i = 0; i < 300; i++) { // 300 点跨 3 个批次（120/批）
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    pts.push({ date: d, price: 10 + (i % 7) * 0.5, volume: (i % 5) + 1 });
  }
  // 旧实现（逐行 INSERT OR IGNORE）作参考
  const dbRow = makeDb();
  let addedRow = 0;
  const insRow = dbRow.prepare(`
    INSERT OR IGNORE INTO snapshots (name, source, kind, price, volume, fetched_at, popular_rank)
    VALUES (?, 'steam', 'hist', ?, ?, ?, NULL)
  `);
  for (const pt of pts) {
    const r = insRow.run('A', pt.price, pt.volume ?? null, `${pt.date}T08:00:00.000Z`);
    if (r.changes > 0) addedRow++;
  }
  // 新实现（批量多行）
  const dbBatch = makeDb();
  const addedBatch = mergeSteamHistory(dbBatch, 'A', pts);
  assert('批量与逐行新增数一致（300 跨批）', addedBatch === addedRow && addedBatch === 300, [addedBatch, addedRow]);
  const rowsRow = dbRow.prepare(`SELECT name, source, kind, price, volume, fetched_at FROM snapshots ORDER BY fetched_at`).all();
  const rowsBatch = dbBatch.prepare(`SELECT name, source, kind, price, volume, fetched_at FROM snapshots ORDER BY fetched_at`).all();
  assert('批量与逐行落库内容一致', JSON.stringify(rowsRow) === JSON.stringify(rowsBatch), rowsBatch.length);
  // 批量重复合并：同样按 (name, source, fetched_at) 去重，不产生新行
  const again = mergeSteamHistory(dbBatch, 'A', pts);
  assert('批量重复合并不产生新行', again === 0, again);
  dbRow.close();
  dbBatch.close();
}

console.log('--- 10. 精确查询 getSnapshotNames / getSnapshotStats（v1.8.2 切页提速） ---');
{
  const db = makeDb();
  mergeSteamHistory(db, 'A', [
    { date: '2026-01-01', price: 10, volume: 5 },
    { date: '2026-01-02', price: 11, volume: 6 },
  ]);
  mergeSteamHistory(db, 'B', [{ date: '2026-01-01', price: 20, volume: 7 }]);
  addSnapshot(db, { name: 'A', source: 'c5', price: 9, volume: null, fetchedAt: '2026-01-03T00:00:00.000Z' });
  // 与 storage.getSnapshotNames 相同 SQL
  const names = db.prepare('SELECT DISTINCT name FROM snapshots').all().map((r) => r.name).sort();
  assert('getSnapshotNames 去重且不丢箱', JSON.stringify(names) === '["A","B"]', names);
  // 与 storage.getSnapshotStats 相同 SQL
  const s = db.prepare('SELECT COUNT(*) AS c, COUNT(DISTINCT name) AS n, MAX(fetched_at) AS m FROM snapshots').get();
  assert('getSnapshotStats.count=4', s.c === 4, s.c);
  assert('getSnapshotStats.itemCount=2', s.n === 2, s.n);
  assert('getSnapshotStats.lastUpdated 为最新', s.m === '2026-01-03T00:00:00.000Z', s.m);
  db.close();
}

console.log('--- 11. 写队列串行化（v1.8.5：mergeZhNames/migrate 并入共享队列，杜绝嵌套 BEGIN） ---');
(async () => {
  // writeQueue.ts 无 RN 依赖，可单独编译后直接测
  const fs = require('fs');
  const pathMod = require('path');
  const { execSync } = require('child_process');
  const rootDir = pathMod.resolve(__dirname, '..');
  const outDir = pathMod.join(__dirname, '.wq-build');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  execSync(
    'npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) +
      ' ' + JSON.stringify(pathMod.join(rootDir, 'src', 'data', 'writeQueue.ts')),
    { cwd: rootDir, stdio: 'pipe', shell: true },
  );
  const wq = require(pathMod.join(outDir, 'writeQueue.js'));

  // 模拟两个并发「事务」：记录 BEGIN/COMMIT 顺序，断言永不交错
  const log = [];
  const txn = (label, delay) => wq.enqueueWrite(async () => {
    log.push('BEGIN:' + label);
    await new Promise((r) => setTimeout(r, delay));
    log.push('COMMIT:' + label);
  });
  // 同时入队 4 个（含不同耗时的慢事务），必须严格串行
  await Promise.all([txn('a', 30), txn('b', 5), txn('c', 20), txn('d', 1)]);
  let interleaved = false;
  let open = null;
  for (const e of log) {
    const [kind, label] = e.split(':');
    if (kind === 'BEGIN') { if (open !== null) interleaved = true; open = label; }
    else { if (open !== label) interleaved = true; open = null; }
  }
  assert('4 个事务严格串行、无嵌套 BEGIN', !interleaved && open === null, log);
  assert('全部 4 个事务都执行', log.filter((x) => x.startsWith('COMMIT:')).length === 4, log);

  // 失败任务不阻塞后续任务（队列容错）
  const order = [];
  await wq.enqueueWrite(async () => { order.push('fail-start'); throw new Error('boom'); }).catch(() => {});
  await wq.enqueueWrite(async () => { order.push('after'); });
  assert('前一个事务抛错不影响后续入队任务', order.join(',') === 'fail-start,after', order);

  // 队列排空后 idle 立即 resolve
  await wq.waitWriteQueueIdle();
  assert('waitWriteQueueIdle 可等待队列排空', true);

  finish();
})();

function finish() {
console.log('--- 12. getInventoryByName / removeInventory（v1.8.6 库存详情与自动清理） ---');
{
  const db = makeDb();
  const ins = db.prepare(`INSERT INTO inventory (id, item_name, quantity, buy_price, buy_at, source,
    steam_synced_at, steam_tradable, steam_unlock_est_at, steam_first_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run(1, 'A', 2, 10, '2026-09-01T00:00:00.000Z', 'c5game', null, null, null, null);
  ins.run(2, 'B', 1, 20, '2026-09-01T00:00:00.000Z', 'c5game', null, null, null, null);
  ins.run(3, 'A', 3, 12, '2026-09-02T00:00:00.000Z', 'c5game', null, null, null, null);
  // 与 storage.getInventoryByName 相同 SQL
  const aRows = db.prepare('SELECT * FROM inventory WHERE item_name = ? ORDER BY id ASC').all('A');
  assert('getInventoryByName 只返回该箱记录', aRows.length === 2 && aRows.every((r) => r.item_name === 'A'), aRows.length);
  assert('getInventoryByName 按 id 升序', aRows[0].id === 1 && aRows[1].id === 3, aRows.map((r) => r.id));
  assert('getInventoryByName 未收录返回空', db.prepare('SELECT * FROM inventory WHERE item_name = ?').all('Z').length === 0);
  // 与 storage.removeInventory 相同语义（逐条 DELETE，统计 changes）
  let removed = 0;
  const del = db.prepare('DELETE FROM inventory WHERE id = ?');
  for (const id of [2, 3]) if (del.run(id).changes > 0) removed++;
  assert('removeInventory 移除 2 条', removed === 2, removed);
  const left = db.prepare('SELECT id FROM inventory ORDER BY id').all().map((r) => r.id);
  assert('removeInventory 保留未指定的记录', JSON.stringify(left) === '[1]', left);
  db.close();
}

console.log('');
console.log(`PASS ${passed} / ${passed + failed}`);
  if (failed > 0) {
    console.log('STORAGE CONTRACT TESTS FAILED');
    process.exit(1);
  }
  console.log('ALL STORAGE CONTRACT TESTS PASSED');
}
