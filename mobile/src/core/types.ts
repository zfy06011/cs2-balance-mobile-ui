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
  current_estimate: number | null;
  net_receive_estimate: number | null;
  net_profit_estimate: number | null;
  roi_estimate: number | null;
  expected_discount_estimate: number | null;
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
