/**
 * API 客户端（本地版重构）。
 * 对外接口与旧版保持一致（screens 无需大改），内部全部由本地引擎完成：
 * 直连 Steam/C5GAME + 手机内计算，不再依赖电脑后端。
 */
import { engine, BuyPrepareResult, BuyExecuteResult } from '../core/engine';
import { storage } from '../data/storage';
import { fetchC5StatsBulk, C5StatsResult } from '../data/c5';
import type { CollectProgress, CollectStats } from '../data/collector';
import type { C5BuyAdvice } from '../core/advice';
export type { Quote, RadarItem, Scenario, Prediction, InventoryEntry, Simulation, SimulationItem, OrderRecord, HistoryPoint } from '../core/types';
export type { BuyPrepareResult, BuyExecuteResult } from '../core/engine';
export type { C5StatsResult } from '../data/c5';
export type { C5BuyAdvice } from '../core/advice';
export type { SkinportStats } from '../data/skinport';
import type { Quote, RadarItem, Prediction, InventoryEntry, Simulation, OrderRecord, HistoryPoint } from '../core/types';

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
  markets: () => engine.markets() as Promise<Quote[]>,
  quote: (name: string) => engine.quote(name) as Promise<Quote>,
  prediction: (name: string) => engine.prediction(name) as Promise<Prediction>,
  history: (name: string, limit = 7) => engine.history(name, limit) as Promise<HistoryPoint[]>,
  inventory: () => engine.inventory() as Promise<InventoryEntry[]>,
  addInventory: (params: { item_name: string; quantity: number; buy_price: number }) =>
    engine.addInventory(params),
  /** C5 买入时机参考（近几天统计 + 较昨日变化 + 分位 + 趋势） */
  c5BuyAdvice: (name: string) => engine.c5BuyAdvice(name),
  /** Skinport 实际成交统计（免 Key 免登录） */
  skinportStats: (name: string) => engine.skinportStats(name),
  /** 库存同步唯一入口：Web API + 双 Context（context 2 + context 16 交易保护） */
  syncSteamInventorySmart: () => engine.syncSteamInventorySmart(),
  /** 用已登录的 Steam 会话同步（自动识别本人 SteamID64 并存回设置） */

  /** 会话导入历史的目标清单（价格点不足的名字优先） */
  historyTargets: (limit = 60) => engine.listHistoryTargets(limit),
  /** WebView 会话内抓到的 pricehistory.prices 解析入库 */
  importSteamPriceHistoryRaw: (name: string, prices: unknown) => engine.importSteamPriceHistoryRaw(name, prices),
  /** C5 历史导入目标清单（Steam / C5 历史点不足的名字优先） */
  c5HistoryTargets: (limit = 60) => engine.c5HistoryTargets(limit),
  /** 云端历史导入目标清单（与 C5 共用：Steam / C5 历史点不足优先） */
  cloudHistoryTargets: (limit = 60) => engine.c5HistoryTargets(limit),
  /** 云端快速导入：从 Cloudflare Worker 拉 Steam 官方全量历史（零 cookie）入库；失败即停返回失败项 */
  importCloudHistories: (
    names: string[],
    workerBaseUrl: string,
    onItem?: (done: number, total: number, name: string, added: number) => void,
    startIdx = 0,
  ) => engine.importCloudHistories(names, workerBaseUrl, onItem, startIdx),
  /** C5 快速导入：逐件拉 C5 官方趋势入库（需 C5 Cookie，可选 app-key 查 itemId）；失败即停返回失败项 */
  importC5Histories: (
    names: string[],
    opts: { c5AppKey: string; c5Cookie: string },
    onItem?: (done: number, total: number, name: string, added: number) => void,
    startIdx = 0,
  ) => engine.importC5Histories(names, opts, onItem, startIdx),
  orders: () => engine.orders() as Promise<OrderRecord[]>,
  prepareBuy: (params: { name: string; qty?: number }) => engine.prepareBuy(params) as Promise<BuyPrepareResult>,
  executeBuy: (params: { name: string; qty?: number }) => engine.executeBuy(params) as Promise<BuyExecuteResult>,
  simulate: (budget: number, allocation: string) => engine.simulate(budget, allocation),
  simulateReverse: (target: number, roi = 0.03) => engine.simulateReverse(target, roi),

  // ---- 本地模式新增 ----
  refresh: (opts: { count: number; onProgress?: (p: CollectProgress) => void }): Promise<CollectStats> =>
    engine.refresh({ count: opts.count, onProgress: opts.onProgress }),
  collectOne: (name: string) => engine.collectOne(name),
  setC5Price: (name: string, price: number) => storage.setC5Price(name, price),
  /** C5 求购统计（求购最高价 = 可秒出参考价）；未配 key 或失败返回 null */
  fetchC5Stats: async (name: string): Promise<C5StatsResult | null> => {
    const settings = await storage.getSettings();
    const key = (settings.c5AppKey || '').trim();
    if (!key) return null;
    const map = await fetchC5StatsBulk([name], key);
    return map[name] ?? null;
  },
  getSettings: () => storage.getSettings(),
  updateSettings: (patch: Parameters<typeof storage.updateSettings>[0]) => storage.updateSettings(patch),
  /** 按板块清除业务数据（设置/凭证保留）；不传参 = 全部 */
  clearAllData: (parts?: { snapshots?: boolean; inventory?: boolean; orders?: boolean }) => storage.clearAllData(parts),
};
