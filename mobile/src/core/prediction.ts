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
