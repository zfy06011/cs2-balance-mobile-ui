import type { OpportunityDecision } from '../../core/types/opportunity';

export const DECISION_LABELS: Record<OpportunityDecision, string> = {
  excellent: '强机会',
  buy: '可关注买入',
  watch: '观察',
  avoid: '暂不适合',
};

export const LEGACY_SIGNAL_LABELS: Record<string, string> = {
  buy: '推荐购买',
  wait: '可以观察',
  waiting: '等待数据',
  avoid: '暂时别买',
};

export const REASON_LABELS: Record<string, string> = {
  discount_attractive: '预计折扣有吸引力',
  conservative_discount_good: '保守折扣相对稳健',
  liquidity_strong: '当前流动性较强',
  spread_tight: '买卖价差较小',
  volume_high: '市场成交较活跃',
  c5_supply_available: 'C5 可用数量充足',
  market_stable: '市场状态相对稳定',
};

export const WARNING_LABELS: Record<string, string> = {
  conservative_discount_missing: '缺少保守预测',
  expected_discount_missing: '缺少预计折扣',
  forecast_missing: '预测数据暂不可用',
  volume_missing: '成交量数据暂不可用',
  c5_supply_missing: 'C5 数量数据暂不可用',
  market_state_unknown: '市场状态未知',
  partial_fill: '当前盘口只能部分成交',
  steam_fee_model_approximate: 'Steam 手续费为近似估算',
  future_orderbook_not_predicted: '未预测 7 天后的真实盘口',
  future_liquidity_not_guaranteed: '未保证 7 天后的流动性',
  v2_input_missing: '新算法输入暂不可用',
  prepared_data_incomplete: '部分市场数据暂不可用',
  orderbook_missing: 'Steam 盘口暂不可用',
};

export const CAP_LABELS: Record<string, string> = {
  market_data_stale: '市场数据已过期',
  chaos_cap_watch: '市场波动较大，最多观察',
  forecast_missing_cap_watch: '预测缺失，最多观察',
  coverage_too_low_cap_watch: '成交覆盖不足，最多观察',
  approximate_fee_low_price_cap_watch: '低价手续费为近似估算，最多观察',
  excellent_requirements_not_met: '尚未满足强机会条件',
};

export const GATE_LABELS: Record<string, string> = {
  missing_expected_7d: '缺少预计 7 天折扣',
  expected_discount_not_viable: '预计到账不足以覆盖 C5 成本',
  market_data_quality_low: '市场数据质量偏低',
  current_capacity_too_small: '当前可执行容量较低',
};

export function labelForCode(code: string, kind: 'reason' | 'warning' | 'cap' | 'gate'): string {
  const map = kind === 'reason' ? REASON_LABELS : kind === 'warning' ? WARNING_LABELS : kind === 'cap' ? CAP_LABELS : GATE_LABELS;
  return map[code] ?? '风险提示';
}

export function decisionLabel(decision: OpportunityDecision): string {
  return DECISION_LABELS[decision];
}

export function legacySignalLabel(signal: string | undefined): string {
  return LEGACY_SIGNAL_LABELS[signal ?? ''] ?? '旧版结果';
}
