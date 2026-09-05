"""profit：跨市场收益计算模型（文档第五节）。

口径：
- Steam 实际到账 = 预计卖出价 × seller_receive_ratio（默认 86.96%，即 15% 总费用由买家承担）
- 净利润 = Steam 实际到账 − C5GAME 实际总成本
- ROI = 净利润 / C5GAME 实际总成本
- 盈亏平衡卖出价 = C5GAME 实际总成本 / seller_receive_ratio
- 提供 乐观/基准/悲观 情景下的净利润与 ROI
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProfitResult:
    c5_buy_price: float
    steam_sell_price: float
    steam_net_receive: float
    net_profit: float
    roi: float
    breakeven_sell_price: float
    c5_fee_ratio: float
    steam_seller_receive_ratio: float

    def is_profitable(self) -> bool:
        return self.net_profit > 0


class ProfitCalculator:
    def __init__(
        self,
        c5_fee_ratio: float = 0.01,
        steam_seller_receive_ratio: float = 0.8696,
    ):
        assert 0 <= c5_fee_ratio < 1, "c5_fee_ratio must be in [0,1)"
        assert 0 < steam_seller_receive_ratio <= 1, "seller receive ratio must be in (0,1]"
        self.c5_fee_ratio = c5_fee_ratio
        self.steam_seller_receive_ratio = steam_seller_receive_ratio

    def c5_total_cost(self, c5_buy_price: float) -> float:
        """C5GAME 实际总成本（买入价 + 买入手续费）"""
        return c5_buy_price * (1 + self.c5_fee_ratio)

    def steam_net_receive(self, steam_sell_price: float) -> float:
        """Steam 实际到账"""
        return steam_sell_price * self.steam_seller_receive_ratio

    def breakeven_sell_price(self, c5_buy_price: float) -> float:
        """盈亏平衡卖出价（卖价达到该值则不亏不赚）"""
        return self.c5_total_cost(c5_buy_price) / self.steam_seller_receive_ratio

    def calculate(self, c5_buy_price: float, steam_sell_price: float) -> ProfitResult:
        total_cost = self.c5_total_cost(c5_buy_price)
        net_receive = self.steam_net_receive(steam_sell_price)
        net_profit = net_receive - total_cost
        roi = net_profit / total_cost if total_cost else 0.0
        return ProfitResult(
            c5_buy_price=c5_buy_price,
            steam_sell_price=steam_sell_price,
            steam_net_receive=round(net_receive, 4),
            net_profit=round(net_profit, 4),
            roi=round(roi, 6),
            breakeven_sell_price=round(self.breakeven_sell_price(c5_buy_price), 4),
            c5_fee_ratio=self.c5_fee_ratio,
            steam_seller_receive_ratio=self.steam_seller_receive_ratio,
        )

    def scenarios(
        self, c5_buy_price: float, predicted_sell_prices: dict[str, float]
    ) -> dict[str, dict]:
        """输入 {'pessimistic': p25, 'base': p50, 'optimistic': p75} 等价格，输出各情景收益"""
        out: dict[str, dict] = {}
        for label, price in predicted_sell_prices.items():
            r = self.calculate(c5_buy_price, price)
            out[label] = {
                "predicted_sell_price": price,
                "net_profit": r.net_profit,
                "roi": r.roi,
            }
        return out
