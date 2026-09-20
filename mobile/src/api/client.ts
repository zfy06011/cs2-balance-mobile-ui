/**
 * API 客户端（本地版重构）。
 * 对外接口与旧版保持一致（screens 无需大改），内部全部由本地引擎完成：
 * 直连 Steam/C5GAME + 手机内计算，不再依赖电脑后端。
 */
import { engine, BuyPrepareResult, BuyExecuteResult } from '../core/engine';
import { storage } from '../data/storage';
import { fetchC5StatsBulk, C5StatsResult } from '../data/c5';
import { clearDetailCache } from '../core/detailCache';
import { bumpAnalysisGeneration } from '../core/analysisCache';
import { getAnalysisCache } from '../core/analysisCache';
import { getProductionOpportunitySnapshot } from '../data/opportunitySnapshot';
import type { OpportunityMode } from '../config/featureFlags';
export type { ProductionOpportunityItem, ProductionOpportunitySnapshot } from '../data/opportunityProduction';
export type { Quote, RadarItem, Scenario, Prediction, InventoryEntry, HoldingsSummary, Simulation, SimulationItem, OrderRecord, HistoryPoint } from '../core/types';
export type { BuyPrepareResult, BuyExecuteResult } from '../core/engine';
export type { C5StatsResult } from '../data/c5';
export type { C5BuyAdvice } from '../core/advice';
export type { SkinportStats } from '../data/skinport';
import type { Quote, RadarItem, Prediction, InventoryEntry, Simulation, OrderRecord, HistoryPoint } from '../core/types';

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
  /** 同步读取已缓存的分析结果（切页预热用；未命中返回 null，不触发计算） */
  peekMarkets: () => getAnalysisCache<Quote[]>('markets'),
  peekRadar: () => getAnalysisCache<RadarItem[]>('radar'),
  peekInventory: () => getAnalysisCache<InventoryEntry[]>('inventory'),
  quote: (name: string) => engine.quote(name) as Promise<Quote>,
  prediction: (name: string) => engine.prediction(name) as Promise<Prediction>,
  /** 详情页一次取齐（一次输入采集 + 一次预测，避免 quote/prediction 重复计算） */
  detail: (name: string) => engine.detail(name),
  history: (name: string, limit = 7) => engine.history(name, limit) as Promise<HistoryPoint[]>,
  inventory: () => engine.inventory() as Promise<InventoryEntry[]>,
  /** 某个箱子的持仓汇总（详情页「我的持仓」；无持仓返回 null） */
  holdingsOf: (name: string) => engine.holdingsOf(name),
  addInventory: (params: { item_name: string; quantity: number; buy_price: number }) =>
    engine.addInventory(params),
  /** C5 买入时机参考（近几天统计 + 较昨日变化 + 分位 + 趋势） */
  c5BuyAdvice: (name: string) => engine.c5BuyAdvice(name),
  /** Skinport 实际成交统计（免 Key 免登录） */
  skinportStats: (name: string) => engine.skinportStats(name),
  /** 库存同步唯一入口：C5 OpenAPI（app-key） */
  syncSteamInventorySmart: () => engine.syncSteamInventorySmart(),
  orders: () => engine.orders() as Promise<OrderRecord[]>,
  prepareBuy: (params: { name: string; qty?: number }) => engine.prepareBuy(params) as Promise<BuyPrepareResult>,
  executeBuy: (params: { name: string; qty?: number }) => engine.executeBuy(params) as Promise<BuyExecuteResult>,
  simulate: (budget: number, allocation: string) => engine.simulate(budget, allocation),
  simulateReverse: (target: number, roi = 0.03) => engine.simulateReverse(target, roi),
  /** UI 唯一 Opportunity 数据入口：页面不直接组合 Radar/Provider/v2 结果。 */
  productionOpportunity: (options?: { force?: boolean; mode?: OpportunityMode; candidateNames?: string[] }) =>
    getProductionOpportunitySnapshot(options),

  // ---- 本地模式新增 ----
  collectOne: (name: string) => engine.collectOne(name),
  setC5Price: async (name: string, price: number) => {
    await storage.setC5Price(name, price);
    clearDetailCache(name);
    bumpAnalysisGeneration();
  },
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
