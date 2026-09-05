/**
 * engine：本地分析引擎（组合层）。
 * 完全在手机内完成：快照 → 预测 → 收益 → 雷达 → 模拟 → 库存估值。
 * 与后端 routes 的产出结构保持一致，UI 无需关心数据来自本地还是后端。
 */
import { storage, LocalInventoryItem, LOCK_HOURS, LOCK_DAYS } from '../data/storage';
import { collectCases, collectOne, CollectProgress, CollectStats } from '../data/collector';
import { ProfitCalculator } from './profit';
import { BaselinePredictor } from './prediction';
import { evaluateRadar } from './radar';
import { simulate as runSimulation, reverseTarget, SimItemInput, SIM_CONFIG } from './simulation';
import { DEFAULT_FEES } from './fees';
import type {
  Quote, RadarItem, Prediction, Scenario, InventoryEntry, Simulation,
} from './types';

const predictor = new BaselinePredictor();
const calc = new ProfitCalculator(DEFAULT_FEES.c5_buy_fee_ratio, DEFAULT_FEES.steam_seller_receive_ratio);

export interface AppStatus {
  status: string;
  app: string;
  local: boolean;
  snapshotCount: number;
  itemCount: number;
  c5Configured: boolean;
  lastUpdated: string | null;
}

function toRadarItem(name: string, c5Price: number | null, steamPrice: number, steamVolume: number, pred: Prediction): RadarItem {
  const breakeven = c5Price != null ? calc.breakevenSellPrice(c5Price) : null;
  const rr = evaluateRadar({
    market_hash_name: name,
    c5_buy_price: c5Price,
    steam_sell_price: steamPrice,
    steam_volume: steamVolume,
    predicted_p50: pred.p50,
    predicted_p25: pred.p25,
    breakeven_price: breakeven,
    volatility: typeof pred.features?.volatility === 'number' ? pred.features.volatility : 0.05,
    prob_profit: pred.prob_profit,
  });
  return {
    market_hash_name: name,
    c5_buy_price: c5Price,
    steam_sell_price: steamPrice,
    expected_roi: rr.expected_roi,
    risk_level: rr.risk_level,
    liquidity: rr.liquidity,
    signal: rr.signal,
    score: rr.score,
    details: { ...rr.details, confidence: pred.confidence },
  };
}

function buildPrediction(name: string, c5Price: number | null, prices: number[]): Prediction {
  const breakeven = c5Price != null ? calc.breakevenSellPrice(c5Price) : undefined;
  const pred = predictor.predict({
    marketHashName: name,
    prices,
    breakevenPrice: breakeven,
  });
  const scenarios: Scenario[] = [];
  if (c5Price != null) {
    const sc = calc.scenarios(c5Price, {
      pessimistic: pred.p25,
      base: pred.p50,
      optimistic: pred.p75,
    });
    for (const [k, v] of Object.entries(sc)) {
      scenarios.push({ label: k, predicted_sell_price: v.predicted_sell_price, net_profit: v.net_profit, roi: v.roi });
    }
  }
  return {
    item_id: pred.item_id ?? 0,
    market_hash_name: name,
    model_version: pred.model_version,
    target_at: pred.target_at,
    p10: pred.p10,
    p25: pred.p25,
    p50: pred.p50,
    p75: pred.p75,
    p90: pred.p90,
    prob_profit: pred.prob_profit,
    prob_loss: pred.prob_loss,
    confidence: pred.confidence,
    features: pred.features,
    scenarios,
  };
}

export const engine = {
  // ---- 状态 ----
  async status(): Promise<AppStatus> {
    const snaps = await storage.getSnapshots();
    const names = new Set(snaps.map((s) => s.name));
    const settings = await storage.getSettings();
    const latest = snaps.map((s) => s.fetchedAt).sort().reverse()[0] ?? null;
    return {
      status: 'ok',
      app: 'CS2余额助手（纯手机版）',
      local: true,
      snapshotCount: snaps.length,
      itemCount: names.size,
      c5Configured: !!settings.c5AppKey.trim(),
      lastUpdated: latest,
    };
  },

  // ---- 采集 ----
  refresh: collectCases,
  collectOne,

  // ---- 雷达 ----
  async radar(): Promise<RadarItem[]> {
    const snaps = await storage.getSnapshots();
    const names = [...new Set(snaps.map((s) => s.name))];
    const out: RadarItem[] = [];
    for (const name of names) {
      const steam = await storage.getLatestSteam(name);
      if (!steam || steam.price == null) continue;
      const c5 = await storage.getLatestC5(name);
      const c5Price = c5?.price ?? null;
      const prices = await storage.getSteamPrices(name);
      let usePrices: number[];
      if (prices.length >= 2) {
        usePrices = prices;
      } else if (c5Price != null) {
        usePrices = [c5Price, steam.price];
      } else {
        usePrices = [steam.price, steam.price];
      }
      try {
        const pred = buildPrediction(name, c5Price, usePrices);
        out.push(toRadarItem(name, c5Price, steam.price, steam.volume ?? 0, pred));
      } catch {
        continue;
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  },

  // ---- 报价 ----
  async quote(name: string): Promise<Quote> {
    const steam = await storage.getLatestSteam(name);
    const c5 = await storage.getLatestC5(name);
    const steamPrice = steam?.price ?? null;
    const c5Price = c5?.price ?? null;
    const result = c5Price != null && steamPrice != null ? calc.calculate(c5Price, steamPrice) : null;
    let signal = 'waiting';
    if (result != null) {
      signal = result.roi >= 0.05 ? 'buy' : result.roi >= 0 ? 'wait' : 'avoid';
    }
    return {
      market_hash_name: name,
      c5_buy_price: c5Price,
      steam_sell_price: steamPrice,
      steam_volume: steam?.volume ?? null,
      c5_fee_ratio: DEFAULT_FEES.c5_buy_fee_ratio,
      steam_seller_receive_ratio: DEFAULT_FEES.steam_seller_receive_ratio,
      lock_days: LOCK_DAYS,
      steam_net_receive: result?.steam_net_receive ?? null,
      net_profit: result?.net_profit ?? null,
      roi: result?.roi ?? null,
      breakeven_sell_price: result?.breakeven_sell_price ?? null,
      signal,
    };
  },

  // ---- 预测 ----
  async prediction(name: string): Promise<Prediction> {
    const steam = await storage.getLatestSteam(name);
    if (!steam || steam.price == null) throw new Error('暂无该商品的价格快照，请先刷新采集');
    const c5 = await storage.getLatestC5(name);
    const c5Price = c5?.price ?? null;
    const prices = await storage.getSteamPrices(name);
    const usePrices = prices.length >= 2 ? prices : c5Price != null ? [c5Price, steam.price] : [steam.price, steam.price];
    return buildPrediction(name, c5Price, usePrices);
  },

  // ---- 库存 ----
  async inventory(): Promise<InventoryEntry[]> {
    const rows = await storage.getInventory();
    const out: InventoryEntry[] = [];
    for (const r of rows) {
      const steam = await storage.getLatestSteam(r.item_name);
      const current = steam?.price ?? null;
      let netReceive: number | null = null;
      let netProfit: number | null = null;
      let roi: number | null = null;
      if (current != null) {
        netReceive = current * DEFAULT_FEES.steam_seller_receive_ratio;
        const cost = r.buy_price * (1 + DEFAULT_FEES.c5_buy_fee_ratio);
        netProfit = netReceive - cost;
        roi = cost ? netProfit / cost : null;
      }
      const unlock = new Date(new Date(r.buy_at).getTime() + LOCK_HOURS * 3600000);
      const daysLeft = Math.max(0, (unlock.getTime() - Date.now()) / 86400000);
      out.push({
        id: r.id,
        item_name: r.item_name,
        quantity: r.quantity,
        buy_price: r.buy_price,
        buy_at: r.buy_at,
        source: r.source,
        unlock_at: unlock.toISOString(),
        days_left: daysLeft,
        current_estimate: current,
        net_receive_estimate: netReceive,
        net_profit_estimate: netProfit,
        roi_estimate: roi,
      });
    }
    out.sort((a, b) => a.unlock_at.localeCompare(b.unlock_at));
    return out;
  },

  async addInventory(params: { item_name: string; quantity: number; buy_price: number }): Promise<{ id: number; unlock_at: string; days: number }> {
    const entry = await storage.addInventory({
      item_name: params.item_name,
      quantity: params.quantity,
      buy_price: params.buy_price,
      buy_at: new Date().toISOString(),
      source: 'c5game',
    });
    const unlock = new Date(new Date(entry.buy_at).getTime() + LOCK_HOURS * 3600000);
    return { id: entry.id, unlock_at: unlock.toISOString(), days: LOCK_DAYS };
  },

  // ---- 模拟 ----
  async simulate(budget: number, allocation = 'balanced'): Promise<Simulation> {
    const radar = await this.radar();
    const simItems: SimItemInput[] = [];
    for (const r of radar.slice(0, 20)) {
      const vol = r.liquidity === 'high' ? 5000 : r.liquidity === 'medium' ? 1200 : 300;
      const risk = (['low', 'medium', 'high'] as const).includes(r.risk_level as never) ? (r.risk_level as 'low' | 'medium' | 'high') : 'medium';
      const liquid = (['low', 'medium', 'high'] as const).includes(r.liquidity as never) ? (r.liquidity as 'low' | 'medium' | 'high') : 'medium';
      simItems.push({
        name: r.market_hash_name,
        c5_price: r.c5_buy_price ?? 0,
        predicted_p50: typeof r.details.predicted_p50 === 'number' ? r.details.predicted_p50 : r.steam_sell_price ?? 0,
        predicted_p25: typeof r.details.predicted_p25 === 'number' ? r.details.predicted_p25 : 0,
        prob_loss: Math.max(0, 1 - (typeof r.details.prob_profit === 'number' ? r.details.prob_profit : 0.5)),
        volume: vol,
        risk,
        liquidity: liquid,
      });
    }
    const result = runSimulation(budget, simItems, allocation);
    if (!result) throw new Error('预算不足或候选不足，请先刷新采集 / 录入 C5 买入价');
    return {
      budget,
      allocation: result.allocation,
      items: result.items,
      total_buy_cost: result.total_buy_cost,
      expected_steam_receive: result.expected_steam_receive,
      expected_net_profit: result.expected_net_profit,
      expected_roi: result.expected_roi,
      weighted_loss_prob: result.weighted_loss_prob,
    };
  },

  simulateReverse(target: number, roi = 0.03) {
    const r = reverseTarget(target, roi);
    return { target_balance: r.target_balance, required_budget: r.required_budget, expected_profit: r.expected_profit };
  },
};

export function getSimConfig() {
  return SIM_CONFIG;
}

