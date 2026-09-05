/**
 * prediction：7 天限制期价格预测（与后端 services/prediction.py 对齐）。
 * 基线动量模型：P50 = 最新价 × exp(动量 × 衰减)；区间用波动率 × 正态分位数扩展。
 * 注意：Hermes JS 引擎无 Math.erf，这里自带 erf 近似。
 */
export interface PredictionResult {
  item_id: number | null;
  market_hash_name: string;
  model_version: string;
  predicted_at: string;
  target_at: string;
  horizon_days: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  prob_profit: number;
  prob_loss: number;
  confidence: number;
  features: Record<string, number | string | boolean>;
}

export const MODEL_VERSION = 'baseline-momentum-v1';

const _Z: Record<string, number> = {
  p10: -1.2816,
  p25: -0.6745,
  p50: 0.0,
  p75: 0.6745,
  p90: 1.2816,
};

export class BaselinePredictor {
  constructor(
    public horizonDays = 7,
    public momentumDays = 7,
    public momentumDecay = 0.5,
    public minHistory = 15,
  ) {}

  predict(params: {
    marketHashName: string;
    prices: number[];
    breakevenPrice?: number;
    itemId?: number | null;
    predictedAt?: Date;
  }): PredictionResult {
    const { marketHashName, prices, breakevenPrice, itemId, predictedAt } = params;
    if (prices.length < 2) {
      throw new Error('至少需要 2 条历史价格才能预测');
    }
    const latest = prices[prices.length - 1];
    const logReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) {
        logReturns.push(Math.log(prices[i] / prices[i - 1]));
      }
    }
    let vol = logReturns.length >= 2 ? pstdev(logReturns) : 0.05;
    if (prices.length < this.minHistory) {
      vol = Math.max(vol, 0.05) * 1.5;
    }

    const window = prices.slice(-this.momentumDays);
    let momentum = 0;
    if (window.length >= 2 && window[0] > 0) {
      momentum = Math.log(window[window.length - 1] / window[0]);
    }
    const drift = momentum * this.momentumDecay;
    const sigmaTotal = vol * Math.sqrt(this.horizonDays);
    const p50 = latest * Math.exp(drift);

    const quantiles: { p10: number; p25: number; p50: number; p75: number; p90: number } = { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
    for (const q of Object.keys(_Z) as (keyof typeof quantiles)[]) {
      quantiles[q] = Math.max(0, round2(p50 * Math.exp(_Z[q] * sigmaTotal), 4));
    }

    let probProfit = 0.5;
    if (breakevenPrice && breakevenPrice > 0) {
      if (sigmaTotal < 1e-9) {
        probProfit = p50 > breakevenPrice ? 1 : p50 < breakevenPrice ? 0 : 0.5;
      } else {
        const mu = Math.log(p50);
        probProfit = 1 - normalCdf((Math.log(breakevenPrice) - mu) / sigmaTotal);
      }
    }
    probProfit = Math.max(0, Math.min(1, probProfit));
    const probLoss = 1 - probProfit;
    const confidence = Math.max(0.1, Math.min(0.95, 1 - sigmaTotal * 3));

    const predAt = predictedAt ?? new Date();
    const targetAt = new Date(predAt.getTime() + this.horizonDays * 86400000);

    return {
      item_id: itemId ?? null,
      market_hash_name: marketHashName,
      model_version: MODEL_VERSION,
      predicted_at: predAt.toISOString(),
      target_at: targetAt.toISOString(),
      horizon_days: this.horizonDays,
      p10: quantiles.p10,
      p25: quantiles.p25,
      p50: quantiles.p50,
      p75: quantiles.p75,
      p90: quantiles.p90,
      prob_profit: round2(probProfit, 4),
      prob_loss: round2(probLoss, 4),
      confidence: round2(confidence, 4),
      features: {
        latest_price: round2(latest, 4),
        momentum: round2(momentum, 6),
        volatility: round2(vol, 6),
        history_len: prices.length,
        input_reduced: true,
      },
    };
  }
}

function pstdev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

function round2(v: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.round(v * p) / p;
}

/** 标准正态分布 CDF（通过 erf 近似） */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

/** erf 近似（Abramowitz-Stegun 7.1.26，精度 ~1e-7，Hermes 兼容） */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}


/**
 * baseline-momentum-v2：推荐/雷达使用的增强版预测模型。
 * 相对 v1 的优化：
 *  1. 趋势：不再用「单点首末对比」，改为 7 点窗口内对数价格的线性回归斜率
 *     （不足 4 点退化为首末对数收益），并限制单日漂移 |drift|<=5%，防短窗口外推爆炸。
 *  2. 量价配合：最新 24h 成交量较历史均量显著放大/萎缩时，按方向放大/缩小漂移
 *     （放量上涨更可信、放量下跌更危险、缩量上涨更谨慎）。
 *  3. 数据不足：历史不足 4 个点时标记 data_insufficient（置信度封顶 0.25），
 *     引擎据此把信号封顶为 wait，不再用 [C5, Steam] 拼接来伪装有历史。
 *  4. 置信度：叠加历史长度因子 + 量价确认微调。
 * P50 区间展开（波动率 + 正态分位数）与盈亏平衡 CDF 口径与 v1 保持一致。
 */
export const MODEL_VERSION_V2 = 'baseline-momentum-v2';

/** 市场事件类型：Steam 大促 / 游戏内活动 / Major 赛事 / 新箱子发布 / 箱子移除 / Valve 政策 */
export type MarketEventKind =
  | 'steam-sale'
  | 'game-event'
  | 'major'
  | 'case-release'
  | 'case-removal'
  | 'valve-policy';

/** 市场事件：对 7 天后目标日做窗口价差修正（与后端 services/prediction.py 对齐） */
export interface MarketEvent {
  kind: MarketEventKind;
  /** 事件名称（用于 features.event_names 展示） */
  name?: string;
  /** 开始日期（YYYY-MM-DD，UTC，含当天） */
  start: string;
  /** 结束日期（YYYY-MM-DD，UTC，含当天） */
  end: string;
  /** 窗口内压制幅度（默认 0.03 = 3%） */
  pressure?: number;
  /** 事件结束后回补天数（默认 14） */
  recoveryDays?: number;
}

export interface EventAdjustResult {
  /** 总价差乘数：1=无影响；<1 为压制；>1 为回补 */
  factor: number;
  /** 命中事件数 */
  count: number;
  /** 命中事件种类（去重、保序） */
  kinds: string[];
  /** 命中事件名称（去重、保序） */
  names: string[];
}

const _DAY_MS = 86400000;

function _dayNumAt(d: Date): number {
  return Math.floor(d.getTime() / _DAY_MS);
}

function _dayNumOf(s: string): number {
  return _dayNumAt(new Date(s + 'T00:00:00Z'));
}

/**
 * 计算 targetAt 的事件价差修正：
 * - targetAt 在事件窗口内（含首尾日）：× (1 - pressure)（大促期间价格被压制）
 * - targetAt 在事件结束后 recoveryDays 天内：× (1 + pressure × (1 - d / recoveryDays))，
 *   从结束日起线性回补到 0（价格回归常态）
 * - 其余情况：不修正（factor = 1）
 * 说明：prediction 模块本身不注入默认日历，events 由调用方（引擎层）传入；
 * 缺省为空数组时行为与旧版完全一致。
 */
export function computeEventAdjust(targetAt: Date, events: MarketEvent[]): EventAdjustResult {
  let factor = 1;
  let count = 0;
  const kinds: string[] = [];
  const names: string[] = [];
  const targetDay = _dayNumAt(targetAt);
  for (const ev of events) {
    const startDay = _dayNumOf(ev.start);
    const endDay = _dayNumOf(ev.end);
    const pressure = ev.pressure ?? 0.03;
    const recoveryDays = ev.recoveryDays ?? 14;
    let hit = false;
    if (targetDay >= startDay && targetDay <= endDay) {
      factor *= 1 - pressure;
      hit = true;
    } else {
      const d = targetDay - endDay;
      if (d > 0 && d <= recoveryDays) {
        factor *= 1 + pressure * (1 - d / recoveryDays);
        hit = true;
      }
    }
    if (hit) {
      count += 1;
      if (!kinds.includes(ev.kind)) kinds.push(ev.kind);
      const nm = (ev.name ?? '').trim();
      if (nm && !names.includes(nm)) names.push(nm);
    }
  }
  return { factor, count, kinds, names };
}

/** Steam 2026 官方大促日历（UTC 日期近似）：窗口内压制 3%，结束后 14 天内线性回补 */
export const STEAM_SALE_EVENTS_2026: MarketEvent[] = [
  { kind: 'steam-sale', name: 'Steam 春季特卖', start: '2026-03-19', end: '2026-03-26' },
  { kind: 'steam-sale', name: 'Steam 夏季特卖', start: '2026-06-25', end: '2026-07-09' },
  { kind: 'steam-sale', name: 'Steam 秋季特卖', start: '2026-10-01', end: '2026-10-08' },
  { kind: 'steam-sale', name: 'Steam 冬季特卖', start: '2026-12-17', end: '2027-01-04' },
];

export interface PredictV2Params {
  marketHashName: string;
  prices: number[];
  breakevenPrice?: number;
  itemId?: number | null;
  predictedAt?: Date;
  /** 最新 24h 成交量（Steam priceoverview volume） */
  volume?: number | null;
  /** 该商品历史成交量序列（含最新，升序），用于计算历史均量 */
  volumeHistory?: number[];
  /** Steam 热门榜排名（1 起） */
  popularRank?: number | null;
  /** 市场事件日历（Steam 大促等）：对 targetAt 做窗口价差修正；缺省不修正（保持与旧版一致） */
  events?: MarketEvent[];
}

/** 最小二乘斜率：xs（0..n-1）对 ys 的回归斜率 */
function leastSquaresSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  return den > 0 ? num / den : 0;
}

export class BaselinePredictorV2 {
  constructor(
    public horizonDays = 7,
    public trendDays = 7,
    public momentumDecay = 0.5,
    public minHistory = 15,
    public minTrendPoints = 4,
    public maxDailyDrift = 0.05,
  ) {}

  predict(params: PredictV2Params): PredictionResult {
    const { marketHashName, prices, breakevenPrice, itemId, predictedAt, volume, volumeHistory, popularRank, events } = params;
    if (prices.length < 1) {
      throw new Error('至少需要 1 条历史价格才能预测');
    }
    const latest = prices[prices.length - 1];
    const logReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) {
        logReturns.push(Math.log(prices[i] / prices[i - 1]));
      }
    }
    let vol = logReturns.length >= 2 ? pstdev(logReturns) : 0.05;
    if (prices.length < this.minHistory) {
      vol = Math.max(vol, 0.05) * 1.5;
    }

    // ---- 趋势：回归斜率（对数价格）或首末对数收益 ----
    const window = prices.slice(-this.trendDays);
    const insufficient = prices.length < this.minTrendPoints;
    let rawDrift = 0;
    let trendClamped = false;
    if (window.length >= 2) {
      if (window.length >= this.minTrendPoints) {
        const ys: number[] = [];
        const xs: number[] = [];
        for (let i = 0; i < window.length; i++) {
          xs.push(i);
          ys.push(Math.log(window[i]));
        }
        rawDrift = leastSquaresSlope(xs, ys);
      } else if (window[0] > 0) {
        rawDrift = Math.log(window[window.length - 1] / window[0]) / (window.length - 1);
      }
      if (rawDrift > this.maxDailyDrift) {
        rawDrift = this.maxDailyDrift;
        trendClamped = true;
      } else if (rawDrift < -this.maxDailyDrift) {
        rawDrift = -this.maxDailyDrift;
        trendClamped = true;
      }
    }

    // ---- 量价配合 ----
    let volumeRatio: number | null = null;
    let volumeConfirm = 1;
    if (volume != null && volume > 0 && volumeHistory != null && volumeHistory.length >= 2) {
      const base = volumeHistory.slice(0, -1);
      let sum = 0;
      let cnt = 0;
      for (const v of base) {
        if (v != null && v > 0) {
          sum += v;
          cnt++;
        }
      }
      const avg = cnt > 0 ? sum / cnt : 0;
      if (avg > 0) {
        volumeRatio = volume / avg;
        if (rawDrift > 0.0005 && volumeRatio >= 1.3) volumeConfirm = 1.15;
        else if (rawDrift > 0.0005 && volumeRatio <= 0.6) volumeConfirm = 0.85;
        else if (rawDrift < -0.0005 && volumeRatio >= 1.3) volumeConfirm = 1.15;
        else if (rawDrift < -0.0005 && volumeRatio <= 0.6) volumeConfirm = 0.85;
      }
    }
    const driftDaily = rawDrift * volumeConfirm;

    const drift = driftDaily * this.horizonDays * this.momentumDecay;
    const sigmaTotal = vol * Math.sqrt(this.horizonDays);
    const predAt = predictedAt ?? new Date();
    const targetAt = new Date(predAt.getTime() + this.horizonDays * 86400000);
    // ---- 事件窗口价差修正（Steam 大促等）：压制期 ×(1-pressure)，结束后 recoveryDays 内线性回补 ----
    const eventRes = computeEventAdjust(targetAt, events ?? []);
    const eventFactor = eventRes.factor;
    const p50 = latest * Math.exp(drift) * eventFactor;

    const quantiles: { p10: number; p25: number; p50: number; p75: number; p90: number } = { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
    for (const q of Object.keys(_Z) as (keyof typeof quantiles)[]) {
      quantiles[q] = Math.max(0, round2(p50 * Math.exp(_Z[q] * sigmaTotal), 4));
    }

    // ---- 盈利概率（与 v1 同口径） ----
    let probProfit = 0.5;
    if (breakevenPrice && breakevenPrice > 0) {
      if (sigmaTotal < 1e-9) {
        probProfit = p50 > breakevenPrice ? 1 : p50 < breakevenPrice ? 0 : 0.5;
      } else {
        const mu = Math.log(p50);
        probProfit = 1 - normalCdf((Math.log(breakevenPrice) - mu) / sigmaTotal);
      }
    }
    probProfit = Math.max(0, Math.min(1, probProfit));
    const probLoss = 1 - probProfit;

    // ---- 置信度：基数 + 历史长度因子 + 数据不足封顶 + 量价微调 ----
    let confidence = Math.max(0.1, Math.min(0.95, 1 - sigmaTotal * 3));
    const lenFactor = 0.6 + 0.4 * Math.min(1, Math.max(1, prices.length) / this.minHistory);
    confidence *= lenFactor;
    if (insufficient) {
      confidence = Math.min(confidence, 0.25);
    }
    if (volumeConfirm !== 1) {
      confidence = Math.max(0.1, Math.min(0.95, confidence + (volumeConfirm > 1 ? 0.05 : -0.05)));
    }
    confidence = round2(confidence, 4);

    // 事件命中：对大促等事件窗口内的预测打 9 折置信度（保留 0.1~0.95 封顶）
    if (eventRes.count > 0) {
      confidence = Math.max(0.1, Math.min(0.95, confidence * 0.9));
      confidence = round2(confidence, 4);
    }

    // 与 v1 同语义的 7 点窗口动量（供 UI 趋势结论复用）
    let momentum = 0;
    const anchorIdx = Math.max(0, prices.length - this.trendDays);
    if (prices.length >= 2 && prices[anchorIdx] > 0) {
      momentum = Math.log(latest / prices[anchorIdx]);
    }

    const features: Record<string, number | string | boolean> = {
      latest_price: round2(latest, 4),
      momentum: round2(momentum, 6),
      trend_daily: round2(rawDrift, 6),
      volatility: round2(vol, 6),
      history_len: prices.length,
      data_insufficient: insufficient,
      trend_clamped: trendClamped,
      volume_confirm: volumeConfirm,
    };
    if (volumeRatio != null) features.volume_ratio = round2(volumeRatio, 3);
    if (popularRank != null && popularRank > 0) features.popular_rank = popularRank;
    if (eventRes.count > 0) {
      features.event_active = true;
      features.event_count = eventRes.count;
      features.event_adjust = round2(eventFactor - 1, 6);
      features.event_kinds = eventRes.kinds.join(',');
      features.event_names = eventRes.names.join(',');
    }

    return {
      item_id: itemId ?? null,
      market_hash_name: marketHashName,
      model_version: MODEL_VERSION_V2,
      predicted_at: predAt.toISOString(),
      target_at: targetAt.toISOString(),
      horizon_days: this.horizonDays,
      p10: quantiles.p10,
      p25: quantiles.p25,
      p50: quantiles.p50,
      p75: quantiles.p75,
      p90: quantiles.p90,
      prob_profit: round2(probProfit, 4),
      prob_loss: round2(probLoss, 4),
      confidence,
      features,
    };
  }
}