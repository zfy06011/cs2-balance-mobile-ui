/**
 * profit：跨市场收益计算模型（与后端 services/profit.py 对齐）。
 * 口径：
 * - Steam 实际到账 = 预计卖出价 × seller_receive_ratio（默认 86.96%）
 * - 净利润 = Steam 实际到账 − C5GAME 实际总成本
 * - ROI = 净利润 / C5GAME 实际总成本
 * - 盈亏平衡卖出价 = C5GAME 实际总成本 / seller_receive_ratio
 */
export interface ProfitResult {
  c5_buy_price: number;
  steam_sell_price: number;
  steam_net_receive: number;
  net_profit: number;
  roi: number;
  breakeven_sell_price: number;
  c5_fee_ratio: number;
  steam_seller_receive_ratio: number;
}

export class ProfitCalculator {
  constructor(
    public c5_fee_ratio = 0.01,
    public steam_seller_receive_ratio = 0.8696,
  ) {}

  c5TotalCost(c5BuyPrice: number): number {
    return c5BuyPrice * (1 + this.c5_fee_ratio);
  }

  steamNetReceive(steamSellPrice: number): number {
    return steamSellPrice * this.steam_seller_receive_ratio;
  }

  breakevenSellPrice(c5BuyPrice: number): number {
    return this.c5TotalCost(c5BuyPrice) / this.steam_seller_receive_ratio;
  }

  /**
   * 预计几折余额：总成本 / 预计 Steam 净到手。
   * 例：成本 100 元、净到手 108 元 → 100/(108) = 0.9259 ≈ 9.26 折。
   * 折扣数越低越划算（花钱越少换到同样的 Steam 余额）。
   * 任一输入缺失/非正返回 null（禁止臆造）。
   */
  expectedDiscount(c5BuyPrice: number, steamNetReceive: number): number | null {
    if (c5BuyPrice == null || c5BuyPrice <= 0 || steamNetReceive == null || steamNetReceive <= 0) return null;
    return this.c5TotalCost(c5BuyPrice) / steamNetReceive;
  }

  calculate(c5BuyPrice: number, steamSellPrice: number): ProfitResult {
    const totalCost = this.c5TotalCost(c5BuyPrice);
    const netReceive = this.steamNetReceive(steamSellPrice);
    const netProfit = netReceive - totalCost;
    const roi = totalCost ? netProfit / totalCost : 0;
    return {
      c5_buy_price: c5BuyPrice,
      steam_sell_price: steamSellPrice,
      steam_net_receive: round(netReceive, 4),
      net_profit: round(netProfit, 4),
      roi: round(roi, 6),
      breakeven_sell_price: round(this.breakevenSellPrice(c5BuyPrice), 4),
      c5_fee_ratio: this.c5_fee_ratio,
      steam_seller_receive_ratio: this.steam_seller_receive_ratio,
    };
  }

  scenarios(
    c5BuyPrice: number,
    predictedSellPrices: Record<string, number>,
  ): Record<string, { predicted_sell_price: number; net_profit: number; roi: number }> {
    const out: Record<string, { predicted_sell_price: number; net_profit: number; roi: number }> = {};
    for (const [label, price] of Object.entries(predictedSellPrices)) {
      const r = this.calculate(c5BuyPrice, price);
      out[label] = { predicted_sell_price: price, net_profit: r.net_profit, roi: r.roi };
    }
    return out;
  }
}

export function round(v: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.round(v * p) / p;
}
