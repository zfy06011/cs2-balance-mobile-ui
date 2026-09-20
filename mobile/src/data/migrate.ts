/**
 * migrate：AsyncStorage → SQLite 一次性数据迁移（v1.7.0）。
 * - 幂等：meta.migrated_from_asyncstorage 标记位与数据同事务写入
 * - 失败安全：事务回滚则标记不写，旧 AsyncStorage 数据保留，下次启动重试
 * - 成功后删除旧 key（用户选择：迁移成功即清理）
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureDb, getMeta, setMeta, LEGACY_KEYS } from './db';
import { enqueueWrite } from './writeQueue';
import { importBundledHistorySeed } from './historySeed';

const MIGRATION_FLAG = 'migrated_from_asyncstorage';

interface LegacySnapshot {
  name?: string;
  source?: string;
  price?: number;
  volume?: number | null;
  fetchedAt?: string;
  popular_rank?: number | null;
}

interface LegacyInventory {
  id?: number;
  item_name?: string;
  quantity?: number;
  buy_price?: number;
  buy_at?: string;
  source?: string;
  steam_synced_at?: string | null;
  steam_tradable?: boolean | null;
  steam_unlock_est_at?: string | null;
  steam_first_seen_at?: string | null;
}

interface LegacyOrder {
  id?: number;
  item_name?: string;
  quantity?: number;
  buy_price?: number;
  buy_at?: string;
  source?: string;
  expected_discount?: number | null;
  budget_used?: number;
}

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 执行迁移。已迁移过则直接返回 false（无操作）。
 * 返回 true 表示本次执行了迁移。
 */
export async function migrateFromAsyncStorage(): Promise<boolean> {
  const flag = await getMeta(MIGRATION_FLAG);
  if (flag === '1') return false;

  // 读取全部旧 key（一次性批量读）
  let legacy: readonly [string, string | null][] = [];
  try {
    legacy = await AsyncStorage.multiGet(Object.values(LEGACY_KEYS));
  } catch {
    // 读旧数据失败：不标记，下次启动重试
    return false;
  }
  const map = new Map<string, string | null>(legacy);
  const rawSnapshots = map.get(LEGACY_KEYS.snapshots) ?? null;
  const rawInventory = map.get(LEGACY_KEYS.inventory) ?? null;
  const rawOrders = map.get(LEGACY_KEYS.orders) ?? null;
  const rawSettings = map.get(LEGACY_KEYS.settings) ?? null;
  const rawScan = map.get(LEGACY_KEYS.scan) ?? null;
  const rawEventFeed = map.get(LEGACY_KEYS.eventFeed) ?? null;
  const rawZhNames = map.get(LEGACY_KEYS.zhNames) ?? null;

  // 无任何旧数据：直接标记完成（全新安装）
  const hasAny = rawSnapshots || rawInventory || rawOrders || rawSettings || rawScan || rawEventFeed || rawZhNames;
  if (!hasAny) {
    await setMeta(MIGRATION_FLAG, '1');
    return false;
  }

  // v1.8.5：迁移事务并入全局写队列，与其它事务统一串行（防嵌套 BEGIN）
  await enqueueWrite(async () => {
    const db = await ensureDb();
    await db.withTransactionAsync(async () => {
    // 快照：source='c5' 为实时点；'c5_hist' 全部为历史点；
    // 'steam' 按 fetchedAt 区分（日线固定 T08:00:00.000Z，实时点为真实时间戳）
    const snaps = parseJSON<LegacySnapshot[]>(rawSnapshots, []);
    for (const s of snaps) {
      if (!s || !s.name || !s.source || typeof s.price !== 'number' || !s.fetchedAt) continue;
      if (s.source !== 'steam' && s.source !== 'c5' && s.source !== 'c5_hist') continue;
      let kind: 'rt' | 'hist';
      if (s.source === 'c5') kind = 'rt';
      else if (s.source === 'c5_hist') kind = 'hist';
      else kind = /T08:00:00\.000Z$/.test(s.fetchedAt) ? 'hist' : 'rt';
      await db.runAsync(
        `INSERT OR IGNORE INTO snapshots (name, source, kind, price, volume, fetched_at, popular_rank)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        s.name,
        s.source,
        kind,
        s.price,
        s.volume ?? null,
        s.fetchedAt,
        s.popular_rank ?? null,
      );
    }

    // 库存
    const invs = parseJSON<LegacyInventory[]>(rawInventory, []);
    for (const it of invs) {
      if (!it || typeof it.id !== 'number' || !it.item_name) continue;
      await db.runAsync(
        `INSERT OR IGNORE INTO inventory (id, item_name, quantity, buy_price, buy_at, source,
          steam_synced_at, steam_tradable, steam_unlock_est_at, steam_first_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        it.id,
        it.item_name,
        it.quantity ?? 0,
        it.buy_price ?? 0,
        it.buy_at ?? '',
        it.source ?? '',
        it.steam_synced_at ?? null,
        it.steam_tradable == null ? null : it.steam_tradable ? 1 : 0,
        it.steam_unlock_est_at ?? null,
        it.steam_first_seen_at ?? null,
      );
    }

    // 订单
    const orders = parseJSON<LegacyOrder[]>(rawOrders, []);
    for (const o of orders) {
      if (!o || typeof o.id !== 'number' || !o.item_name) continue;
      await db.runAsync(
        `INSERT OR IGNORE INTO orders (id, item_name, quantity, buy_price, buy_at, source, expected_discount, budget_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        o.id,
        o.item_name,
        o.quantity ?? 0,
        o.buy_price ?? 0,
        o.buy_at ?? '',
        o.source ?? '',
        o.expected_discount ?? null,
        o.budget_used ?? 0,
      );
    }

    // 设置（KV 逐字段）
    const settings = parseJSON<Record<string, unknown>>(rawSettings, {});
    for (const k of Object.keys(settings)) {
      await db.runAsync(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        k,
        JSON.stringify(settings[k]),
      );
    }

    // 扫描状态 / 事件缓存
    if (rawScan) {
      await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', 'scan_state', rawScan);
    }
    if (rawEventFeed) {
      await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', 'event_feed', rawEventFeed);
    }

    // 中文名缓存
    const zh = parseJSON<Record<string, unknown>>(rawZhNames, {});
    for (const k of Object.keys(zh)) {
      const v = zh[k];
      if (typeof v === 'string' && v) {
        await db.runAsync(
          'INSERT OR REPLACE INTO zh_names (market_hash_name, cn_name) VALUES (?, ?)',
          k,
          v,
        );
      }
    }

    // 标记位与数据同事务，保证原子
    await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', MIGRATION_FLAG, '1');
    });
  });

  // 迁移成功：删除旧 AsyncStorage 数据（用户选择）
  try {
    await AsyncStorage.multiRemove(Object.values(LEGACY_KEYS));
  } catch {
    // 删除失败不影响已完成的迁移（旧数据残留但已不读取）
  }
  return true;
}

/** 启动初始化：建库 + 迁移 + 中文名预热（App.tsx 调用） */
export async function initStorage(): Promise<void> {
  await ensureDb();
  await migrateFromAsyncStorage();
  await importBundledHistorySeed();
}
