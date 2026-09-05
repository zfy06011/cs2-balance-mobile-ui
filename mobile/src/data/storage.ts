/**
 * storage：本地存储（AsyncStorage）。
 * - 快照：每个商品保留最近 N 条 Steam 价格 + 最新 C5 价格，用于预测与雷达
 * - 库存：手动录入 / 一键买入成功的购买记录
 * - 订单：一键买入的独立订单流水
 * - 设置：C5 app-key、采集数量、Steam cookie（可选）、购买保护参数
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LocalSnapshot {
  name: string;
  source: 'steam' | 'c5';
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
const STEAM_KEEP = 50;
export const LOCK_HOURS = 168;
export const LOCK_DAYS = 7;

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
    return next;
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

  async clearAllData(): Promise<void> {
    await AsyncStorage.multiRemove([K_SNAPSHOTS, K_INVENTORY, K_ORDERS, K_SETTINGS]);
  },
};
