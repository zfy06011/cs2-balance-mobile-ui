/**
 * API 客户端（本地版重构）。
 * 对外接口与旧版保持一致（screens 无需大改），内部全部由本地引擎完成：
 * 直连 Steam/C5GAME + 手机内计算，不再依赖电脑后端。
 */
import { engine } from '../core/engine';
import { storage } from '../data/storage';
import type { CollectProgress, CollectStats } from '../data/collector';
export type { Quote, RadarItem, Scenario, Prediction, InventoryEntry, Simulation, SimulationItem } from '../core/types';
import type { Quote, RadarItem, Prediction, InventoryEntry, Simulation } from '../core/types';

// 为兼容旧签名保留（本地模式无后端地址概念）
export const STORAGE_KEY = '@cs2balance/api_base';

export async function getApiBase(): Promise<string> {
  return 'local://engine';
}

export async function setApiBase(_base: string): Promise<void> {
  // 本地模式：忽略后端地址配置
  return;
}

export interface HealthResult {
  status: string;
  app: string;
  local: boolean;
  snapshotCount: number;
  itemCount: number;
  c5Configured: boolean;
  lastUpdated: string | null;
}

export const api = {
  health: () => engine.status() as Promise<HealthResult>,
  radar: () => engine.radar() as Promise<RadarItem[]>,
  quote: (name: string) => engine.quote(name) as Promise<Quote>,
  prediction: (name: string) => engine.prediction(name) as Promise<Prediction>,
  inventory: () => engine.inventory() as Promise<InventoryEntry[]>,
  addInventory: (params: { item_name: string; quantity: number; buy_price: number }) =>
    engine.addInventory(params),
  simulate: (budget: number, allocation: string) => engine.simulate(budget, allocation),
  simulateReverse: (target: number, roi = 0.03) => engine.simulateReverse(target, roi),

  // ---- 本地模式新增 ----
  refresh: (opts: { count: number; onProgress?: (p: CollectProgress) => void }): Promise<CollectStats> =>
    engine.refresh({ count: opts.count, onProgress: opts.onProgress }),
  collectOne: (name: string) => engine.collectOne(name),
  setC5Price: (name: string, price: number) => storage.setC5Price(name, price),
  getSettings: () => storage.getSettings(),
  updateSettings: (patch: Parameters<typeof storage.updateSettings>[0]) => storage.updateSettings(patch),
  clearAllData: () => storage.clearAllData(),
};
