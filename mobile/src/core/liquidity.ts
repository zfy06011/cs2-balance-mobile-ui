/**
 * Liquidity Engine v1：盘口归一化、卖入买盘撮合、VWAP、滑点和可执行容量。
 * 纯函数，无网络、数据库和 React Native 依赖。
 */
import type { OrderbookLevel } from '../providers/steam/steamOrderbook';

export type OrderbookSide = 'buy' | 'sell';

export interface NormalizedOrderbook {
  levels: OrderbookLevel[];
  warnings: string[];
}

export interface SellSimulation {
  requestedQuantity: number;
  filledQuantity: number;
  unfilledQuantity: number;
  grossProceeds: number;
  averageSellPrice?: number;
  worstFillPrice?: number;
  bestPrice?: number;
  slippagePct?: number;
  warnings: string[];
}

export interface SpreadResult {
  spread: number;
  spreadPct: number;
  warnings: string[];
}

export interface ExecutableQuantityResult {
  depthQuantity: number;
  executableQuantity: number;
  priceFloor: number;
  warnings: string[];
}

export interface LiquidityConfig {
  maxBookImpactPct: number;
  maxBookParticipationPct: number;
}

export const DEFAULT_LIQUIDITY_CONFIG: LiquidityConfig = Object.freeze({
  maxBookImpactPct: 0.01,
  maxBookParticipationPct: 0.20,
});

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value: unknown): number | null {
  const n = finite(value);
  return n != null && n > 0 ? n : null;
}

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}

/**
 * Engine 不信任上游 cumulativeQuantity，也不信任上游排序。
 * 重复价格档位会合并，数量只使用 price/quantity 两个字段。
 */
export function normalizeOrderbookLevels(
  input: readonly OrderbookLevel[] | null | undefined,
  side: OrderbookSide,
): NormalizedOrderbook {
  const warnings: string[] = [];
  const byPrice = new Map<number, number>();
  if (!Array.isArray(input)) {
    addWarning(warnings, 'empty_book');
    return { levels: [], warnings };
  }

  for (const level of input) {
    const price = positive(level?.price);
    const quantity = finite(level?.quantity);
    if (price == null) {
      addWarning(warnings, 'invalid_level_price');
      continue;
    }
    if (quantity == null || quantity <= 0) {
      addWarning(warnings, 'invalid_level_quantity');
      continue;
    }
    byPrice.set(price, (byPrice.get(price) ?? 0) + quantity);
  }

  const levels = [...byPrice.entries()]
    .sort((a, b) => side === 'buy' ? b[0] - a[0] : a[0] - b[0])
    .map(([price, quantity]) => ({ price, quantity, cumulativeQuantity: 0 }));

  let cumulative = 0;
  for (const level of levels) {
    cumulative += level.quantity;
    level.cumulativeQuantity = cumulative;
  }
  if (levels.length === 0) addWarning(warnings, 'empty_book');
  return { levels, warnings };
}

/** 按最高买单开始逐档吃买盘，返回真实成交量和 VWAP。 */
export function simulateSellIntoBuyBook(
  levels: readonly OrderbookLevel[] | null | undefined,
  quantity: number,
): SellSimulation {
  const normalized = normalizeOrderbookLevels(levels, 'buy');
  const warnings = normalized.warnings.slice();
  const requested = positive(quantity);
  if (requested == null) {
    addWarning(warnings, 'invalid_quantity');
    return {
      requestedQuantity: 0,
      filledQuantity: 0,
      unfilledQuantity: 0,
      grossProceeds: 0,
      warnings,
    };
  }

  let remaining = requested;
  let filled = 0;
  let gross = 0;
  let worstFillPrice: number | undefined;
  const bestPrice = normalized.levels[0]?.price;
  for (const level of normalized.levels) {
    if (remaining <= 0) break;
    const fill = Math.min(level.quantity, remaining);
    if (fill <= 0) continue;
    filled += fill;
    gross += fill * level.price;
    remaining -= fill;
    worstFillPrice = level.price;
  }

  const unfilled = Math.max(0, requested - filled);
  if (unfilled > 0) addWarning(warnings, 'partial_fill');
  const average = filled > 0 ? gross / filled : undefined;
  const slippage = bestPrice != null && average != null && bestPrice > 0
    ? Math.max(0, (bestPrice - average) / bestPrice)
    : undefined;
  return {
    requestedQuantity: requested,
    filledQuantity: filled,
    unfilledQuantity: unfilled,
    grossProceeds: Number.isFinite(gross) ? gross : 0,
    averageSellPrice: average != null && Number.isFinite(average) ? average : undefined,
    worstFillPrice,
    bestPrice,
    slippagePct: slippage != null && Number.isFinite(slippage) ? slippage : undefined,
    warnings,
  };
}

/** spreadPct 按 Phase 2 口径使用 lowestSell 作为分母。 */
export function calcSpread(highestBuy: number, lowestSell: number): SpreadResult {
  const warnings: string[] = [];
  const high = positive(highestBuy);
  const low = positive(lowestSell);
  if (high == null || low == null) {
    addWarning(warnings, 'invalid_spread');
    return { spread: 0, spreadPct: 0, warnings };
  }
  if (high > low) addWarning(warnings, 'crossed_book');
  const spread = low - high;
  const spreadPct = spread / low;
  return {
    spread: Number.isFinite(spread) ? spread : 0,
    spreadPct: Number.isFinite(spreadPct) ? spreadPct : 0,
    warnings,
  };
}

/**
 * 统计最高买单下方 maxBookImpactPct 内的买盘，再应用最大市场参与比例。
 * C5 availableQuantity=0 会明确把可执行数量限制为 0。
 */
export function calcExecutableQuantity(
  levels: readonly OrderbookLevel[] | null | undefined,
  highestBuy: number,
  availableQuantity: number | undefined,
  config: LiquidityConfig = DEFAULT_LIQUIDITY_CONFIG,
): ExecutableQuantityResult {
  const normalized = normalizeOrderbookLevels(levels, 'buy');
  const warnings = normalized.warnings.slice();
  const high = positive(highestBuy);
  if (high == null) {
    addWarning(warnings, 'invalid_highest_buy');
    return { depthQuantity: 0, executableQuantity: 0, priceFloor: 0, warnings };
  }

  const impact = finite(config.maxBookImpactPct);
  const participation = finite(config.maxBookParticipationPct);
  const safeImpact = impact == null ? DEFAULT_LIQUIDITY_CONFIG.maxBookImpactPct : Math.max(0, Math.min(1, impact));
  const safeParticipation = participation == null ? DEFAULT_LIQUIDITY_CONFIG.maxBookParticipationPct : Math.max(0, Math.min(1, participation));
  if (impact == null || impact < 0 || impact > 1) addWarning(warnings, 'invalid_book_impact_config');
  if (participation == null || participation < 0 || participation > 1) addWarning(warnings, 'invalid_participation_config');

  const priceFloor = high * (1 - safeImpact);
  const epsilon = Math.max(1e-9, high * 1e-12);
  let depthQuantity = 0;
  for (const level of normalized.levels) {
    if (level.price + epsilon >= priceFloor) depthQuantity += level.quantity;
  }
  let executableQuantity = Math.max(0, Math.floor(depthQuantity * safeParticipation));

  if (availableQuantity !== undefined) {
    const available = finite(availableQuantity);
    if (available == null || available < 0) {
      addWarning(warnings, 'invalid_c5_available_quantity');
      executableQuantity = 0;
    } else {
      executableQuantity = Math.min(executableQuantity, Math.floor(available));
    }
  }
  return {
    depthQuantity: Number.isFinite(depthQuantity) ? depthQuantity : 0,
    executableQuantity: Number.isFinite(executableQuantity) ? Math.max(0, executableQuantity) : 0,
    priceFloor: Number.isFinite(priceFloor) ? priceFloor : 0,
    warnings,
  };
}

export function calcExecutableBudget(
  executableQuantity: number,
  unitPrice: number,
  feeRatio: number,
): number {
  const quantity = positive(executableQuantity) ?? 0;
  const price = positive(unitPrice) ?? 0;
  const fee = finite(feeRatio);
  const safeFee = fee != null && fee >= 0 ? fee : 0;
  const budget = quantity * price * (1 + safeFee);
  return Number.isFinite(budget) ? budget : 0;
}

