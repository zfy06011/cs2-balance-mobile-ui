/**
 * storage：本地存储（expo-sqlite，v1.7.0 起由 AsyncStorage 迁移）。
 * - 快照：每箱保留最新 1 条 Steam/C5 实时快照（kind='rt'）+ 历史点（kind='hist'）
 * - Steam 历史日线由安装包种子和直连 SSR 补入本地 hist 点
 * - 库存：手动录入 / 一键买入 / Steam 库存同步导入
 * - 订单：一键买入的独立订单流水
 * - 设置：C5 app-key、采集数量、Steam cookie（可选）、购买保护参数
 *
 * 对外方法签名与 v1.6.x 完全一致，上层（engine/collector/screens/api）零改动。
 */
import { ensureDb } from './db';
import { bumpAnalysisGeneration } from '../core/analysisCache';
import { enqueueWrite } from './writeQueue';
import { readSecureSetting, writeSecureSetting } from './secureSettings';

export interface LocalSnapshot {
  /** steam = Steam 实时/历史点；c5 = C5 当前买入价；c5_hist = C5 官方历史日线（网页 cookie 导入） */
  name: string;
  source: 'steam' | 'c5' | 'c5_hist';
  price: number;
  volume: number | null;
  fetchedAt: string;
  /** 热门榜单排名（Steam 热门榜采集时写入，1 起） */
  popular_rank?: number | null;
}

export interface LocalInventoryItem {
  id: number;
  item_name: string;
  quantity: number;
  buy_price: number;
  buy_at: string;
  source: string;
  /** ---- Steam 库存同步（可选；「同步 Steam 冷却」填充，用于精确到小时的解锁倒计时） ---- */
  /** 最近一次 Steam 同步时间 */
  steam_synced_at?: string | null;
  /** 最近同步时该物品是否已可交易/可上架 */
  steam_tradable?: boolean | null;
  /** 估计可交易时刻（随每次同步 min 累积逼近真实解锁） */
  steam_unlock_est_at?: string | null;
  /** 首次在 Steam 库存观察到该物品的时间 */
  steam_first_seen_at?: string | null;
}

export interface LocalOrder {
  id: number;
  item_name: string;
  quantity: number;
  buy_price: number;
  buy_at: string;
  source: string;
  expected_discount: number | null;
  budget_used: number;
}

export interface AppSettings {
  c5AppKey: string;
  /** SteamID64（/profiles/ 后的 17 位数字），用于库存冷却同步 */
  steamId: string;
  refreshCount: number;
  steamCookie: string;
  /** 购买保护：最高买入价（元，0 不限） */
  buyMaxPrice: number;
  /** 购买保护：最低目标折扣（折数，如 9.5，0 不限） */
  buyTargetZhe: number;
  /** 购买保护：单笔预算上限（元，0 不限） */
  buyMaxBudget: number;
  /** 雷达目标折扣（折数，低于该值才提醒，默认 7） */
  radarTargetZhe: number;
}

export interface LocalSyncStatus {
  readonly seedVersion: string;
  readonly lastRealtimeRefreshAt: string | null;
  readonly lastHistoryRefreshAt: string | null;
  readonly historySuccessCount: number;
  readonly historyFailureCount: number;
}

const LOCAL_SYNC_STATUS_KEY = 'local_sync_status';
const DEFAULT_LOCAL_SYNC_STATUS: LocalSyncStatus = {
  seedVersion: 'none',
  lastRealtimeRefreshAt: null,
  lastHistoryRefreshAt: null,
  historySuccessCount: 0,
  historyFailureCount: 0,
};

/** 旧 AsyncStorage key 见 db.ts 的 LEGACY_KEYS（v1.7.0 迁移用） */

export const HISTORY_KEEP = 730;
export const LOCK_HOURS = 168;
export const LOCK_DAYS = 7;

/** 扫描会话状态（跨页面/前后台共享，断点续采展示用） */
export interface ScanStateRecord {
  running: boolean;
  progress: CollectProgressLike | null;
  startedAt: string | null;
  count: number;
}

/** 与 collector.CollectProgress 结构一致的轻量形状（避免循环依赖） */
export interface CollectProgressLike {
  stage: 'listing' | 'c5' | 'prices' | 'done';
  done: number;
  total: number;
  currentName: string;
  success: number;
  failed: number;
  message: string;
}

/** 设置变更事件：设置页改完，首页扫描按钮上的数量实时刷新 */
const settingsListeners = new Set<(s: AppSettings) => void>();

export const settingsEvents = {
  subscribe(l: (s: AppSettings) => void): () => void {
    settingsListeners.add(l);
    return () => {
      settingsListeners.delete(l);
    };
  },
  emit(s: AppSettings): void {
    for (const l of settingsListeners) {
      try {
        l({ ...s });
      } catch {
        // 单个订阅者异常不影响其他
      }
    }
  },
};

function num(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n >= 0 ? n : def;
}

const DEFAULT_SETTINGS: AppSettings = {
  c5AppKey: '',
  steamId: '',
  refreshCount: 20,
  steamCookie: '',
  buyMaxPrice: 0,
  buyTargetZhe: 0,
  buyMaxBudget: 0,
  radarTargetZhe: 7,
};

// ---------------------------------------------------------------------------
// 行 ↔ 对象映射
// ---------------------------------------------------------------------------

interface SnapRow {
  name: string;
  source: string;
  kind: string;
  price: number;
  volume: number | null;
  fetched_at: string;
  popular_rank: number | null;
}

function rowToSnapshot(r: SnapRow): LocalSnapshot {
  return {
    name: r.name,
    source: r.source as LocalSnapshot['source'],
    price: r.price,
    volume: r.volume,
    fetchedAt: r.fetched_at,
    popular_rank: r.popular_rank,
  };
}

interface InvRow {
  id: number;
  item_name: string;
  quantity: number;
  buy_price: number;
  buy_at: string;
  source: string;
  steam_synced_at: string | null;
  steam_tradable: number | null;
  steam_unlock_est_at: string | null;
  steam_first_seen_at: string | null;
}

function rowToInventory(r: InvRow): LocalInventoryItem {
  return {
    id: r.id,
    item_name: r.item_name,
    quantity: r.quantity,
    buy_price: r.buy_price,
    buy_at: r.buy_at,
    source: r.source,
    steam_synced_at: r.steam_synced_at,
    steam_tradable: r.steam_tradable == null ? null : r.steam_tradable === 1,
    steam_unlock_est_at: r.steam_unlock_est_at,
    steam_first_seen_at: r.steam_first_seen_at,
  };
}

interface OrderRow {
  id: number;
  item_name: string;
  quantity: number;
  buy_price: number;
  buy_at: string;
  source: string;
  expected_discount: number | null;
  budget_used: number;
}

function rowToOrder(r: OrderRow): LocalOrder {
  return {
    id: r.id,
    item_name: r.item_name,
    quantity: r.quantity,
    buy_price: r.buy_price,
    buy_at: r.buy_at,
    source: r.source,
    expected_discount: r.expected_discount,
    budget_used: r.budget_used,
  };
}

// ---------------------------------------------------------------------------
// storage 门面（签名与 v1.6.x 一致）
// ---------------------------------------------------------------------------

export const storage = {
  // ---- 设置 ----
  async getSettings(): Promise<AppSettings> {
    const db = await ensureDb();
    const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
    const raw: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        raw[r.key] = JSON.parse(r.value);
      } catch {
        raw[r.key] = r.value;
      }
    }
    const s = raw as Partial<AppSettings>;
    const [storedC5AppKey, storedSteamCookie] = await Promise.all([
      readSecureSetting('c5AppKey'),
      readSecureSetting('steamCookie'),
    ]);
    const legacyC5AppKey = typeof s.c5AppKey === 'string' ? s.c5AppKey : '';
    const legacySteamCookie = typeof s.steamCookie === 'string' ? s.steamCookie : '';
    const migratedKeys: string[] = [];
    if (!storedC5AppKey && legacyC5AppKey) {
      await writeSecureSetting('c5AppKey', legacyC5AppKey);
      migratedKeys.push('c5AppKey');
    }
    if (!storedSteamCookie && legacySteamCookie) {
      await writeSecureSetting('steamCookie', legacySteamCookie);
      migratedKeys.push('steamCookie');
    }
    if (migratedKeys.length > 0) {
      for (const key of migratedKeys) await db.runAsync('DELETE FROM settings WHERE key = ?', key);
    }
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      refreshCount: num(s.refreshCount, DEFAULT_SETTINGS.refreshCount),
      buyMaxPrice: num(s.buyMaxPrice, 0),
      buyTargetZhe: num(s.buyTargetZhe, 0),
      buyMaxBudget: num(s.buyMaxBudget, 0),
      radarTargetZhe: num(s.radarTargetZhe, DEFAULT_SETTINGS.radarTargetZhe),
      c5AppKey: storedC5AppKey ?? legacyC5AppKey,
      steamCookie: storedSteamCookie ?? legacySteamCookie,
    };
  },
  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const cur = await this.getSettings();
    const next = { ...cur, ...patch };
    await Promise.all([
      writeSecureSetting('c5AppKey', next.c5AppKey),
      writeSecureSetting('steamCookie', next.steamCookie),
    ]);
    await enqueueWrite(async () => {
      const db = await ensureDb();
      await db.withTransactionAsync(async () => {
        for (const key of Object.keys(next) as (keyof AppSettings)[]) {
          if (key === 'c5AppKey' || key === 'steamCookie') continue;
          await db.runAsync(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            key,
            JSON.stringify(next[key]),
          );
        }
      });
    });
    this.emitSettings(next);
    // 设置影响 status.c5Configured 等分析结果，失效缓存
    bumpAnalysisGeneration();
    return next;
  },
  emitSettings(s: AppSettings): void {
    settingsEvents.emit(s);
  },

  // ---- 扫描会话状态 ----
  async saveScanState(s: ScanStateRecord): Promise<void> {
    const db = await ensureDb();
    await db.runAsync(
      'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)',
      'scan_state',
      JSON.stringify(s),
    );
  },
  async getScanState(): Promise<ScanStateRecord | null> {
    const db = await ensureDb();
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'scan_state');
    if (!row) return null;
    try {
      const s = JSON.parse(row.value) as ScanStateRecord;
      if (!s || typeof s !== 'object') return null;
      return s;
    } catch {
      return null;
    }
  },

  // ---- 市场事件源缓存（RSS 拉取结果） ----
  async saveEventFeed(feed: { items: unknown[]; fetchedAt: string }): Promise<void> {
    const db = await ensureDb();
    await db.runAsync(
      'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)',
      'event_feed',
      JSON.stringify(feed),
    );
  },
  async getEventFeed(): Promise<{ items: Array<Record<string, unknown>>; fetchedAt: string } | null> {
    const db = await ensureDb();
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'event_feed');
    if (!row) return null;
    try {
      const f = JSON.parse(row.value) as { items: Array<Record<string, unknown>>; fetchedAt: string };
      if (!f || !Array.isArray(f.items)) return null;
      return f;
    } catch {
      return null;
    }
  },

  /** 通用 KV：复用既有 kv 表保存 dev/diagnostics 数据，不新增 schema。 */
  async setKv(key: string, value: string): Promise<void> {
    const db = await ensureDb();
    await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
  },
  async getKv(key: string): Promise<string | null> {
    const db = await ensureDb();
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return row?.value ?? null;
  },

  async getLocalSyncStatus(): Promise<LocalSyncStatus> {
    const raw = await this.getKv(LOCAL_SYNC_STATUS_KEY);
    if (!raw) return DEFAULT_LOCAL_SYNC_STATUS;
    try {
      const value = JSON.parse(raw) as Partial<LocalSyncStatus>;
      return {
        seedVersion: typeof value.seedVersion === 'string' ? value.seedVersion : DEFAULT_LOCAL_SYNC_STATUS.seedVersion,
        lastRealtimeRefreshAt: typeof value.lastRealtimeRefreshAt === 'string' ? value.lastRealtimeRefreshAt : null,
        lastHistoryRefreshAt: typeof value.lastHistoryRefreshAt === 'string' ? value.lastHistoryRefreshAt : null,
        historySuccessCount: num(value.historySuccessCount, 0),
        historyFailureCount: num(value.historyFailureCount, 0),
      };
    } catch {
      return DEFAULT_LOCAL_SYNC_STATUS;
    }
  },
  async saveLocalSyncStatus(patch: Partial<LocalSyncStatus>): Promise<LocalSyncStatus> {
    const next = { ...await this.getLocalSyncStatus(), ...patch };
    await this.setKv(LOCAL_SYNC_STATUS_KEY, JSON.stringify(next));
    return next;
  },

  // ---- 快照 ----
  /** 全量快照（供 markets/radar 遍历箱子名）。实时点与历史点都返回。 */
  async getSnapshots(): Promise<LocalSnapshot[]> {
    const db = await ensureDb();
    const rows = await db.getAllAsync<SnapRow>(
      'SELECT name, source, kind, price, volume, fetched_at, popular_rank FROM snapshots ORDER BY fetched_at ASC',
    );
    return rows.map(rowToSnapshot);
  },

  /**
   * 仅取箱子名（v1.8.2 切页提速）：原来 markets/radar 用 getSnapshots() 读全部
   * 历史行（每箱 ~732 行）只为拿 N 个名字，现在一条 DISTINCT 查询搞定。
   */
  async getSnapshotNames(): Promise<string[]> {
    const db = await ensureDb();
    const rows = await db.getAllAsync<{ name: string }>('SELECT DISTINCT name FROM snapshots');
    return rows.map((r) => r.name);
  },

  /**
   * 快照统计（v1.8.2 切页提速）：原来 status() 把全部行读回内存再排序取最大值，
   * 现在 SQL 聚合一次返回（100 箱时从 ~7 万行降到 1 行）。
   */
  async getSnapshotStats(): Promise<{ count: number; itemCount: number; lastUpdated: string | null }> {
    const db = await ensureDb();
    const row = await db.getFirstAsync<{ c: number; n: number; m: string | null }>(
      'SELECT COUNT(*) AS c, COUNT(DISTINCT name) AS n, MAX(fetched_at) AS m FROM snapshots',
    );
    return { count: row?.c ?? 0, itemCount: row?.n ?? 0, lastUpdated: row?.m ?? null };
  },
  /**
   * 写入实时快照（kind='rt'）。
   * 唯一索引 uq_snap_rt 保证每 (name, source) 只保留最新 1 条。
   */
  async addSnapshot(snap: LocalSnapshot): Promise<void> {
    const db = await ensureDb();
    await db.runAsync(
      `INSERT INTO snapshots (name, source, kind, price, volume, fetched_at, popular_rank)
       VALUES (?, ?, 'rt', ?, ?, ?, ?)
       ON CONFLICT(name, source) WHERE kind = 'rt'
       DO UPDATE SET price = excluded.price, volume = excluded.volume,
                     fetched_at = excluded.fetched_at, popular_rank = excluded.popular_rank`,
      snap.name,
      snap.source,
      snap.price,
      snap.volume,
      snap.fetchedAt,
      snap.popular_rank ?? null,
    );
  },
  /**
   * 合并 Steam 历史日线（kind='hist'，source='steam'；按日期去重、上限 HISTORY_KEEP）。
   * 返回实际新增的点数。
   * v1.8.1：批量多行 INSERT（原来 365 点 = 365 次原生往返的长事务，与后台扫描写库
   * 撞车是详情页闪退根因之一），并经写队列串行化。
   */
  async mergeSteamHistory(name: string, points: Array<{ date: string; price: number; volume: number | null }>): Promise<number> {
    if (points.length === 0) return 0;
    const rows = points.map((pt) => ({ price: pt.price, volume: pt.volume, fetchedAt: `${pt.date}T08:00:00.000Z` }));
    return enqueueWrite(async () => {
      const db = await ensureDb();
      let added = 0;
      await db.withTransactionAsync(async () => {
        added = await insertHistBatched(db, name, 'steam', rows);
        if (added > 0) await pruneHistory(db, name, 'steam');
      });
      return added;
    });
  },

  /** 合并 C5 官方历史日线（kind='hist'，source='c5_hist'；按日期去重、上限 HISTORY_KEEP）。返回新增点数。 */
  async mergeC5History(name: string, points: Array<{ date: string; price: number }>): Promise<number> {
    if (points.length === 0) return 0;
    const rows = points.map((pt) => ({ price: pt.price, volume: null as number | null, fetchedAt: `${pt.date}T08:00:00.000Z` }));
    return enqueueWrite(async () => {
      const db = await ensureDb();
      let added = 0;
      await db.withTransactionAsync(async () => {
        added = await insertHistBatched(db, name, 'c5_hist', rows);
        if (added > 0) await pruneHistory(db, name, 'c5_hist');
      });
      return added;
    });
  },

  /** 读取 C5 历史日线（最近 limit 条，按日期升序） */
  async getC5History(name: string, limit = 14): Promise<LocalSnapshot[]> {
    const db = await ensureDb();
    const rows = await db.getAllAsync<SnapRow>(
      `SELECT name, source, kind, price, volume, fetched_at, popular_rank FROM snapshots
       WHERE name = ? AND source = 'c5_hist' AND price > 0
       ORDER BY fetched_at DESC LIMIT ?`,
      name,
      limit,
    );
    return rows.reverse().map(rowToSnapshot);
  },

  async getSteamPrices(name: string): Promise<number[]> {
    const db = await ensureDb();
    const rows = await db.getAllAsync<{ price: number }>(
      `SELECT price FROM snapshots WHERE name = ? AND source = 'steam' AND price > 0 ORDER BY fetched_at ASC`,
      name,
    );
    return rows.map((r) => r.price);
  },
  async getSteamHistory(name: string, limit = 14): Promise<LocalSnapshot[]> {
    const db = await ensureDb();
    const rows = await db.getAllAsync<SnapRow>(
      `SELECT name, source, kind, price, volume, fetched_at, popular_rank FROM snapshots
       WHERE name = ? AND source = 'steam' AND price > 0
       ORDER BY fetched_at DESC LIMIT ?`,
      name,
      limit,
    );
    return rows.reverse().map(rowToSnapshot);
  },
  async getLatestSteam(name: string): Promise<LocalSnapshot | null> {
    const db = await ensureDb();
    const row = await db.getFirstAsync<SnapRow>(
      `SELECT name, source, kind, price, volume, fetched_at, popular_rank FROM snapshots
       WHERE name = ? AND source = 'steam' ORDER BY fetched_at DESC LIMIT 1`,
      name,
    );
    return row ? rowToSnapshot(row) : null;
  },
  async getLatestC5(name: string): Promise<LocalSnapshot | null> {
    const db = await ensureDb();
    const row = await db.getFirstAsync<SnapRow>(
      `SELECT name, source, kind, price, volume, fetched_at, popular_rank FROM snapshots
       WHERE name = ? AND source = 'c5' ORDER BY fetched_at DESC LIMIT 1`,
      name,
    );
    return row ? rowToSnapshot(row) : null;
  },
  async setC5Price(name: string, price: number): Promise<void> {
    await this.addSnapshot({ name, source: 'c5', price, volume: null, fetchedAt: new Date().toISOString() });
    await this.addC5Intraday(name, price);
  },

  /** C5 日内点（真实时间戳）并入 c5_hist：多次扫描/刷新后「较昨日」即为真实 24h 变化 */
  async addC5Intraday(name: string, price: number): Promise<void> {
    if (!Number.isFinite(price) || price <= 0) return;
    await enqueueWrite(async () => {
      const db = await ensureDb();
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT OR IGNORE INTO snapshots (name, source, kind, price, volume, fetched_at, popular_rank)
           VALUES (?, 'c5_hist', 'hist', ?, NULL, ?, NULL)`,
          name,
          price,
          new Date().toISOString(),
        );
        await pruneHistory(db, name, 'c5_hist');
      });
    });
  },

  // ---- 库存 ----
  async getInventory(): Promise<LocalInventoryItem[]> {
    const db = await ensureDb();
    const rows = await db.getAllAsync<InvRow>('SELECT * FROM inventory ORDER BY id ASC');
    return rows.map(rowToInventory);
  },

  /** 只取某个箱子的库存记录（v1.8.6 详情页持仓块用；不拉全表） */
  async getInventoryByName(name: string): Promise<LocalInventoryItem[]> {
    const db = await ensureDb();
    const rows = await db.getAllAsync<InvRow>(
      'SELECT * FROM inventory WHERE item_name = ? ORDER BY id ASC',
      name,
    );
    return rows.map(rowToInventory);
  },

  /** 批量移除库存记录（v1.8.6：Steam 同步时清理已卖出的箱子）；空数组直接返回 */
  async removeInventory(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    return enqueueWrite(async () => {
      const db = await ensureDb();
      let removed = 0;
      await db.withTransactionAsync(async () => {
        for (const id of ids) {
          const res = await db.runAsync('DELETE FROM inventory WHERE id = ?', id);
          if (res.changes > 0) removed += res.changes;
        }
      });
      return removed;
    });
  },
  async addInventory(item: Omit<LocalInventoryItem, 'id'>): Promise<LocalInventoryItem> {
    const db = await ensureDb();
    const row = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(id) AS m FROM inventory');
    const nextId = (row?.m ?? 0) + 1;
    await db.runAsync(
      `INSERT INTO inventory (id, item_name, quantity, buy_price, buy_at, source,
        steam_synced_at, steam_tradable, steam_unlock_est_at, steam_first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nextId,
      item.item_name,
      item.quantity,
      item.buy_price,
      item.buy_at,
      item.source,
      item.steam_synced_at ?? null,
      item.steam_tradable == null ? null : item.steam_tradable ? 1 : 0,
      item.steam_unlock_est_at ?? null,
      item.steam_first_seen_at ?? null,
    );
    return { ...item, id: nextId };
  },

  /** 批量导入库存（一次事务；Steam 库存同步自动导入用） */
  async addInventoryBulk(items: Array<Omit<LocalInventoryItem, 'id'>>): Promise<LocalInventoryItem[]> {
    if (items.length === 0) return [];
    const entries: LocalInventoryItem[] = [];
    await enqueueWrite(async () => {
      const db = await ensureDb();
      await db.withTransactionAsync(async () => {
        const row = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(id) AS m FROM inventory');
        let nextId = (row?.m ?? 0) + 1;
        for (const it of items) {
          const id = nextId++;
          await db.runAsync(
            `INSERT INTO inventory (id, item_name, quantity, buy_price, buy_at, source,
              steam_synced_at, steam_tradable, steam_unlock_est_at, steam_first_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            it.item_name,
            it.quantity,
            it.buy_price,
            it.buy_at,
            it.source,
            it.steam_synced_at ?? null,
            it.steam_tradable == null ? null : it.steam_tradable ? 1 : 0,
            it.steam_unlock_est_at ?? null,
            it.steam_first_seen_at ?? null,
          );
          entries.push({ ...it, id });
        }
      });
    });
    return entries;
  },

  /**
   * 批量更新本地库存的 Steam 冷却字段（一次事务）。
   * patch 里的字段全部覆盖；未出现在 updates 里的条目保持不变。
   */
  async updateInventoryCooldown(
    updates: Array<{
      id: number;
      patch: Pick<LocalInventoryItem, 'steam_synced_at' | 'steam_tradable' | 'steam_unlock_est_at' | 'steam_first_seen_at'>;
    }>,
  ): Promise<void> {
    if (updates.length === 0) return;
    await enqueueWrite(async () => {
      const db = await ensureDb();
      await db.withTransactionAsync(async () => {
        for (const u of updates) {
          await db.runAsync(
            `UPDATE inventory SET steam_synced_at = ?, steam_tradable = ?, steam_unlock_est_at = ?, steam_first_seen_at = ?
             WHERE id = ?`,
            u.patch.steam_synced_at ?? null,
            u.patch.steam_tradable == null ? null : u.patch.steam_tradable ? 1 : 0,
            u.patch.steam_unlock_est_at ?? null,
            u.patch.steam_first_seen_at ?? null,
            u.id,
          );
        }
      });
    });
  },

  // ---- 订单 ----
  async getOrders(): Promise<LocalOrder[]> {
    const db = await ensureDb();
    const rows = await db.getAllAsync<OrderRow>('SELECT * FROM orders ORDER BY id ASC');
    return rows.map(rowToOrder);
  },
  async addOrder(order: Omit<LocalOrder, 'id'>): Promise<LocalOrder> {
    const db = await ensureDb();
    const row = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(id) AS m FROM orders');
    const nextId = (row?.m ?? 0) + 1;
    await db.runAsync(
      `INSERT INTO orders (id, item_name, quantity, buy_price, buy_at, source, expected_discount, budget_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      nextId,
      order.item_name,
      order.quantity,
      order.buy_price,
      order.buy_at,
      order.source,
      order.expected_discount,
      order.budget_used,
    );
    return { ...order, id: nextId };
  },

  /** 按板块清除业务数据（设置/凭证始终保留）。不传参 = 全部清除 */
  async clearAllData(parts?: { snapshots?: boolean; inventory?: boolean; orders?: boolean }): Promise<void> {
    const p = parts ?? { snapshots: true, inventory: true, orders: true };
    await enqueueWrite(async () => {
      const db = await ensureDb();
      await db.withTransactionAsync(async () => {
        if (p.snapshots) await db.runAsync('DELETE FROM snapshots');
        if (p.inventory) await db.runAsync('DELETE FROM inventory');
        if (p.orders) await db.runAsync('DELETE FROM orders');
      });
    });
    // 数据已清：失效全部分析缓存
    bumpAnalysisGeneration();
  },
};

/**
 * v1.8.1 闪退修复 / v1.8.5 抽模块：写队列。把事务型写操作（merge 历史 / 批量库存 / 清库 /
 * 设置 / 中文名）全部串行化，杜绝「详情页补历史」与「App 启动后台续扫」两个长事务重叠——
 * expo-sqlite 事务不可重入（官方文档：非互斥），重叠轻则报
 * "cannot start a transaction within a transaction"，重则原生层不稳定闪退。
 * 队列实现在 data/writeQueue.ts，与 zhNames/migrate 共用同一条链。
 */
export { enqueueWrite } from './writeQueue';

/** 批量多行 INSERT OR IGNORE（每行 5 个绑定参数，120 行/批 = 600，低于 SQLite 999 变量上限）。返回新增行数。 */
const HIST_BATCH_ROWS = 120;

async function insertHistBatched(
  db: Awaited<ReturnType<typeof ensureDb>>,
  name: string,
  source: 'steam' | 'c5_hist',
  rows: Array<{ price: number; volume: number | null; fetchedAt: string }>,
): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += HIST_BATCH_ROWS) {
    const batch = rows.slice(i, i + HIST_BATCH_ROWS);
    const params: Array<string | number | null> = [];
    for (const r of batch) params.push(name, source, r.price, r.volume, r.fetchedAt);
    const res = await db.runAsync(
      `INSERT OR IGNORE INTO snapshots (name, source, kind, price, volume, fetched_at, popular_rank)
       VALUES ${batch.map(() => "(?, ?, 'hist', ?, ?, ?, NULL)").join(', ')}`,
      params,
    );
    if (res.changes > 0) added += res.changes;
  }
  return added;
}

/** 按 (name, source) 裁剪历史点，只保留最新 HISTORY_KEEP 条（kind='hist'） */
async function pruneHistory(db: Awaited<ReturnType<typeof ensureDb>>, name: string, source: string): Promise<void> {
  await db.runAsync(
    `DELETE FROM snapshots WHERE kind = 'hist' AND name = ? AND source = ? AND id NOT IN (
       SELECT id FROM snapshots WHERE kind = 'hist' AND name = ? AND source = ?
       ORDER BY fetched_at DESC LIMIT ?
     )`,
    name,
    source,
    name,
    source,
    HISTORY_KEEP,
  );
}
