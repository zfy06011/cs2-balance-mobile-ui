/**
 * types：本地版统一数据类型（与后端 Pydantic schema 对齐，供 UI 使用）。
 */
export interface Quote {
  market_hash_name: string;
  c5_buy_price: number | null;
  steam_sell_price: number | null;
  steam_volume: number | null;
  /** Steam 热门榜排名（1 起；回退采集时为 null） */
  popular_rank: number | null;
  c5_fee_ratio: number;
  steam_seller_receive_ratio: number;
  lock_days: number;
  steam_net_receive: number | null;
  net_profit: number | null;
  roi: number | null;
  /** 预计几折余额：总成本 / 预计 Steam 净到手（0.926 = 9.26 折，越低越划算） */
  expected_discount: number | null;
  breakeven_sell_price: number | null;
  signal: string;
  /** 历史数据不足（预测仅供参考，信号已封顶为 wait） */
  data_insufficient?: boolean;
}

export interface RadarItem {
  market_hash_name: string;
  c5_buy_price: number | null;
  steam_sell_price: number | null;
  /** Steam 卖出后实际到手（扣 15% 平台费，卖家实得 86.96%） */
  steam_net_receive: number | null;
  expected_roi: number | null;
  /** 预计几折（0.926 = 9.26 折，越低越划算） */
  expected_discount: number | null;
  risk_level: string;
  liquidity: string;
  signal: string;
  score: number;
  details: Record<string, number | string | boolean | null>;
}

export interface Scenario {
  label: string;
  predicted_sell_price: number;
  net_profit: number;
  roi: number;
}

export interface Prediction {
  item_id: number;
  market_hash_name: string;
  model_version: string;
  target_at: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  prob_profit: number;
  prob_loss: number;
  confidence: number;
  features: Record<string, number | string | boolean>;
  scenarios: Scenario[];
}

export interface InventoryEntry {
  id: number;
  item_name: string;
  quantity: number;
  buy_price: number;
  buy_at: string;
  source: string;
  unlock_at: string;
  days_left: number;
  /** Steam 同步后的小时级剩余时间（0 = 可上架）；未同步时为 7 天折算 */
  hours_left: number;
  /** 是否经过 Steam 库存同步 */
  steam_synced: boolean;
  /** 最近一次 Steam 同步时刻（ISO；未同步为 null）——库存页「上次同步」用 */
  steam_synced_at?: string | null;
  /** 最近同步是否可交易/可上架（null = 未同步） */
  steam_tradable: boolean | null;
  /** 解锁时间来源：steam=Steam 真实冷却；estimate=买入时间+7天估算 */
  unlock_source: 'steam' | 'estimate';
  current_estimate: number | null;
  net_receive_estimate: number | null;
  net_profit_estimate: number | null;
  roi_estimate: number | null;
  expected_discount_estimate: number | null;
  /** 最佳卖出时机建议（结合活动窗口） */
  sell_advice_code?: 'sell_now' | 'sell_at_unlock' | 'wait_recovery' | 'wait_event_pass';
  sell_advice_text?: string;
}

/** 同种武器箱的持仓汇总（库存页每行 + 详情页「我的持仓」共用；core/holdings.ts 计算） */
export interface HoldingsSummary {
  itemName: string;
  /** 总件数 */
  quantity: number;
  /** 本地记录笔数 */
  records: number;
  /** 加权买入均价（未含手续费） */
  avgBuyPrice: number;
  /** 总成本（含 C5 1% 买入手续费） */
  totalCost: number;
  /** 当前估值（Steam 到手价 × 件数；无行情为 null） */
  currentValue: number | null;
  /** 浮动盈亏（当前估值 − 含费成本） */
  netProfit: number | null;
  /** 回报率 */
  roi: number | null;
  /** 最早解锁时刻（ISO） */
  earliestUnlockAt: string;
  /** 距最早解锁剩余毫秒（基于调用时传入的 now 现算） */
  msLeft: number;
  hoursLeft: number;
  /** 是否全部记录都已可上架 */
  allTradable: boolean;
  anyTradable: boolean;
  sellAdviceText?: string;
  sellAdviceCode?: InventoryEntry['sell_advice_code'];
}

/** 本地购买记录（一键买入成功后写入，随订单留存） */
export interface OrderRecord {
  id: number;
  item_name: string;
  quantity: number;
  buy_price: number;
  buy_at: string;
  source: string;
  expected_discount: number | null;
  budget_used: number;
}

export interface HistoryPoint {
  price: number;
  fetchedAt: string;
  volume?: number | null;
}

export interface Simulation {
  budget: number;
  allocation: string;
  items: SimulationItem[];
  total_buy_cost: number;
  expected_steam_receive: number;
  expected_net_profit: number;
  expected_roi: number;
  weighted_loss_prob: number;
}

export interface SimulationItem {
  name: string;
  qty: number;
  buy_cost: number;
  expected_receive: number;
  expected_roi: number;
  prob_loss: number;
}
