/**
 * Discount Engine v2：将 C5 成本、Steam 买盘、V4 预测映射为可解释的余额转换结果。
 * 纯函数；本阶段不接入 UI、collector、radar 或主 API。
 */
import type { OrderbookLevel } from '../providers/steam/steamOrderbook';
import { DEFAULT_FEES, STEAM_FEE_MODEL, type SteamFeeModelMetadata } from './fees';
import { ProfitCalculator } from './profit';
import {
  calcExecutableBudget,
  calcExecutableQuantity,
  calcSpread,
  DEFAULT_LIQUIDITY_CONFIG,
  simulateSellIntoBuyBook,
  type LiquidityConfig,
} from './liquidity';
import {
  calcDataQuality,
  calcForecastQuality,
  DEFAULT_MARKET_QUALITY_CONFIG,
  type ForecastQuality,
  type MarketQuality,
  type MarketQualityConfig,
} from './marketQuality';

export interface DiscountInput {
  item: string;
  c5: {
    unitPrice: number;
    feeRatio: number;
    availableQuantity?: number;
    fetchedAt: number;
  };
  steam: {
    highestBuy: number;
    lowestSell: number;
    buyLevels: OrderbookLevel[];
    sellLevels: OrderbookLevel[];
    fetchedAt: number;
    currency?: 'CNY';
    currencyId?: 23;
    quality?: number;
  };
  forecast?: {
    p25: number;
    p50: number;
    p75: number;
    marketState?: 'STABLE' | 'RISING' | 'FALLING' | 'CHAOS' | string;
    confidence?: number;
  };
  quantity: number;
  now?: number;
  config?: Partial<DiscountV2Config>;
}

export interface DiscountScenario {
  grossPerUnit: number;
  netPerUnit: number;
  totalNet: number;
  discount: number;
}

export interface CurrentDiscountScenario {
  // 旧字段保留；部分成交时 discount 为 undefined，禁止误报整仓折扣。
  grossPerUnit: number;
  netPerUnit: number;
  totalNet: number;
  discount?: number;
  filledQuantity: number;
  requestedQuantity: number;
  liquidationCoverage: number;
  filledGross: number;
  filledNet: number;
  filledDiscount?: number;
  fullPositionDiscount?: number;
}

export interface FutureModelMetadata {
  orderbookPredicted: false;
  liquidityGuaranteed: false;
  usesCurrentBuySellRatio: true;
  currentBuySellRatio: number;
  ratioKind: 'current_market_heuristic';
}

export interface CurrentLiquidityCapacity {
  scope: 'current_market_structure';
  executableQuantity: number;
  executableBudget: number;
}

export interface DiscountResult {
  item: string;
  quantity: number;
  current: CurrentDiscountScenario;
  conservative7d?: DiscountScenario;
  expected7d?: DiscountScenario;
  listing7d?: DiscountScenario;
  futureModel?: FutureModelMetadata;
  // 旧 liquidity 字段保留兼容；其 executable* 只描述当前盘口。
  liquidity: {
    spread: number;
    spreadPct: number;
    currentVwap?: number;
    slippagePct?: number;
    executableQuantity: number;
    executableBudget: number;
    filledQuantity: number;
    unfilledQuantity: number;
  };
  currentLiquidityCapacity: CurrentLiquidityCapacity;
  marketDataQuality: MarketQuality;
  forecastQuality: ForecastQuality;
  feeModel: SteamFeeModelMetadata;
  // 旧 quality.score/stale/reasons 保留映射，Phase 3 可逐步消费拆分字段。
  quality: {
    score: number;
    stale: boolean;
    reasons: string[];
    marketData: MarketQuality;
    forecast: ForecastQuality;
    overall: number;
  };
  warnings: string[];
}

export interface DiscountV2Config extends LiquidityConfig, MarketQualityConfig {}

export const DEFAULT_DISCOUNT_V2_CONFIG: DiscountV2Config = Object.freeze({
  ...DEFAULT_LIQUIDITY_CONFIG,
  ...DEFAULT_MARKET_QUALITY_CONFIG,
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

function safeNumber(value: number | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0;
}

function scenario(
  grossPerUnit: number,
  quantity: number,
  totalCost: number,
  calculator: ProfitCalculator,
): DiscountScenario {
  const gross = positive(grossPerUnit) ?? 0;
  const totalGross = gross * quantity;
  const totalNet = calculator.steamNetReceive(totalGross);
  const netPerUnit = quantity > 0 ? totalNet / quantity : 0;
  const discount = totalNet > 0 && Number.isFinite(totalNet) ? totalCost / totalNet : 0;
  return {
    grossPerUnit: safeNumber(gross),
    netPerUnit: safeNumber(netPerUnit),
    totalNet: safeNumber(totalNet),
    discount: safeNumber(discount),
  };
}

function forecastValid(forecast: DiscountInput['forecast']): forecast is NonNullable<DiscountInput['forecast']> {
  if (!forecast) return false;
  const p25 = positive(forecast.p25);
  const p50 = positive(forecast.p50);
  const p75 = positive(forecast.p75);
  return p25 != null && p50 != null && p75 != null && p25 <= p50 && p50 <= p75;
}

/**
 * 构建四套折扣：current、conservative7d、expected7d、listing7d。
 * 未来场景只模拟预测单位价格，不假装拥有未来订单簿深度。
 */
export function buildDiscountV2(input: DiscountInput): DiscountResult {
  const config: DiscountV2Config = { ...DEFAULT_DISCOUNT_V2_CONFIG, ...(input.config ?? {}) };
  const warnings: string[] = ['steam_fee_model_approximate'];
  const rawQuantity = positive(input.quantity);
  const quantity = rawQuantity ?? 0;
  if (rawQuantity == null) addWarning(warnings, 'invalid_quantity');

  const c5UnitPrice = positive(input.c5?.unitPrice);
  const c5FeeRatio = finite(input.c5?.feeRatio);
  const feeRatio = c5FeeRatio != null && c5FeeRatio >= 0 ? c5FeeRatio : DEFAULT_FEES.c5_buy_fee_ratio;
  if (c5UnitPrice == null) addWarning(warnings, 'invalid_c5_unit_price');
  if (c5FeeRatio == null || c5FeeRatio < 0) addWarning(warnings, 'invalid_c5_fee_ratio');

  // 复用现有 ProfitCalculator 的唯一手续费公式；不在 Phase 2 复制费率常数。
  const calculator = new ProfitCalculator(feeRatio, DEFAULT_FEES.steam_seller_receive_ratio);
  const effectiveUnitCost = c5UnitPrice != null ? calculator.c5TotalCost(c5UnitPrice) : 0;
  const totalCost = effectiveUnitCost * quantity;

  const simulation = simulateSellIntoBuyBook(input.steam?.buyLevels, quantity);
  for (const warning of simulation.warnings) addWarning(warnings, warning);
  const spread = calcSpread(input.steam?.highestBuy, input.steam?.lowestSell);
  for (const warning of spread.warnings) addWarning(warnings, warning);
  const crossedBook = spread.warnings.includes('crossed_book');
  const filledGross = simulation.grossProceeds;
  const filledNet = calculator.steamNetReceive(filledGross);
  const liquidationCoverage = quantity > 0
    ? Math.max(0, Math.min(1, simulation.filledQuantity / quantity))
    : 0;
  const filledC5Cost = effectiveUnitCost * simulation.filledQuantity;
  const filledDiscount = filledNet > 0 && Number.isFinite(filledNet)
    ? filledC5Cost / filledNet
    : undefined;
  const fullyFilled = quantity > 0 && simulation.filledQuantity === quantity && simulation.unfilledQuantity === 0;
  const fullPositionDiscount = fullyFilled ? filledDiscount : undefined;
  const current: CurrentDiscountScenario = {
    grossPerUnit: safeNumber(simulation.averageSellPrice),
    netPerUnit: simulation.filledQuantity > 0 ? safeNumber(filledNet / simulation.filledQuantity) : 0,
    totalNet: safeNumber(filledNet),
    discount: fullPositionDiscount,
    filledQuantity: simulation.filledQuantity,
    requestedQuantity: quantity,
    liquidationCoverage: safeNumber(liquidationCoverage),
    filledGross: safeNumber(filledGross),
    filledNet: safeNumber(filledNet),
    filledDiscount: filledDiscount != null && Number.isFinite(filledDiscount) ? filledDiscount : undefined,
    fullPositionDiscount: fullPositionDiscount != null && Number.isFinite(fullPositionDiscount) ? fullPositionDiscount : undefined,
  };

  const executable = calcExecutableQuantity(
    input.steam?.buyLevels,
    input.steam?.highestBuy,
    input.c5?.availableQuantity,
    config,
  );
  for (const warning of executable.warnings) addWarning(warnings, warning);
  const executableBudget = calcExecutableBudget(executable.executableQuantity, c5UnitPrice ?? 0, feeRatio);
  const currentLiquidityCapacity: CurrentLiquidityCapacity = {
    scope: 'current_market_structure',
    executableQuantity: executable.executableQuantity,
    executableBudget: safeNumber(executableBudget),
  };

  const forecast = input.forecast;
  const forecastIsValid = forecastValid(forecast);
  let forecastReasons: string[] = [];
  if (!forecast) {
    forecastReasons = ['forecast_missing'];
    addWarning(warnings, 'forecast_missing');
  } else if (!forecastIsValid) {
    forecastReasons = ['invalid_forecast'];
    addWarning(warnings, 'invalid_forecast');
  }
  const forecastQuality = calcForecastQuality({
    available: forecastIsValid,
    confidence: forecastIsValid ? forecast.confidence : undefined,
    reasons: forecastReasons,
  });

  let conservative7d: DiscountScenario | undefined;
  let expected7d: DiscountScenario | undefined;
  let listing7d: DiscountScenario | undefined;
  let futureModel: FutureModelMetadata | undefined;
  if (forecastIsValid) {
    const high = positive(input.steam?.highestBuy);
    const low = positive(input.steam?.lowestSell);
    const currentBuySellRatio = high != null && low != null ? high / low : 0;
    if (currentBuySellRatio <= 0 || currentBuySellRatio > 1 || !Number.isFinite(currentBuySellRatio)) {
      addWarning(warnings, 'invalid_buy_sell_ratio');
    } else {
      conservative7d = scenario(forecast.p25 * currentBuySellRatio, quantity, totalCost, calculator);
      expected7d = scenario(forecast.p50 * currentBuySellRatio, quantity, totalCost, calculator);
      // listing7d 直接使用 V4 P50：表示愿意等待挂单成交的理论市场价格。
      listing7d = scenario(forecast.p50, quantity, totalCost, calculator);
      futureModel = {
        orderbookPredicted: false,
        liquidityGuaranteed: false,
        usesCurrentBuySellRatio: true,
        currentBuySellRatio,
        ratioKind: 'current_market_heuristic',
      };
      addWarning(warnings, 'future_book_depth_not_modeled');
      addWarning(warnings, 'future_orderbook_not_predicted');
      addWarning(warnings, 'future_liquidity_not_guaranteed');
    }
  }

  const explicitNow = finite(input.now);
  const fetchedTimes = [finite(input.c5?.fetchedAt), finite(input.steam?.fetchedAt)]
    .filter((value): value is number => value != null);
  const now = explicitNow != null ? explicitNow : fetchedTimes.length > 0 ? Math.max(...fetchedTimes) : 0;
  const marketDataQuality = calcDataQuality({
    now,
    c5FetchedAt: input.c5?.fetchedAt,
    steamFetchedAt: input.steam?.fetchedAt,
    steamQuality: input.steam?.quality,
    c5DataAvailable: c5UnitPrice != null,
    buyLevelsCount: input.steam?.buyLevels?.length ?? 0,
    crossedBook,
    partialFill: simulation.unfilledQuantity > 0,
    dataWarnings: [...simulation.warnings, ...spread.warnings, ...executable.warnings],
  }, config);
  const overall = safeNumber(marketDataQuality.score * (forecastQuality.score ?? 1));
  const qualityReasons = [...marketDataQuality.reasons, ...forecastQuality.reasons];
  const quality = {
    score: overall,
    stale: marketDataQuality.stale,
    reasons: qualityReasons,
    marketData: marketDataQuality,
    forecast: forecastQuality,
    overall,
  };

  return {
    item: input.item ?? '',
    quantity,
    current,
    ...(conservative7d ? { conservative7d } : {}),
    ...(expected7d ? { expected7d } : {}),
    ...(listing7d ? { listing7d } : {}),
    ...(futureModel ? { futureModel } : {}),
    liquidity: {
      spread: safeNumber(spread.spread),
      spreadPct: safeNumber(spread.spreadPct),
      ...(simulation.averageSellPrice != null ? { currentVwap: simulation.averageSellPrice } : {}),
      ...(simulation.slippagePct != null ? { slippagePct: simulation.slippagePct } : {}),
      executableQuantity: executable.executableQuantity,
      executableBudget: safeNumber(executableBudget),
      filledQuantity: simulation.filledQuantity,
      unfilledQuantity: simulation.unfilledQuantity,
    },
    currentLiquidityCapacity,
    marketDataQuality,
    forecastQuality,
    feeModel: STEAM_FEE_MODEL,
    quality,
    warnings,
  };
}
