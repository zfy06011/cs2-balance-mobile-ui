/**
 * storage：本地存储（AsyncStorage）。
 * - 快照：每个商品保留最近 N 条 Steam 价格 + 最新 C5 价格，用于预测与雷达
 * - 库存：手动录入 / 一键买入成功的购买记录
 * - 订单：一键买入的独立订单流水
 * - 设置：C5 app-key、采集数量、Steam cookie（可选）、购买保护参数
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  /** C5GAME 网页登录 cookie，用于拉取官方历史价格（选填） */
  c5Cookie: string;
  /** Steam Web API Key（免费，steamcommunity.com/dev/apikey）：官方库存接口，含交易保护箱 */
  steamApiKey: string;
  /** SteamID64（/profiles/ 后的 17 位数字），用于 Steam 库存冷却同步 */
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

const K_SNAPSHOTS = '@cs2balance/snapshots_v2';
const K_INVENTORY = '@cs2balance/inventory_v2';
const K_ORDERS = '@cs2balance/orders_v2';
const K_SETTINGS = '@cs2balance/settings_v2';
const K_SCAN = '@cs2balance/scan_state_v1';
const K_EVENT_FEED = '@cs2balance/event_feed_v1';
const STEAM_KEEP = 50;
/** 官方历史导入的每名保留上限（天）：供给长周期指标（波动率/90 天低位/长趋势） */
export const HISTORY_KEEP = 120;
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

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

function num(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n >= 0 ? n : def;
}

const DEFAULT_SETTINGS: AppSettings = {
  c5AppKey: '',
  c5Cookie: '',
  steamApiKey: '',
  steamId: '',
  refreshCount: 20,
  steamCookie: '',
  buyMaxPrice: 0,
  buyTargetZhe: 0,
  buyMaxBudget: 0,
  radarTargetZhe: 7,
};

export const storage = {
  // ---- 设置 ----
  async getSettings(): Promise<AppSettings> {
    const s = await readJSON<Partial<AppSettings>>(K_SETTINGS, {});
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      refreshCount: num(s.refreshCount, DEFAULT_SETTINGS.refreshCount),
      buyMaxPrice: num(s.buyMaxPrice, 0),
      buyTargetZhe: num(s.buyTargetZhe, 0),
      buyMaxBudget: num(s.buyMaxBudget, 0),
      radarTargetZhe: num(s.radarTargetZhe, DEFAULT_SETTINGS.radarTargetZhe),
    };
  },
  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const cur = await this.getSettings();
    const next = { ...cur, ...patch };
    await writeJSON(K_SETTINGS, next);
    this.emitSettings(next);
    return next;
  },
  emitSettings(s: AppSettings): void {
    settingsEvents.emit(s);
  },

  // ---- 扫描会话状态 ----
  async saveScanState(s: ScanStateRecord): Promise<void> {
    await writeJSON(K_SCAN, s);
  },
  async getScanState(): Promise<ScanStateRecord | null> {
    const s = await readJSON<ScanStateRecord | null>(K_SCAN, null);
    if (!s || typeof s !== 'object') return null;
    return s;
  },

  // ---- 市场事件源缓存（RSS 拉取结果） ----
  async saveEventFeed(feed: { items: unknown[]; fetchedAt: string }): Promise<void> {
    await writeJSON(K_EVENT_FEED, feed);
  },
  async getEventFeed(): Promise<{ items: Array<Record<string, unknown>>; fetchedAt: string } | null> {
    const f = await readJSON<{ items: Array<Record<string, unknown>>; fetchedAt: string } | null>(K_EVENT_FEED, null);
    if (!f || !Array.isArray(f.items)) return null;
    return f;
  },

  // ---- 快照 ----
  async getSnapshots(): Promise<LocalSnapshot[]> {
    return readJSON<LocalSnapshot[]>(K_SNAPSHOTS, []);
  },
  async addSnapshot(snap: LocalSnapshot): Promise<void> {
    const all = await this.getSnapshots();
    if (snap.source === 'steam') {
      const kept = all.filter((s) => !(s.name === snap.name && s.source === 'steam'));
      kept.push(snap);
      const mine = kept.filter((s) => s.name === snap.name && s.source === 'steam');
      mine.sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
      const extra = mine.slice(0, Math.max(0, mine.length - STEAM_KEEP));
      const extraKeys = new Set(extra.map((s) => `${s.name}|${s.source}|${s.fetchedAt}|${s.price}`));
      const pruned = kept.filter((s) => !(s.source === 'steam' && s.name === snap.name && extraKeys.has(`${s.name}|${s.source}|${s.fetchedAt}|${s.price}`)));
      await writeJSON(K_SNAPSHOTS, pruned);
    } else {
      const kept = all.filter((s) => !(s.name === snap.name && s.source === 'c5'));
      kept.push(snap);
      await writeJSON(K_SNAPSHOTS, kept);
    }
  },
  /**
   * 合并 Steam 官方历史日线入快照库（按日期去重；超 50 条截断最旧的）。
   * 历史点 fetchedAt 用「日期 T08:00:00Z」，与当天实时快照（真实时间戳）可区分且排序稳定。
   * 返回实际新增的点数。导出后预测器 / 雷达 / 详情趋势图自动受益。
   */
  async mergeSteamHistory(name: string, points: Array<{ date: string; price: number; volume: number | null }>): Promise<number> {
    if (points.length === 0) return 0;
    const all = await this.getSnapshots();
    const existing = new Set(
      all.filter((s) => s.source === 'steam' && s.name === name).map((s) => s.fetchedAt.slice(0, 10)),
    );
    let added = 0;
    for (const pt of points) {
      if (existing.has(pt.date)) continue;
      all.push({ name, source: 'steam', price: pt.price, volume: pt.volume, fetchedAt: `${pt.date}T08:00:00.000Z` });
      existing.add(pt.date);
      added++;
    }
    if (added === 0) return 0;
    const mine = all
      .filter((s) => s.source === 'steam' && s.name === name)
      .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    const keep = new Set(mine.slice(-HISTORY_KEEP).map((s) => s.fetchedAt));
    const pruned = all.filter((s) => !(s.source === 'steam' && s.name === name) || keep.has(s.fetchedAt));
    await writeJSON(K_SNAPSHOTS, pruned);
    return added;
  },

  /** 合并 C5 官方历史日线（source='c5_hist'，按日期去重、超 50 条截断最旧）。返回新增点数。 */
  async mergeC5History(name: string, points: Array<{ date: string; price: number }>): Promise<number> {
    if (points.length === 0) return 0;
    const all = await this.getSnapshots();
    const existing = new Set(
      all.filter((s) => s.source === 'c5_hist' && s.name === name).map((s) => s.fetchedAt.slice(0, 10)),
    );
    let added = 0;
    for (const pt of points) {
      if (existing.has(pt.date)) continue;
      all.push({ name, source: 'c5_hist', price: pt.price, volume: null, fetchedAt: `${pt.date}T08:00:00.000Z` });
      existing.add(pt.date);
      added++;
    }
    if (added === 0) return 0;
    const mine = all
      .filter((s) => s.source === 'c5_hist' && s.name === name)
      .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    const keep = new Set(mine.slice(-HISTORY_KEEP).map((s) => s.fetchedAt));
    const pruned = all.filter((s) => !(s.source === 'c5_hist' && s.name === name) || keep.has(s.fetchedAt));
    await writeJSON(K_SNAPSHOTS, pruned);
    return added;
  },

  /** 读取 C5 历史日线（最近 limit 条，按日期升序） */
  async getC5History(name: string, limit = 14): Promise<LocalSnapshot[]> {
    const all = await this.getSnapshots();
    const mine = all
      .filter((s) => s.source === 'c5_hist' && s.name === name && s.price > 0)
      .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    return mine.slice(-limit);
  },

  async getSteamPrices(name: string): Promise<number[]> {
    const all = await this.getSnapshots();
    return all
      .filter((s) => s.name === name && s.source === 'steam' && s.price > 0)
      .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt))
      .map((s) => s.price);
  },
  async getSteamHistory(name: string, limit = 14): Promise<LocalSnapshot[]> {
    const all = await this.getSnapshots();
    const mine = all
      .filter((s) => s.name === name && s.source === 'steam' && s.price > 0)
      .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    return mine.slice(-limit);
  },
  async getLatestSteam(name: string): Promise<LocalSnapshot | null> {
    const all = await this.getSnapshots();
    const mine = all.filter((s) => s.name === name && s.source === 'steam');
    mine.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
    return mine[0] ?? null;
  },
  async getLatestC5(name: string): Promise<LocalSnapshot | null> {
    const all = await this.getSnapshots();
    const mine = all.filter((s) => s.name === name && s.source === 'c5');
    mine.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
    return mine[0] ?? null;
  },
  async setC5Price(name: string, price: number): Promise<void> {
    await this.addSnapshot({ name, source: 'c5', price, volume: null, fetchedAt: new Date().toISOString() });
    await this.addC5Intraday(name, price);
  },

  /** C5 日内点（真实时间戳）并入 c5_hist：多次扫描/刷新后「较昨日」即为真实 24h 变化 */
  async addC5Intraday(name: string, price: number): Promise<void> {
    if (!Number.isFinite(price) || price <= 0) return;
    const all = await this.getSnapshots();
    all.push({ name, source: 'c5_hist', price, volume: null, fetchedAt: new Date().toISOString() });
    const mine = all
      .filter((s) => s.source === 'c5_hist' && s.name === name)
      .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    const keep = new Set(mine.slice(-HISTORY_KEEP).map((s) => s.fetchedAt));
    const pruned = all.filter((s) => !(s.source === 'c5_hist' && s.name === name) || keep.has(s.fetchedAt));
    await writeJSON(K_SNAPSHOTS, pruned);
  },

  // ---- 库存 ----
  async getInventory(): Promise<LocalInventoryItem[]> {
    return readJSON<LocalInventoryItem[]>(K_INVENTORY, []);
  },
  async addInventory(item: Omit<LocalInventoryItem, 'id'>): Promise<LocalInventoryItem> {
    const all = await this.getInventory();
    const nextId = all.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    const entry: LocalInventoryItem = { ...item, id: nextId };
    all.push(entry);
    await writeJSON(K_INVENTORY, all);
    return entry;
  },

  /** 批量导入库存（一次读一次写；Steam 库存同步自动导入用） */
  async addInventoryBulk(items: Array<Omit<LocalInventoryItem, 'id'>>): Promise<LocalInventoryItem[]> {
    if (items.length === 0) return [];
    const all = await this.getInventory();
    let nextId = all.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    const entries = items.map((it) => ({ ...it, id: nextId++ }));
    all.push(...entries);
    await writeJSON(K_INVENTORY, all);
    return entries;
  },

  /**
   * 批量更新本地库存的 Steam 冷却字段（一次 Steam 库存同步写一次盘）。
   * patch 里的字段全部覆盖；未出现在 updates 里的条目保持不变。
   */
  async updateInventoryCooldown(
    updates: Array<{
      id: number;
      patch: Pick<LocalInventoryItem, 'steam_synced_at' | 'steam_tradable' | 'steam_unlock_est_at' | 'steam_first_seen_at'>;
    }>,
  ): Promise<void> {
    if (updates.length === 0) return;
    const all = await this.getInventory();
    const patchMap = new Map(updates.map((u) => [u.id, u.patch]));
    let changed = false;
    const next = all.map((x) => {
      const p = patchMap.get(x.id);
      if (!p) return x;
      changed = true;
      return { ...x, ...p };
    });
    if (changed) await writeJSON(K_INVENTORY, next);
  },

  // ---- 订单 ----
  async getOrders(): Promise<LocalOrder[]> {
    return readJSON<LocalOrder[]>(K_ORDERS, []);
  },
  async addOrder(order: Omit<LocalOrder, 'id'>): Promise<LocalOrder> {
    const all = await this.getOrders();
    const nextId = all.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    const entry: LocalOrder = { ...order, id: nextId };
    all.push(entry);
    await writeJSON(K_ORDERS, all);
    return entry;
  },

  /** 按板块清除业务数据（设置/凭证始终保留）。不传参 = 全部清除 */
  async clearAllData(parts?: { snapshots?: boolean; inventory?: boolean; orders?: boolean }): Promise<void> {
    const p = parts ?? { snapshots: true, inventory: true, orders: true };
    const keys: string[] = [];
    if (p.snapshots) keys.push(K_SNAPSHOTS);
    if (p.inventory) keys.push(K_INVENTORY);
    if (p.orders) keys.push(K_ORDERS);
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  },
};
