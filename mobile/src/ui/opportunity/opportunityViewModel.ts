import type { OpportunityDecision } from '../../core/types/opportunity';
import type { ProductionOpportunityItem, ProductionOpportunitySnapshot } from '../../data/opportunityProduction';
import { displayNameOf } from '../../utils/format';
import { CAP_LABELS, GATE_LABELS, REASON_LABELS, WARNING_LABELS, decisionLabel, labelForCode, legacySignalLabel } from './opportunityLabels';
import { formatCapacity, formatDiscount, formatFreshness, formatMarketState, formatMoney, formatScore, formatSpread } from './opportunityFormatters';
import { DEFAULT_FEES } from '../../core/fees';

export interface OpportunityCardViewModel {
  item: string;
  displayNameZh: string;
  decision: OpportunityDecision | 'legacy';
  decisionLabel: string;
  /** 旧 Radar signal 只用于 legacy/shadow 的兼容展示。 */
  legacySignal?: string;
  score?: number;
  scoreText?: string;
  expectedDiscountText?: string;
  conservativeDiscountText?: string;
  currentDiscountText?: string;
  currentFilledDiscountText?: string;
  listingDiscountText?: string;
  suggestedMaxBudgetText?: string;
  capacityText?: string;
  spreadText?: string;
  marketStateText?: string;
  freshness: 'fresh' | 'stale' | 'fallback' | 'missing';
  freshnessLabel?: string;
  primaryReason?: string;
  warningLabels: string[];
  lowPriceApproxFee: boolean;
  futureLiquidityNotGuaranteed: boolean;
  c5BuyPriceText?: string;
  steamSellPriceText?: string;
  steamHighestBuyText?: string;
  steamNetReceiveText?: string;
  netProfitText?: string;
  expectedRoiText?: string;
  steamVolumeText?: string;
  riskText?: string;
  liquidityText?: string;
  dataInsufficient?: boolean;
  isDemo?: boolean;
}

function codesToLabels(codes: string[], kind: 'reason' | 'warning' | 'cap' | 'gate'): string[] {
  return codes.map((code) => labelForCode(code, kind));
}

function freshnessOf(item: ProductionOpportunityItem, snapshot: ProductionOpportunitySnapshot): OpportunityCardViewModel['freshness'] {
  if (item.diagnostics.fallbackUsed) return 'fallback';
  if (item.diagnostics.stale || snapshot.diagnostics.stale) return 'stale';
  if (snapshot.mode === 'legacy' && item.legacy) return 'fresh';
  if (item.diagnostics.forecastStatus !== 'ready' || item.diagnostics.c5Status !== 'ready' || item.diagnostics.orderbookStatus === 'failed') return 'missing';
  return 'fresh';
}

function effectiveDecisionOf(
  item: ProductionOpportunityItem,
  snapshot: ProductionOpportunitySnapshot,
  freshness: OpportunityCardViewModel['freshness'],
): OpportunityCardViewModel['decision'] {
  if (snapshot.mode !== 'v2' || !item.v2) return 'legacy';
  if (item.v2.decision !== 'buy' && item.v2.decision !== 'excellent') return item.v2.decision;
  if (freshness === 'stale') return 'watch';
  if (freshness !== 'fresh' || item.diagnostics.forecastStatus !== 'ready' || item.diagnostics.c5Status !== 'ready') return 'watch';
  if (item.diagnostics.orderbookStatus !== 'live' && item.diagnostics.orderbookStatus !== 'cache_fresh') return 'watch';
  return item.v2.decision;
}

export function toOpportunityCardViewModel(item: ProductionOpportunityItem, snapshot: ProductionOpportunitySnapshot): OpportunityCardViewModel {
  const freshness = freshnessOf(item, snapshot);
  const legacy = item.legacy;
  const v2 = item.v2;
  const isV2Visible = snapshot.mode === 'v2' && v2 != null;
  const decision = effectiveDecisionOf(item, snapshot, freshness);
  const allWarnings = v2 ? [
    ...codesToLabels(v2.warnings, 'warning'),
    ...codesToLabels(v2.hardGates, 'gate'),
    ...codesToLabels(v2.caps, 'cap'),
  ] : [];
  const uniqueWarnings = [...new Set(allWarnings)];
  const dataReason = freshness === 'stale'
    ? labelForCode('market_data_stale', 'cap')
    : freshness === 'missing' && item.diagnostics.orderbookStatus === 'failed'
      ? labelForCode('orderbook_missing', 'warning')
      : freshness === 'missing' && item.diagnostics.forecastStatus !== 'ready'
        ? labelForCode('forecast_missing', 'warning')
        : freshness === 'missing' && item.diagnostics.c5Status !== 'ready'
          ? labelForCode('c5_supply_missing', 'warning')
          : undefined;
  const primaryReason = dataReason ?? (v2
    ? (v2.hardGates[0] ? labelForCode(v2.hardGates[0], 'gate') : v2.caps[0] ? labelForCode(v2.caps[0], 'cap') : v2.reasons[0] ? labelForCode(v2.reasons[0], 'reason') : uniqueWarnings[0])
    : (legacy?.dataInsufficient ? '历史数据不足，旧版信号已保守处理' : undefined));
  const partial = v2?.currentRequestedQuantity != null
    && v2.currentFilledQuantity != null
    && v2.currentRequestedQuantity > 0
    && v2.currentFilledQuantity < v2.currentRequestedQuantity;
  const lowPriceApproxFee = v2?.caps.includes('approximate_fee_low_price_cap_watch') === true;
  const futureLiquidityNotGuaranteed = v2?.warnings.includes('future_orderbook_not_predicted') === true
    || v2?.warnings.includes('future_liquidity_not_guaranteed') === true;
  const steamNetReceive = isV2Visible && v2?.steamLowestSell != null
    ? v2.steamLowestSell * DEFAULT_FEES.steam_seller_receive_ratio
    : legacy?.steamNetReceive;
  const c5BuyPrice = isV2Visible ? v2?.c5BuyPrice : legacy?.c5BuyPrice;
  const netProfit = isV2Visible && c5BuyPrice != null && steamNetReceive != null
    ? steamNetReceive - c5BuyPrice
    : legacy?.netProfit;
  return {
    item: item.item,
    displayNameZh: displayNameOf(item.item),
    decision,
    decisionLabel: isV2Visible ? decisionLabel(decision === 'legacy' ? 'avoid' : decision) : legacySignalLabel(legacy?.signal),
    legacySignal: freshness === 'fallback' && legacy?.signal === 'buy' ? 'wait' : legacy?.signal,
    score: isV2Visible ? v2.score : legacy?.score,
    scoreText: formatScore(isV2Visible ? v2.score : legacy?.score),
    expectedDiscountText: formatDiscount(isV2Visible ? v2.expectedDiscount : legacy?.expectedDiscount),
    conservativeDiscountText: formatDiscount(isV2Visible ? v2.conservativeDiscount : undefined),
    currentDiscountText: partial ? `当前盘口仅可成交 ${Math.round((v2.liquidationCoverage ?? 0) * 100)}%` : formatDiscount(v2?.currentDiscount),
    currentFilledDiscountText: partial ? `已成交部分约 ${formatDiscount(v2?.filledDiscount)}` : undefined,
    listingDiscountText: formatDiscount(v2?.listingDiscount),
    suggestedMaxBudgetText: formatMoney(v2?.suggestedMaxBudget),
    capacityText: formatCapacity(v2?.executableBudget),
    spreadText: formatSpread(v2?.spreadPct),
    marketStateText: formatMarketState(v2?.marketState),
    freshness,
    freshnessLabel: formatFreshness(freshness) || undefined,
    primaryReason,
    warningLabels: uniqueWarnings,
    lowPriceApproxFee,
    futureLiquidityNotGuaranteed,
    c5BuyPriceText: formatMoney(c5BuyPrice),
    steamSellPriceText: formatMoney(isV2Visible ? v2.steamLowestSell : legacy?.steamSellPrice),
    steamHighestBuyText: formatMoney(isV2Visible ? v2.steamHighestBuy : undefined),
    steamNetReceiveText: formatMoney(steamNetReceive),
    netProfitText: formatMoney(netProfit),
    expectedRoiText: legacy?.expectedRoi == null ? '--' : `${(legacy.expectedRoi * 100).toFixed(1)}%`,
    steamVolumeText: legacy?.steamVolume == null ? '--' : String(legacy.steamVolume),
    riskText: legacy?.riskLevel,
    liquidityText: legacy?.liquidity,
    dataInsufficient: legacy?.dataInsufficient,
    isDemo: snapshot.isDemo === true,
  };
}

export interface OpportunitySelectorOptions {
  query?: string;
  decision?: OpportunityDecision | 'legacy';
  sort?: 'snapshot' | 'decision' | 'discount' | 'capacity';
}

function decisionRank(decision: OpportunityCardViewModel['decision']): number {
  return decision === 'excellent' ? 4 : decision === 'buy' ? 3 : decision === 'watch' ? 2 : decision === 'avoid' ? 1 : 0;
}

export function selectOpportunityCards(snapshot: ProductionOpportunitySnapshot, options: OpportunitySelectorOptions = {}): OpportunityCardViewModel[] {
  const query = options.query?.trim().toLowerCase() ?? '';
  const cards = snapshot.items
    .map((item) => toOpportunityCardViewModel(item, snapshot))
    .filter((card) => !query || card.item.toLowerCase().includes(query) || card.displayNameZh.toLowerCase().includes(query))
    .filter((card) => options.decision == null || card.decision === options.decision);
  if (!options.sort || options.sort === 'snapshot') return cards;
  return cards.slice().sort((a, b) => {
    if (options.sort === 'decision') return decisionRank(b.decision) - decisionRank(a.decision) || (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.item.localeCompare(b.item);
    const aDiscount = a.expectedDiscountText === '--' ? Infinity : Number(a.expectedDiscountText?.replace(' 折', ''));
    const bDiscount = b.expectedDiscountText === '--' ? Infinity : Number(b.expectedDiscountText?.replace(' 折', ''));
    if (options.sort === 'discount') return aDiscount - bDiscount || a.item.localeCompare(b.item);
    const aCapacity = Number(a.capacityText?.replace(/[^0-9.]/g, '')) || 0;
    const bCapacity = Number(b.capacityText?.replace(/[^0-9.]/g, '')) || 0;
    return bCapacity - aCapacity || a.item.localeCompare(b.item);
  });
}

export function selectOpportunityCard(snapshot: ProductionOpportunitySnapshot, name: string): OpportunityCardViewModel | null {
  const item = snapshot.items.find((candidate) => candidate.item === name);
  return item ? toOpportunityCardViewModel(item, snapshot) : null;
}

export const UI_LABEL_COVERAGE = { REASON_LABELS, WARNING_LABELS, CAP_LABELS, GATE_LABELS };
