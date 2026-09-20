/**
 * radar：机会雷达（与后端 services/radar.py、monitor.py 对齐）。
 * 综合 C5 买入价、Steam 卖出价、双方成本、7 天预测净 ROI、流动性、风险，输出信号。
 */

export interface RadarInput {
  market_hash_name: string;
  c5_buy_price: number | null;
  steam_sell_price: number | null;
  steam_volume: number;
  predicted_p50?: number | null;
  predicted_p25?: number | null;
  breakeven_price?: number | null;
  volatility?: number;
  event_risk?: number;
  seller_receive_ratio?: number;
  c5_fee_ratio?: number;
  prob_profit?: number;
  /** Steam 热门榜排名（1 起）；未提供不加分 */
  popular_rank?: number | null;
  /** 历史数据不足（预测仅供参考）：信号封顶 wait、评分封顶 40 */
  data_insufficient?: boolean;
  /** 事件价差修正（预测 features.event_adjust，如 -0.03）：用于还原未修正 P50 + 评分偏移 */
  event_adjust?: number;
  /** ---- V4 新增维度（缺省不影响旧行为） ---- */
  /** 变异系数（近 30 天，越低越稳定） */
  cv?: number | null;
  /** 趋势拟合度 R²（0-1） */
  r2?: number | null;
  /** 当前价在 365 天分布中的分位（0-1，>0.8 为高位） */
  pct_365?: number | null;
  /** 市场状态：CHAOS 时信号封顶 wait */
  market_state?: 'STABLE' | 'RISING' | 'FALLING' | 'CHAOS' | null;
}

export interface RadarOutput {
  market_hash_name: string;
  signal: 'buy' | 'wait' | 'avoid';
  expected_roi: number | null;
  pessimistic_roi: number | null;
  risk_level: 'low' | 'medium' | 'high';
  liquidity: 'low' | 'medium' | 'high';
  score: number;
  details: Record<string, number | string | boolean | null>;
}

function roiOf(
  sellPrice: number | null,
  buyPrice: number | null,
  receiveRatio: number,
  fee: number,
): number | null {
  if (sellPrice == null || buyPrice == null || buyPrice <= 0) return null;
  const totalCost = buyPrice * (1 + fee);
  const net = sellPrice * receiveRatio - totalCost;
  return net / totalCost;
}

function riskLevel(volatility: number, eventRisk: number, liquid: string): 'low' | 'medium' | 'high' {
  const score = volatility * 100 + eventRisk * 3 + (liquid === 'low' ? 1 : 0);
  if (score >= 3) return 'high';
  if (score >= 1.5) return 'medium';
  return 'low';
}

function liquidityOf(volume: number): 'low' | 'medium' | 'high' {
  if (volume >= 5000) return 'high';
  if (volume >= 1000) return 'medium';
  return 'low';
}

export function evaluateRadar(r: RadarInput): RadarOutput {
  const liquid = liquidityOf(r.steam_volume);
  const risk = riskLevel(r.volatility ?? 0.05, r.event_risk ?? 0, liquid);

  // 事件价差修正：引擎传入的是「还原后的原始 P50/P25」，这里乘回 (1+event_adjust)，
  // 得到事件修正后的有效预测价（避免双重修正）。无事件时 factor=1，行为与旧版一致。
  const eventFactor = r.event_adjust != null ? 1 + r.event_adjust : 1;
  const p50Base = r.predicted_p50 ?? r.steam_sell_price;
  const p50Sell = p50Base != null ? p50Base * eventFactor : null;
  const expectedRoi = roiOf(p50Sell, r.c5_buy_price, r.seller_receive_ratio ?? 0.8696, r.c5_fee_ratio ?? 0.01);
  const p25Sell = r.predicted_p25 != null ? r.predicted_p25 * eventFactor : null;
  const pessimisticRoi = roiOf(p25Sell, r.c5_buy_price, r.seller_receive_ratio ?? 0.8696, r.c5_fee_ratio ?? 0.01);

  let signal: 'buy' | 'wait' | 'avoid';
  // V4：走势紊乱或长周期高位时，不允许直接给 buy
  const chaotic = r.market_state === 'CHAOS';
  const highPercentile = r.pct_365 != null && r.pct_365 > 0.8;
  const cvUnstable = r.cv != null && r.cv > (p50Sell != null && p50Sell >= 100 ? 0.04 : 0.08);
  if (expectedRoi == null) {
    signal = 'wait';
  } else if (r.data_insufficient === true) {
    // 历史不足：预测不可信，绝不因预测给 buy；当前价格已明确亏损才 avoid
    signal = expectedRoi < 0 ? 'avoid' : 'wait';
  } else if (chaotic) {
    // 走势紊乱：不给买入信号
    signal = expectedRoi < 0 ? 'avoid' : 'wait';
  } else if (expectedRoi >= 0.05 && pessimisticRoi != null && pessimisticRoi >= -0.02 && risk !== 'high' && !highPercentile && !cvUnstable) {
    signal = 'buy';
  } else if (expectedRoi >= 0 || (pessimisticRoi != null && pessimisticRoi >= -0.05)) {
    signal = 'wait';
  } else {
    signal = 'avoid';
  }

  let score = 0;
  if (expectedRoi != null) score += Math.min(Math.max(expectedRoi * 200, -20), 40);
  if (r.breakeven_price && r.predicted_p50) {
    score += Math.min(Math.max((r.predicted_p50 / r.breakeven_price - 1) * 100, -10), 30);
  }
  score += liquid === 'high' ? 15 : liquid === 'medium' ? 8 : 0;
  score -= risk === 'low' ? 0 : risk === 'medium' ? 5 : 15;
  // 热门榜排名加分：进入 Steam 热门榜（<=100）流动性背书 +3，头部（<=30）再 +3
  if (r.popular_rank != null && r.popular_rank >= 1) {
    if (r.popular_rank <= 100) score += 3;
    if (r.popular_rank <= 30) score += 3;
  }
  // 事件价差修正偏移：大促压制期（负修正）买入机会加分，反弹期（正修正）减分（幅度封顶 ±8 分）
  if (r.event_adjust != null && r.event_adjust !== 0) {
    score += Math.max(-8, Math.min(8, r.event_adjust * -200));
  }
  // 历史数据不足：评分封顶 40（避免「看似高分」误导）
  if (r.data_insufficient === true) score = Math.min(score, 40);
  // V4 趋势质量：R² 高加分、低扣分；长周期高位/紊乱扣分
  if (r.r2 != null) {
    if (r.r2 >= 0.6) score += 4;
    else if (r.r2 < 0.3) score -= 4;
  }
  if (r.pct_365 != null && r.pct_365 > 0.8) score -= 6;
  if (chaotic) score = Math.min(score, 40);
  score = Math.max(0, Math.min(100, round(score, 1)));

  return {
    market_hash_name: r.market_hash_name,
    signal,
    expected_roi: expectedRoi != null ? round(expectedRoi, 6) : null,
    pessimistic_roi: pessimisticRoi != null ? round(pessimisticRoi, 6) : null,
    risk_level: risk,
    liquidity: liquid,
    score,
    details: {
      c5_buy_price: r.c5_buy_price ?? null,
      steam_sell_price: r.steam_sell_price ?? null,
      predicted_p50: p50Sell != null ? round(p50Sell, 4) : null,
      breakeven_price: r.breakeven_price ?? null,
      volatility: r.volatility ?? 0.05,
      prob_profit: r.prob_profit ?? 0,
      popular_rank: r.popular_rank ?? null,
      data_insufficient: r.data_insufficient === true,
      event_adjust: r.event_adjust ?? null,
      cv: r.cv ?? null,
      r2: r.r2 ?? null,
      pct_365: r.pct_365 ?? null,
      market_state: r.market_state ?? null,
    },
  };
}

function round(v: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.round(v * p) / p;
}

// ---- monitor：监控池 ----
export const CORE_POOL_SIZE = 50;
export const CANDIDATE_POOL_SIZE = 100;
// 扩展关键字（与 caseFilter.ts 同口径，但不跨目录导入——verify:core 编译环境限制）
export const CASE_KEYWORDS = ['武器箱', 'case', 'Case', 'Capsule', 'capsule', 'Stamp', 'Unit', 'Terminal', 'Package', 'Box', 'Container', '箱子', '胶囊', '收藏包', '钥匙'];

export function isCaseName(name: string): boolean {
  return CASE_KEYWORDS.some((k) => name.includes(k));
}
