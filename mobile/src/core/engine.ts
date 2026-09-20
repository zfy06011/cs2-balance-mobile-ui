/**
 * engine：本地分析引擎（组合层）。
 * 完全在手机内完成：快照 → 预测 → 收益 → 雷达 → 模拟 → 库存估值 → 购买核验。
 * 与后端 routes 的产出结构保持一致，UI 无需关心数据来自本地还是后端。
 */
import {
  storage, LocalSnapshot, LOCK_HOURS, LOCK_DAYS, HISTORY_KEEP,
} from '../data/storage';
import { collectOne, CollectStats } from '../data/collector';
import { resolveOwnSteamId, normalizeSteamId } from '../data/steam';
import { fetchSkinportHistory, SkinportStats } from '../data/skinport';
import { fetchC5StatsBulk, fetchC5Inventory } from '../data/c5';
import { fetchSteamHistorySsr } from '../data/steamHistorySsr';
import { getDetailCache, setDetailCache, clearDetailCache } from './detailCache';
import { getAnalysisCache, setAnalysisCache, bumpAnalysisGeneration } from './analysisCache';

let skinportCache: Map<string, { t: number; v: SkinportStats | null }> | null = null;
/** Skinport 缓存容量上限（v1.8.5）：满了丢最早写入的，避免长期使用后无界增长 */
const SKINPORT_CACHE_MAX = 300;
import { ProfitCalculator } from './profit';
import { BaselinePredictor, BaselinePredictorV4, MARKET_EVENTS, type MarketEvent } from './prediction';
import { evaluateRadar } from './radar';
import { simulate as runSimulation, reverseTarget, SimItemInput, SIM_CONFIG } from './simulation';
import { checkPurchase, BuyProtection, BuyCheckResult, buildBuySummary } from './buy';
import { planSteamSync, buildC5EmptySyncReason } from './steamSync';
import { buildSellAdvice, buildC5BuyAdvice, AdvicePoint } from './advice';
import { summarizeHoldings } from './holdings';
import { DEFAULT_FEES } from './fees';
import type {
  Quote, RadarItem, Prediction, Scenario, InventoryEntry, HoldingsSummary, Simulation, OrderRecord, HistoryPoint,
} from './types';

const predictor = new BaselinePredictorV4();
const calc = new ProfitCalculator(DEFAULT_FEES.c5_buy_fee_ratio, DEFAULT_FEES.steam_seller_receive_ratio);

/**
 * 单箱历史补拉（详情页专用）：本地点不足时直连 Steam SSR 并落库。
 * 只允许单箱调用——绝不可放进批量串行循环（v1.6.2 教训）。
 * Steam 市场页可直连并提供官方日线。
 * 带超时 + 每箱 10 分钟节流，失败静默降级。
 */
const backfillAt = new Map<string, number>();
const BACKFILL_THROTTLE_MS = 10 * 60 * 1000;
/** 节流表容量上限（v1.8.5）：只用于「该箱最近一次补拉时间」，满了丢最旧的即可 */
const BACKFILL_MAX = 500;

async function backfillHistoryIfThin(name: string, minPoints = 15): Promise<void> {
  try {
    const existing = await storage.getSteamHistory(name, minPoints);
    if (existing.length >= minPoints) return;
    const last = backfillAt.get(name) ?? 0;
    if (Date.now() - last < BACKFILL_THROTTLE_MS) return;
    backfillAt.set(name, Date.now());
    while (backfillAt.size > BACKFILL_MAX) {
      const oldest = backfillAt.keys().next().value as string | undefined;
      if (oldest == null) break;
      backfillAt.delete(oldest);
    }

    try {
      const ssrPts = await fetchSteamHistorySsr(name, 365);
      if (ssrPts.length > 0) {
        await storage.mergeSteamHistory(name, ssrPts);
        clearDetailCache(name);
        return;
      }
    } catch {}
  } catch {
    return;
  }
}

export interface AppStatus {
  status: string;
  app: string;
  local: boolean;
  snapshotCount: number;
  itemCount: number;
  c5Configured: boolean;
  lastUpdated: string | null;
}

export interface BuyPrepareResult extends BuyCheckResult {
  name: string;
  displayName: string;
  qty: number;
  lockDays: number;
}

export interface BuyExecuteResult {
  ok: boolean;
  message: string;
  order?: OrderRecord;
  unlockAt?: string;
}

function toRadarItem(name: string, c5Price: number | null, steamPrice: number, steamVolume: number, pred: Prediction): RadarItem {
  const breakeven = c5Price != null ? calc.breakevenSellPrice(c5Price) : null;
  // 事件价差修正：P50/P25 先还原为未修正值（雷达内部乘回 (1+event_adjust)，避免双重修正）
  const eventAdjust = typeof pred.features?.event_adjust === 'number' ? pred.features.event_adjust : 0;
  const eventFactor = 1 + eventAdjust;
  const rr = evaluateRadar({
    market_hash_name: name,
    c5_buy_price: c5Price,
    steam_sell_price: steamPrice,
    steam_volume: steamVolume,
    predicted_p50: eventAdjust !== 0 ? pred.p50 / eventFactor : pred.p50,
    predicted_p25: eventAdjust !== 0 ? pred.p25 / eventFactor : pred.p25,
    breakeven_price: breakeven,
    volatility: typeof pred.features?.volatility === 'number' ? pred.features.volatility : 0.05,
    prob_profit: pred.prob_profit,
    popular_rank: typeof pred.features?.popular_rank === 'number' ? pred.features.popular_rank : null,
    data_insufficient: pred.features?.data_insufficient === true,
    event_adjust: eventAdjust,
    cv: typeof pred.features?.cv === 'number' ? pred.features.cv : null,
    r2: typeof pred.features?.r2 === 'number' ? pred.features.r2 : null,
    pct_365: typeof pred.features?.pct_365 === 'number' ? pred.features.pct_365 : null,
    market_state: typeof pred.features?.market_state === 'string' ? pred.features.market_state as 'STABLE' | 'RISING' | 'FALLING' | 'CHAOS' : null,
  });
  // 预计几折：以 7 天预测 P50 作为卖出价估算（总成本 / 预测净到手）
  let discount: number | null = null;
  const p50 = typeof rr.details.predicted_p50 === 'number' ? rr.details.predicted_p50 : null;
  if (c5Price != null && p50 != null && p50 > 0) {
    discount = calc.expectedDiscount(c5Price, p50 * DEFAULT_FEES.steam_seller_receive_ratio);
  }
  return {
    market_hash_name: name,
    c5_buy_price: c5Price,
    steam_sell_price: steamPrice,
    steam_net_receive: round(calc.steamNetReceive(steamPrice), 4),
    expected_roi: rr.expected_roi,
    expected_discount: discount != null ? round(discount, 6) : null,
    risk_level: rr.risk_level,
    liquidity: rr.liquidity,
    signal: rr.signal,
    score: rr.score,
    details: { ...rr.details, confidence: pred.confidence },
  };
}

interface PredictExtra {
  volume?: number | null;
  volumeHistory?: number[];
  popularRank?: number | null;
  /** 与 prices 等长的时间戳（毫秒），V4 长周期特征用 */
  timestamps?: number[];
  /** 与 prices 等长的成交量（可为 null），V4 波动/量价特征用 */
  volumes?: Array<number | null>;
  /** 市场事件日历（默认注入 Steam 2026 大促） */
  events?: MarketEvent[];
}

interface PredictInputs {
  steam: LocalSnapshot | null;
  c5: LocalSnapshot | null;
  /** 全部本地 Steam 价格点（升序，≤HISTORY_KEEP） */
  prices: number[];
  timestamps: number[];
  volumes: Array<number | null>;
  volumeHistory: number[];
  volume: number | null;
  popularRank: number | null;
}

/** 一次性取齐预测所需输入（Steam 最新价 / C5 价 / 价格历史 / 成交量历史 / 热门排名） */
async function collectPredictInputs(name: string): Promise<PredictInputs> {
  const [steam, c5, series] = await Promise.all([
    storage.getLatestSteam(name),
    storage.getLatestC5(name),
    storage.getSteamHistory(name, HISTORY_KEEP),
  ]);
  const prices: number[] = [];
  const timestamps: number[] = [];
  const volumes: Array<number | null> = [];
  for (const s of series) {
    if (s.price > 0) {
      prices.push(s.price);
      timestamps.push(new Date(s.fetchedAt).getTime());
      volumes.push(s.volume ?? null);
    }
  }
  const volumeHistory = volumes.filter((v): v is number => v != null && v > 0).slice(-60);
  return {
    steam,
    c5,
    prices,
    timestamps,
    volumes,
    volumeHistory,
    volume: steam?.volume ?? null,
    popularRank: steam?.popular_rank ?? null,
  };
}

function buildPrediction(name: string, c5Price: number | null, prices: number[], extra: PredictExtra = {}): Prediction {
  const breakeven = c5Price != null ? calc.breakevenSellPrice(c5Price) : undefined;
  const pred = predictor.predict({
    marketHashName: name,
    prices,
    breakevenPrice: breakeven,
    volume: extra.volume ?? null,
    volumeHistory: extra.volumeHistory,
    popularRank: extra.popularRank ?? null,
    timestamps: extra.timestamps,
    volumes: extra.volumes,
    events: extra.events ?? MARKET_EVENTS,
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

/**
 * 纯本地分析（v1.8.2 切页提速）：取输入 → 报价 → 预测，结果进 detailCache。
 * quote / detail / markets / radar 全部共用它，同一箱只算一次；
 * 从列表点进详情页即命中缓存，瞬间打开。绝不联网（批量路径禁止逐箱联网）。
 */
async function analyzeLocal(name: string): Promise<{ quote: Quote; prediction: Prediction | null }> {
  const cached = getDetailCache<{ quote: Quote; prediction: Prediction | null }>(name);
  if (cached) return cached;
  const inp = await collectPredictInputs(name);
  const quote = buildQuote(name, inp);
  let prediction: Prediction | null = null;
  if (inp.steam && inp.steam.price != null) {
    try {
      const c5Price = inp.c5?.price ?? null;
      prediction = buildPrediction(name, c5Price, inp.prices, {
        volume: inp.volume,
        volumeHistory: inp.volumeHistory,
        popularRank: inp.popularRank,
        timestamps: inp.timestamps,
        volumes: inp.volumes,
      });
    } catch {
      // 预测失败：报价照常返回（图表不画预测扇区）
    }
  }
  const result = { quote, prediction };
  setDetailCache(name, result);
  return result;
}

/**
 * 有界并发遍历（v1.8.2 切页提速）：串行逐箱算太慢，全并发又怕内存峰值。
 * 固定 N 个 worker 抢索引，单箱异常由调用方 try/catch 隔离。
 */
async function runConcurrent<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const n = Math.max(1, Math.min(limit, items.length));
  let idx = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      await task(items[i]);
    }
  };
  await Promise.all(Array.from({ length: n }, () => worker()));
}

function signalOf(roi: number | null): string {
  if (roi == null) return 'waiting';
  if (roi >= 0.05) return 'buy';
  if (roi >= 0) return 'wait';
  return 'avoid';
}

/** 由已采集的预测输入构建报价（quote 与 detail 共用，避免重复读库） */
function buildQuote(name: string, inp: PredictInputs): Quote {
  const steam = inp.steam;
  const steamPrice = steam?.price ?? null;
  const c5Price = inp.c5?.price ?? null;
  const result = c5Price != null && steamPrice != null ? calc.calculate(c5Price, steamPrice) : null;
  const expectedDiscount = result != null && c5Price != null ? calc.expectedDiscount(c5Price, result.steam_net_receive) : null;
  // 信号与雷达页统一口径（综合预测 P50/P25 + 风险 + 流动性），预测失败退回当前价 ROI 信号
  let signal = signalOf(result?.roi ?? null);
  let dataInsufficient = false;
  if (steamPrice != null && inp.prices.length >= 1) {
    try {
      const pred = buildPrediction(name, c5Price, inp.prices, {
        volume: inp.volume,
        volumeHistory: inp.volumeHistory,
        popularRank: inp.popularRank,
        timestamps: inp.timestamps,
        volumes: inp.volumes,
      });
      const breakeven = c5Price != null ? calc.breakevenSellPrice(c5Price) : null;
      const eventAdjust = typeof pred.features?.event_adjust === 'number' ? pred.features.event_adjust : 0;
      const eventFactor = 1 + eventAdjust;
      const rr = evaluateRadar({
        market_hash_name: name,
        c5_buy_price: c5Price,
        steam_sell_price: steamPrice,
        steam_volume: steam?.volume ?? 0,
        predicted_p50: eventAdjust !== 0 ? pred.p50 / eventFactor : pred.p50,
        predicted_p25: eventAdjust !== 0 ? pred.p25 / eventFactor : pred.p25,
        breakeven_price: breakeven,
        volatility: typeof pred.features?.volatility === 'number' ? pred.features.volatility : 0.05,
        prob_profit: pred.prob_profit,
        popular_rank: inp.popularRank,
        data_insufficient: pred.features?.data_insufficient === true,
        event_adjust: eventAdjust,
        cv: typeof pred.features?.cv === 'number' ? pred.features.cv : null,
        r2: typeof pred.features?.r2 === 'number' ? pred.features.r2 : null,
        pct_365: typeof pred.features?.pct_365 === 'number' ? pred.features.pct_365 : null,
        market_state: typeof pred.features?.market_state === 'string' ? pred.features.market_state as 'STABLE' | 'RISING' | 'FALLING' | 'CHAOS' : null,
      });
      signal = rr.signal;
      dataInsufficient = pred.features?.data_insufficient === true;
    } catch {
      // 保持 signalOf 兜底
    }
  }
  return {
    market_hash_name: name,
    c5_buy_price: c5Price,
    steam_sell_price: steamPrice,
    steam_volume: steam?.volume ?? null,
    popular_rank: steam?.popular_rank ?? null,
    c5_fee_ratio: DEFAULT_FEES.c5_buy_fee_ratio,
    steam_seller_receive_ratio: DEFAULT_FEES.steam_seller_receive_ratio,
    lock_days: LOCK_DAYS,
    steam_net_receive: result?.steam_net_receive ?? null,
    net_profit: result?.net_profit ?? null,
    roi: result?.roi ?? null,
    expected_discount: expectedDiscount != null ? round(expectedDiscount, 6) : null,
    breakeven_sell_price: result?.breakeven_sell_price ?? null,
    signal,
    data_insufficient: dataInsufficient,
  };
}

/**
 * 一条库存记录 → 展示用 InventoryEntry（v1.8.6 抽出：inventory() 与 holdingsOf() 共用同一口径）。
 * 注意 days_left/hours_left 是「算的时刻」的快照值，会被 analysisCache 冻住；
 * 界面要实时倒计时必须用 unlock_at 现算（见 core/holdings.ts）。
 */
async function toInventoryEntry(r: Awaited<ReturnType<typeof storage.getInventory>>[number]): Promise<InventoryEntry> {
  const steam = await storage.getLatestSteam(r.item_name);
  const current = steam?.price ?? null;
  let netReceive: number | null = null;
  let netProfit: number | null = null;
  let roi: number | null = null;
  let discount: number | null = null;
  if (current != null) {
    netReceive = current * DEFAULT_FEES.steam_seller_receive_ratio;
    const cost = r.buy_price * (1 + DEFAULT_FEES.c5_buy_fee_ratio);
    netProfit = netReceive - cost;
    roi = cost ? netProfit / cost : null;
    discount = calc.expectedDiscount(r.buy_price, netReceive);
  }
  const nowTs = Date.now();
  let unlockTs: number;
  let unlockSource: 'steam' | 'estimate' = 'estimate';
  if (r.steam_tradable === true) {
    // Steam 已确认可交易/可上架
    unlockTs = nowTs - 1;
    unlockSource = 'steam';
  } else if (r.steam_unlock_est_at) {
    const est = new Date(r.steam_unlock_est_at).getTime();
    if (Number.isFinite(est)) {
      unlockTs = Math.max(est, nowTs - 1);
      unlockSource = 'steam';
    } else {
      unlockTs = new Date(r.buy_at).getTime() + LOCK_HOURS * 3600000;
    }
  } else {
    unlockTs = new Date(r.buy_at).getTime() + LOCK_HOURS * 3600000;
  }
  const unlock = new Date(unlockTs);
  const msLeft = Math.max(0, unlockTs - nowTs);
  const hoursLeft = msLeft / 3600000;
  const daysLeft = hoursLeft / 24;
  const advice = buildSellAdvice(unlock.toISOString(), r.steam_tradable === true, MARKET_EVENTS);
  return {
    id: r.id,
    item_name: r.item_name,
    quantity: r.quantity,
    buy_price: r.buy_price,
    buy_at: r.buy_at,
    source: r.source,
    unlock_at: unlock.toISOString(),
    days_left: daysLeft,
    hours_left: hoursLeft,
    steam_synced: !!r.steam_synced_at,
    steam_synced_at: r.steam_synced_at ?? null,
    steam_tradable: r.steam_tradable ?? null,
    unlock_source: unlockSource,
    current_estimate: current,
    net_receive_estimate: netReceive,
    net_profit_estimate: netProfit,
    roi_estimate: roi,
    expected_discount_estimate: discount != null ? round(discount, 6) : null,
    sell_advice_code: advice.code,
    sell_advice_text: advice.text,
  };
}

export const engine = {
  // ---- 状态 ----
  async status(): Promise<AppStatus> {
    const cached = getAnalysisCache<AppStatus>('status');
    if (cached) return cached;
    const stats = await storage.getSnapshotStats();
    const settings = await storage.getSettings();
    const out: AppStatus = {
      status: 'ok',
      app: 'CS2余额助手（纯手机版）',
      local: true,
      snapshotCount: stats.count,
      itemCount: stats.itemCount,
      c5Configured: !!settings.c5AppKey.trim(),
      lastUpdated: stats.lastUpdated,
    };
    setAnalysisCache('status', out);
    return out;
  },

  // ---- 采集 ----
  async collectOne(name: string): Promise<CollectStats & { c5Price: number | null }> {
    const stats = await collectOne(name);
    clearDetailCache(name);
    bumpAnalysisGeneration();
    return stats;
  },

  // ---- 报价（单个） ----
  async quote(name: string): Promise<Quote> {
    return (await analyzeLocal(name)).quote;
  },

  /**
   * 详情页一次取齐（v1.8.2：补历史后走共享分析，不再重复预测）。
   * 预测失败降级为 null（quote 照常返回），任何预测异常都不会让整页打不开。
   */
  async detail(name: string): Promise<{ quote: Quote; prediction: Prediction | null }> {
    const cached = getDetailCache<{ quote: Quote; prediction: Prediction | null }>(name);
    if (cached) return cached;
    // 本地点不足时先补拉一次历史（单箱、带节流；SSR 优先，见 backfillHistoryIfThin）
    await backfillHistoryIfThin(name);
    return analyzeLocal(name);
  },

  // ---- 市场（全部报价，预计几折从低到高） ----
  async markets(): Promise<Quote[]> {
    const cached = getAnalysisCache<Quote[]>('markets');
    if (cached) return cached;
    const names = await storage.getSnapshotNames();
    const out: Quote[] = [];
    await runConcurrent(names, 4, async (name) => {
      try {
        // 共享分析：顺带把结果填进 detailCache，从列表点进详情即命中
        out.push((await analyzeLocal(name)).quote);
      } catch {
        // 单箱失败不影响整体
      }
    });
    out.sort((a, b) => {
      const da = a.expected_discount == null ? Infinity : a.expected_discount;
      const db = b.expected_discount == null ? Infinity : b.expected_discount;
      if (da !== db) return da - db;
      return a.market_hash_name.localeCompare(b.market_hash_name);
    });
    setAnalysisCache('markets', out);
    return out;
  },

  // ---- 雷达 ----
  async radar(): Promise<RadarItem[]> {
    const cached = getAnalysisCache<RadarItem[]>('radar');
    if (cached) return cached;
    const names = await storage.getSnapshotNames();
    const out: RadarItem[] = [];
    await runConcurrent(names, 4, async (name) => {
      const { quote, prediction } = await analyzeLocal(name);
      if (quote.steam_sell_price == null) return;
      if (!prediction) return;
      out.push(toRadarItem(name, quote.c5_buy_price, quote.steam_sell_price, quote.steam_volume ?? 0, prediction));
    });
    out.sort((a, b) => {
      const da = a.expected_discount == null ? Infinity : a.expected_discount;
      const db = b.expected_discount == null ? Infinity : b.expected_discount;
      if (da !== db) return da - db;
      return b.score - a.score;
    });
    setAnalysisCache('radar', out);
    return out;
  },

  async history(name: string, limit = 120): Promise<HistoryPoint[]> {
    const rows = await storage.getSteamHistory(name, limit);
    const local = rows.map((r) => ({ price: r.price, fetchedAt: r.fetchedAt, volume: r.volume ?? null }));
    if (local.length >= 7) return local;
    try {
      const ssr = await fetchSteamHistorySsr(name, limit);
      if (ssr.length > local.length) {
        return ssr.map((p) => ({ price: p.price, fetchedAt: `${p.date}T08:00:00.000Z`, volume: p.volume }));
      }
    } catch {}
    return local;
  },

  // ---- 预测 ----
  async prediction(name: string): Promise<Prediction> {
    const inp = await collectPredictInputs(name);
    if (!inp.steam || inp.steam.price == null) throw new Error('暂无该商品的价格快照，请先刷新采集');
    const c5Price = inp.c5?.price ?? null;
    return buildPrediction(name, c5Price, inp.prices, {
      volume: inp.volume,
      volumeHistory: inp.volumeHistory,
      popularRank: inp.popularRank,
    });
  },

  // ---- 库存 ----
  async inventory(): Promise<InventoryEntry[]> {
    const cached = getAnalysisCache<InventoryEntry[]>('inventory');
    if (cached) return cached;
    const rows = await storage.getInventory();
    const out: InventoryEntry[] = [];
    for (const r of rows) out.push(await toInventoryEntry(r));
    out.sort((a, b) => a.unlock_at.localeCompare(b.unlock_at));
    setAnalysisCache('inventory', out);
    return out;
  },

  /**
   * 某个箱子的持仓（v1.8.6 详情页「我的持仓」用）。
   * 只查这个箱子的记录（不拉全表）；没有持仓返回 null。
   * 返回 summary（汇总）+ entries（原始记录，进度条/逐笔明细用）。
   * 不缓存：持仓随买入/同步变化，且剩余时间必须实时（调用方传 now 现算）。
   */
  async holdingsOf(name: string): Promise<{ summary: HoldingsSummary; entries: InventoryEntry[] } | null> {
    const rows = await storage.getInventoryByName(name);
    if (rows.length === 0) return null;
    const entries: InventoryEntry[] = [];
    for (const r of rows) entries.push(await toInventoryEntry(r));
    const summary = summarizeHoldings(entries, Date.now());
    if (!summary) return null;
    return { summary, entries };
  },

  /** Skinport 实际成交统计（免 Key 免登录；10 分钟内存缓存） */
  async skinportStats(name: string): Promise<SkinportStats | null> {
    if (!skinportCache) skinportCache = new Map();
    const hit = skinportCache.get(name);
    if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.v;
    try {
      const map = await fetchSkinportHistory([name]);
      const v = map[name] ?? null;
      skinportCache.set(name, { t: Date.now(), v });
      while (skinportCache.size > SKINPORT_CACHE_MAX) {
        const oldest = skinportCache.keys().next().value as string | undefined;
        if (oldest == null) break;
        skinportCache.delete(oldest);
      }
      return v;
    } catch {
      return null;
    }
  },

  /** C5 买入时机参考：近 7/30 天 C5 统计 + 长周期 Steam 日线（波动率/90 天低位/长趋势）→ 买入建议 */
  async c5BuyAdvice(name: string) {
    const [hist, steamLong] = await Promise.all([
      storage.getC5History(name, 40),
      storage.getSteamHistory(name, 120),
    ]);
    const latestC5 = await storage.getLatestC5(name);
    const points: AdvicePoint[] = hist.map((s) => ({ t: new Date(s.fetchedAt).getTime(), price: s.price }));
    const long: AdvicePoint[] = steamLong.map((s) => ({ t: new Date(s.fetchedAt).getTime(), price: s.price }));
    return buildC5BuyAdvice(points, latestC5?.price ?? null, Date.now(), { longHistory: long });
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
    bumpAnalysisGeneration();
    return { id: entry.id, unlock_at: unlock.toISOString(), days: LOCK_DAYS };
  },

  /** 同步 Steam 库存 → 用真实冷却校正本地库存解锁时间（精确到小时） */
  /** 库存同步唯一入口：C5 官方 OpenAPI（app-key）。v1.5.9 起库存仅走 C5 app-key：
   *  C5 服务端从 Steam 高权限通道拉库存，能看到交易保护中的物品（status=4 冷却中）；
   *  Steam Web API 对保护期账号返回空对象（v1.5.7 用户实测双 context 均 {"response":{}}），
   *  已随本版本移除 Web API 库存方式与设置项。历史价格仍走 C5 网页 cookie（OpenAPI 无历史端点）。
   *  需要 C5 app-key + SteamID64（做过 Steam 一键登录可自动识别本人 ID）。 */
  async syncSteamInventorySmart(): Promise<{
    matched: number; unlocked: number; imported: number; notFound: number; removed: number;
    steamId: string; empty: boolean; assetCount: number; totalInventoryCount: number | null;
    playerName: string | null;
    source: 'c5_openapi'; reason?: string; at: string;
  }> {
    const settings = await storage.getSettings();
    const appKey = (settings.c5AppKey || '').trim();
    let steamId = (settings.steamId || '').trim();
    // 曾做过「Steam 一键登录」：仅用于自动识别本人 SteamID64（库存仍走 C5 app-key，不依赖 Steam cookie）
    if ((!steamId || !/^\d{17}$/.test(steamId.replace(/^.*profiles\//, ''))) && settings.steamCookie) {
      try {
        const sid = await resolveOwnSteamId(settings.steamCookie);
        steamId = sid;
        await storage.updateSettings({ steamId: sid });
      } catch {
        // cookie 失效时回退已存 steamId；两者皆无则走下方精准提示
      }
    }
    if (!appKey) {
      throw new Error('请先到「设置」页配置 C5GAME app-key（库存与价格统一走 C5 官方 OpenAPI，免费注册：opendoc.c5game.com）');
    }
    if (!steamId) {
      throw new Error('请到「设置」页填写你的 SteamID64（资料页 /profiles/ 后的 17 位数字），配合 C5 app-key 即可同步，无需 Steam 登录');
    }
    // 自定义 URL（vanity）已无法解析（Steam Web API Key 已移除）→ 只收 17 位数字或 profiles 链接
    let sid: string;
    try {
      sid = normalizeSteamId(steamId);
    } catch {
      throw new Error('SteamID64 格式不正确：请输入资料页 /profiles/ 后的 17 位数字（自定义 URL 需先到 Steam 资料页查看数字 ID），或做一次「Steam 一键登录」自动识别');
    }
    if (sid !== steamId.trim()) await storage.updateSettings({ steamId: sid });
    const fetched = await fetchC5Inventory(sid, appKey);
    const { items, assetCount, total } = fetched;
    const now = new Date();
    if (items.length === 0) {
      const reason = buildC5EmptySyncReason({ assetCount, total });
      return {
        matched: 0, unlocked: 0, imported: 0, notFound: 0, removed: 0, steamId: sid, empty: true,
        assetCount, totalInventoryCount: total, playerName: null, source: 'c5_openapi', reason, at: now.toISOString(),
      };
    }
    const rows = await storage.getInventory();
    // allowRemoval：C5 返回了非空库存才允许清理「已不在 Steam 库存」的记录（空库存走上面的 early return）
    const plan = planSteamSync(rows, items, now, { allowRemoval: true });
    await storage.updateInventoryCooldown(plan.updates);
    await storage.addInventoryBulk(plan.newEntries);
    const removed = await storage.removeInventory(plan.removeIds);
    bumpAnalysisGeneration();
    return {
      matched: plan.matched,
      unlocked: plan.unlocked,
      imported: plan.imported,
      notFound: plan.notFound,
      removed,
      steamId: sid,
      empty: false,
      assetCount,
      totalInventoryCount: total,
      playerName: null,
      source: 'c5_openapi',
      at: now.toISOString(),
    };
  },

  // ---- 订单 ----
  orders: async (): Promise<OrderRecord[]> => {
    const rows = await storage.getOrders();
    rows.sort((a, b) => b.buy_at.localeCompare(a.buy_at));
    return rows;
  },

  // ---- 一键买入：购买前核验 ----
  async prepareBuy(params: { name: string; qty?: number }): Promise<BuyPrepareResult> {
    const qty = Math.max(1, Math.min(999, Math.floor(params.qty ?? 1)));
    const q = await this.quote(params.name);
    const settings = await storage.getSettings();
    const protection: BuyProtection = {
      maxBuyPrice: settings.buyMaxPrice,
      minTargetDiscount: settings.buyTargetZhe,
      maxBudget: settings.buyMaxBudget,
    };
    const check = checkPurchase({
      buyPrice: q.c5_buy_price ?? 0,
      qty,
      steamNetReceivePerUnit: q.steam_net_receive,
      protection,
    });
    // 异常价格二次确认：C5 买入价明显高于本地最近一次快照时提示
    const latestC5 = await storage.getLatestC5(params.name);
    if (q.c5_buy_price != null && latestC5 && latestC5.price > 0 && q.c5_buy_price > latestC5.price * 1.3) {
      check.warnings.push(`C5 买入价从 ¥${latestC5.price.toFixed(2)} 上涨到 ¥${q.c5_buy_price.toFixed(2)}（+${Math.round((q.c5_buy_price / latestC5.price - 1) * 100)}%），请确认是否仍要买入`);
    }
    return {
      ...check,
      name: params.name,
      displayName: params.name,
      qty,
      lockDays: LOCK_DAYS,
    };
  },

  // ---- 一键买入：确认后写入库存 + 订单 ----
  async executeBuy(params: { name: string; qty?: number }): Promise<BuyExecuteResult> {
    const pre = await this.prepareBuy(params);
    if (!pre.ok) {
      return { ok: false, message: pre.errors.join('；') || '购买条件不满足' };
    }
    const buyPrice = pre.summary.buyPrice;
    const qty = pre.qty;
    const entry = await storage.addInventory({
      item_name: params.name,
      quantity: qty,
      buy_price: buyPrice,
      buy_at: new Date().toISOString(),
      source: 'c5game',
    });
    const order = await storage.addOrder({
      item_name: params.name,
      quantity: qty,
      buy_price: buyPrice,
      buy_at: new Date().toISOString(),
      source: 'c5game',
      expected_discount: pre.summary.discountNum,
      budget_used: pre.summary.totalCost,
    });
    const unlock = new Date(new Date(entry.buy_at).getTime() + LOCK_HOURS * 3600000);
    bumpAnalysisGeneration();
    return {
      ok: true,
      message: `已记录买入 ${qty} × ¥${buyPrice.toFixed(2)}，预计 ${unlock.toLocaleString()} 解锁`,
      order,
      unlockAt: unlock.toISOString(),
    };
  },

  // ---- 模拟 ----
  async simulate(budget: number, allocation = 'balanced'): Promise<Simulation> {
    const radar = await this.radar();
    const simItems: SimItemInput[] = [];
    for (const r of radar) {
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

  buildBuySummary,
};

export function getSimConfig() {
  return SIM_CONFIG;
}

function round(v: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.round(v * p) / p;
}
