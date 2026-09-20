/** Phase 2 数据质量：只描述数据可靠程度，不决定 buy/watch/avoid。 */

export interface MarketQualityConfig {
  staleAfterMs: number;
  minQuality: number;
}

export interface MarketQualityInput {
  now: number;
  c5FetchedAt: number;
  steamFetchedAt: number;
  steamQuality?: number;
  c5DataAvailable?: boolean;
  buyLevelsCount: number;
  crossedBook: boolean;
  partialFill: boolean;
  dataWarnings?: string[];
}

export interface MarketQuality {
  score: number;
  stale: boolean;
  reasons: string[];
}

export interface ForecastQuality {
  available: boolean;
  score?: number;
  reasons: string[];
}

export const DEFAULT_MARKET_QUALITY_CONFIG: MarketQualityConfig = Object.freeze({
  staleAfterMs: 10 * 60 * 1000,
  minQuality: 0.60,
});

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function stale(now: number, fetchedAt: number, staleAfterMs: number): boolean {
  const n = finite(now);
  const fetched = finite(fetchedAt);
  return n == null || fetched == null || fetched <= 0 || n - fetched > staleAfterMs;
}

export function calcDataQuality(
  input: MarketQualityInput,
  config: MarketQualityConfig = DEFAULT_MARKET_QUALITY_CONFIG,
): MarketQuality {
  const reasons: string[] = [];
  let score = 1;
  const staleAfterMs = finite(config.staleAfterMs);
  const minQuality = finite(config.minQuality);
  const safeStaleAfterMs = staleAfterMs != null && staleAfterMs >= 0 ? staleAfterMs : DEFAULT_MARKET_QUALITY_CONFIG.staleAfterMs;
  const safeMinQuality = minQuality != null ? Math.max(0, Math.min(1, minQuality)) : DEFAULT_MARKET_QUALITY_CONFIG.minQuality;

  const steamStale = stale(input.now, input.steamFetchedAt, safeStaleAfterMs);
  const c5Stale = stale(input.now, input.c5FetchedAt, safeStaleAfterMs);
  if (steamStale) {
    score -= 0.25;
    addReason(reasons, 'steam_stale');
  }
  if (c5Stale) {
    score -= 0.20;
    addReason(reasons, 'c5_stale');
  }
  if (input.c5DataAvailable === false) {
    score -= 0.20;
    addReason(reasons, 'c5_data_missing');
  }
  if (!Number.isFinite(input.buyLevelsCount) || input.buyLevelsCount <= 0) {
    score -= 0.30;
    addReason(reasons, 'buy_book_empty');
  }
  if (input.crossedBook) {
    score -= 0.30;
    addReason(reasons, 'crossed_book');
  }
  if (input.partialFill) {
    score -= 0.15;
    addReason(reasons, 'partial_fill');
  }
  if ((input.dataWarnings ?? []).some((warning) => /^invalid_|^malformed_|^empty_book/.test(warning))) {
    score -= 0.15;
    addReason(reasons, 'market_data_invalid');
  }
  const steamQuality = finite(input.steamQuality);
  if (steamQuality != null && steamQuality < safeMinQuality) {
    score -= safeMinQuality - Math.max(0, steamQuality);
    addReason(reasons, 'steam_quality_low');
  }
  score = Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0));
  return { score, stale: steamStale || c5Stale, reasons };
}

/** 第一版只区分 forecast 是否可用，并透传 V4 confidence，不设计新的预测评分模型。 */
export function calcForecastQuality(input: {
  available: boolean;
  confidence?: number;
  reasons?: string[];
}): ForecastQuality {
  const reasons = input.reasons ? input.reasons.slice() : [];
  const confidence = finite(input.confidence);
  return {
    available: input.available,
    ...(confidence != null ? { score: Math.max(0, Math.min(1, confidence)) } : {}),
    reasons,
  };
}
