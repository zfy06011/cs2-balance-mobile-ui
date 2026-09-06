/**
 * engine：本地分析引擎（组合层）。
 * 完全在手机内完成：快照 → 预测 → 收益 → 雷达 → 模拟 → 库存估值 → 购买核验。
 * 与后端 routes 的产出结构保持一致，UI 无需关心数据来自本地还是后端。
 */
import {
  storage, LocalSnapshot, LOCK_HOURS, LOCK_DAYS,
} from '../data/storage';
import { collectCases, collectOne, CollectProgress, CollectStats } from '../data/collector';
import { parsePriceHistory, resolveOwnSteamId, normalizeSteamId } from '../data/steam';
import { fetchSkinportHistory, SkinportStats } from '../data/skinport';
import { fetchC5StatsBulk, fetchC5PriceTrend, fetchC5ItemIdViaWeb, fetchC5Inventory } from '../data/c5';
import { fetchCloudHistory, cloudPointsToHistory } from '../data/cloudHistory';

let skinportCache: Map<string, { t: number; v: SkinportStats | null }> | null = null;
import { ProfitCalculator } from './profit';
import { BaselinePredictor, BaselinePredictorV3, MARKET_EVENTS, type MarketEvent } from './prediction';
import { evaluateRadar } from './radar';
import { simulate as runSimulation, reverseTarget, SimItemInput, SIM_CONFIG } from './simulation';
import { checkPurchase, BuyProtection, BuyCheckResult, buildBuySummary } from './buy';
import { planSteamSync, buildC5EmptySyncReason } from './steamSync';
import { buildSellAdvice, buildC5BuyAdvice, AdvicePoint } from './advice';
import { DEFAULT_FEES } from './fees';
import type {
  Quote, RadarItem, Prediction, Scenario, InventoryEntry, Simulation, OrderRecord, HistoryPoint,
} from './types';

const predictor = new BaselinePredictorV3();
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
  /** 市场事件日历（默认注入 Steam 2026 大促） */
  events?: MarketEvent[];
}

/** 一次性取齐预测所需输入（Steam 最新价 / C5 价 / 价格历史 / 成交量历史 / 热门排名） */
async function collectPredictInputs(name: string): Promise<{
  steam: LocalSnapshot | null;
  c5: LocalSnapshot | null;
  prices: number[];
  volumeHistory: number[];
  volume: number | null;
  popularRank: number | null;
}> {
  const steam = await storage.getLatestSteam(name);
  const c5 = await storage.getLatestC5(name);
  const prices = await storage.getSteamPrices(name);
  const hist = await storage.getSteamHistory(name, 60);
  const volumeHistory = hist.map((h) => h.volume ?? 0).filter((v) => v > 0);
  return {
    steam,
    c5,
    prices,
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

function signalOf(roi: number | null): string {
  if (roi == null) return 'waiting';
  if (roi >= 0.05) return 'buy';
  if (roi >= 0) return 'wait';
  return 'avoid';
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

  // ---- 报价（单个） ----
  async quote(name: string): Promise<Quote> {
    const inp = await collectPredictInputs(name);
    const steam = inp.steam;
    const c5 = inp.c5;
    const steamPrice = steam?.price ?? null;
    const c5Price = c5?.price ?? null;
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
  },

  // ---- 市场（全部报价，预计几折从低到高） ----
  async markets(): Promise<Quote[]> {
    const snaps = await storage.getSnapshots();
    const names = [...new Set(snaps.map((s) => s.name))];
    const out: Quote[] = [];
    for (const name of names) {
      try {
        out.push(await this.quote(name));
      } catch {
        continue;
      }
    }
    out.sort((a, b) => {
      const da = a.expected_discount == null ? Infinity : a.expected_discount;
      const db = b.expected_discount == null ? Infinity : b.expected_discount;
      if (da !== db) return da - db;
      return a.market_hash_name.localeCompare(b.market_hash_name);
    });
    return out;
  },

  // ---- 雷达 ----
  async radar(): Promise<RadarItem[]> {
    const snaps = await storage.getSnapshots();
    const names = [...new Set(snaps.map((s) => s.name))];
    const out: RadarItem[] = [];
    for (const name of names) {
      const inp = await collectPredictInputs(name);
      const steam = inp.steam;
      if (!steam || steam.price == null) continue;
      const c5Price = inp.c5?.price ?? null;
      try {
        // 只用真实 Steam 历史预测；不足 4 点时由 V2 标记 data_insufficient，雷达封顶 wait
        const pred = buildPrediction(name, c5Price, inp.prices, {
          volume: inp.volume,
          volumeHistory: inp.volumeHistory,
          popularRank: inp.popularRank,
        });
        out.push(toRadarItem(name, c5Price, steam.price, steam.volume ?? 0, pred));
      } catch {
        continue;
      }
    }
    out.sort((a, b) => {
      const da = a.expected_discount == null ? Infinity : a.expected_discount;
      const db = b.expected_discount == null ? Infinity : b.expected_discount;
      if (da !== db) return da - db;
      return b.score - a.score;
    });
    return out;
  },

  // ---- 历史（简单趋势用） ----
  async history(name: string, limit = 7): Promise<HistoryPoint[]> {
    const rows = await storage.getSteamHistory(name, limit);
    return rows.map((r) => ({ price: r.price, fetchedAt: r.fetchedAt }));
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
    const rows = await storage.getInventory();
    const out: InventoryEntry[] = [];
    for (const r of rows) {
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
      out.push({
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
        steam_tradable: r.steam_tradable ?? null,
        unlock_source: unlockSource,
        current_estimate: current,
        net_receive_estimate: netReceive,
        net_profit_estimate: netProfit,
        roi_estimate: roi,
        expected_discount_estimate: discount != null ? round(discount, 6) : null,
        sell_advice_code: advice.code,
        sell_advice_text: advice.text,
      });
    }
    out.sort((a, b) => a.unlock_at.localeCompare(b.unlock_at));
    return out;
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
    return { id: entry.id, unlock_at: unlock.toISOString(), days: LOCK_DAYS };
  },

  /** 同步 Steam 库存 → 用真实冷却校正本地库存解锁时间（精确到小时） */
  /** 会话导入历史的目标清单：Steam 价格点不足 14 的名字优先（升序），供网页内导入 */
  async listHistoryTargets(limit = 60): Promise<string[]> {
    const snaps = await storage.getSnapshots();
    const counts = new Map<string, number>();
    for (const s of snaps) {
      if (s.source !== 'steam' || s.price <= 0) continue;
      counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
    }
    const names = [...counts.entries()]
      .filter(([, c]) => c < 14)
      .sort((a, b) => a[1] - b[1])
      .map(([n]) => n);
    if (names.length > 0) return names.slice(0, limit);
    return [...counts.keys()].slice(0, limit);
  },

  /** 网页会话抓到的 pricehistory.prices 解析入库，返回新增点数 */
  async importSteamPriceHistoryRaw(name: string, prices: unknown): Promise<{ added: number }> {
    const pts = parsePriceHistory(prices, 120);
    if (pts.length === 0) return { added: 0 };
    const added = await storage.mergeSteamHistory(name, pts);
    return { added };
  },

  /** C5 历史导入目标清单：Steam / C5 历史点不足 14 的名字优先（升序），供 C5 快速通道 */
  async c5HistoryTargets(limit = 60): Promise<string[]> {
    const snaps = await storage.getSnapshots();
    const counts = new Map<string, number>();
    for (const s of snaps) {
      if ((s.source !== 'steam' && s.source !== 'c5_hist') || s.price <= 0) continue;
      counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
    }
    const names = [...counts.entries()]
      .filter(([, c]) => c < 14)
      .sort((a, b) => a[1] - b[1])
      .map(([n]) => n);
    if (names.length > 0) return names.slice(0, limit);
    return [...counts.keys()].slice(0, limit);
  },

  /** C5 快速导入（借鉴 C5 网页趋势接口）：itemId → price-trend/chart → c5_hist 入库。
   *  任一件失败即停止返回（UI 据此询问「跳过继续 / 停止」，不再静默跳过）。 */
  async importC5Histories(
    names: string[],
    opts: { c5AppKey: string; c5Cookie: string },
    onItem?: (done: number, total: number, name: string, added: number) => void,
    startIdx = 0,
  ): Promise<{
    ok: number; skip: number; fail: number;
    failedIdx: number | null; failedName: string | null; failedReason: string | null;
  }> {
    const key = (opts.c5AppKey || '').trim();
    const cookie = (opts.c5Cookie || '').trim();
    let ok = 0;
    let skip = 0;
    let fail = 0;
    for (let i = startIdx; i < names.length; i++) {
      const name = names[i];
      try {
        let itemId = '';
        if (key) {
          try {
            const stats = await fetchC5StatsBulk([name], key);
            itemId = stats[name]?.itemId ?? '';
          } catch {
            itemId = '';
          }
        }
        if (!itemId) {
          itemId = await fetchC5ItemIdViaWeb(name, cookie);
        }
        if (!itemId) {
          throw new Error('未查到 C5 itemId（需有效 C5 app-key 或已登录的 C5 Cookie）');
        }
        if (!cookie) {
          throw new Error('未配置 C5 Cookie，无法拉取趋势');
        }
        const pts = await fetchC5PriceTrend(itemId, cookie, '90', 120);
        if (pts.length === 0) {
          throw new Error('C5 趋势接口无数据（Cookie 可能已失效）');
        }
        const added = await storage.mergeC5History(name, pts);
        onItem?.(i + 1, names.length, name, added);
        if (added > 0) ok++;
        else skip++;
      } catch (e) {
        fail++;
        onItem?.(i + 1, names.length, name, 0);
        return {
          ok, skip, fail,
          failedIdx: i, failedName: name,
          failedReason: e instanceof Error ? e.message : String(e),
        };
      }
    }
    return { ok, skip, fail, failedIdx: null, failedName: null, failedReason: null };
  },

  /** 云端快速导入（Cloudflare Worker D1 缓存，零 cookie）：逐箱拉 Steam 官方全量历史入库。
   *  任一件失败即停止返回（与 importC5Histories 同语义）；云端未收录 / 网络失败会给出原因。 */
  async importCloudHistories(
    names: string[],
    workerBaseUrl: string,
    onItem?: (done: number, total: number, name: string, added: number) => void,
    startIdx = 0,
  ): Promise<{
    ok: number; skip: number; fail: number;
    failedIdx: number | null; failedName: string | null; failedReason: string | null;
  }> {
    let ok = 0;
    let skip = 0;
    let fail = 0;
    for (let i = startIdx; i < names.length; i++) {
      const name = names[i];
      try {
        const data = await fetchCloudHistory(workerBaseUrl, name, 120);
        const pts = cloudPointsToHistory(data.points);
        if (pts.length === 0) {
          throw new Error('云端尚未收录该箱（等待定时采集，或检查箱子名称）');
        }
        const added = await storage.mergeSteamHistory(name, pts);
        onItem?.(i + 1, names.length, name, added);
        if (added > 0) ok++;
        else skip++;
      } catch (e) {
        fail++;
        onItem?.(i + 1, names.length, name, 0);
        return {
          ok, skip, fail,
          failedIdx: i, failedName: name,
          failedReason: e instanceof Error ? e.message : String(e),
        };
      }
    }
    return { ok, skip, fail, failedIdx: null, failedName: null, failedReason: null };
  },

  /** 库存同步唯一入口：C5 官方 OpenAPI（app-key）。v1.5.9 起库存仅走 C5 app-key：
   *  C5 服务端从 Steam 高权限通道拉库存，能看到交易保护中的物品（status=4 冷却中）；
   *  Steam Web API 对保护期账号返回空对象（v1.5.7 用户实测双 context 均 {"response":{}}），
   *  已随本版本移除 Web API 库存方式与设置项。历史价格仍走 C5 网页 cookie（OpenAPI 无历史端点）。
   *  需要 C5 app-key + SteamID64（做过 Steam 一键登录可自动识别本人 ID）。 */
  async syncSteamInventorySmart(): Promise<{
    matched: number; unlocked: number; imported: number; notFound: number;
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
        matched: 0, unlocked: 0, imported: 0, notFound: 0, steamId: sid, empty: true,
        assetCount, totalInventoryCount: total, playerName: null, source: 'c5_openapi', reason, at: now.toISOString(),
      };
    }
    const rows = await storage.getInventory();
    const plan = planSteamSync(rows, items, now);
    await storage.updateInventoryCooldown(plan.updates);
    await storage.addInventoryBulk(plan.newEntries);
    return {
      matched: plan.matched,
      unlocked: plan.unlocked,
      imported: plan.imported,
      notFound: plan.notFound,
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
