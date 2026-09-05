/**
 * storage：本地存储（AsyncStorage）。
 * - 快照：每个商品保留最近 N 条 Steam 价格 + 最新 C5 价格，用于预测与雷达
 * - 库存：手动录入的购买记录
 * - 设置：C5 app-key、采集数量、Steam cookie（可选）
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LocalSnapshot {
  name: string;
  source: 'steam' | 'c5';
  price: number;
  volume: number | null;
  fetchedAt: string;
}

export interface LocalInventoryItem {
  id: number;
  item_name: string;
  quantity: number;
  buy_price: number;
  buy_at: string;
  source: string;
}

export interface AppSettings {
  c5AppKey: string;
  refreshCount: number;
  steamCookie: string;
}

const K_SNAPSHOTS = '@cs2balance/snapshots_v2';
const K_INVENTORY = '@cs2balance/inventory_v2';
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

const DEFAULT_SETTINGS: AppSettings = { c5AppKey: '', refreshCount: 20, steamCookie: '' };

export const storage = {
  // ---- 设置 ----
  async getSettings(): Promise<AppSettings> {
    const s = await readJSON<Partial<AppSettings>>(K_SETTINGS, {});
    return { ...DEFAULT_SETTINGS, ...s };
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

  async clearAllData(): Promise<void> {
    await AsyncStorage.multiRemove([K_SNAPSHOTS, K_INVENTORY, K_SETTINGS]);
  },
};
