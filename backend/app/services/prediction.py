"""prediction：7 天限制期价格预测（文档第六节）。

第一版使用可解释基线模型，不用机器学习：
- 动量基线：P50 = 最新价 × (1 + 近 7 日动量 × 动量衰减系数)
- 区间：基于日收益率标准差（波动率）与正态分位数扩展 P10/P25/P50/P75/P90
- 盈利/亏损概率：以盈亏平衡价为阈值，用对数正态近似计算
- 输出必须包含 model_version、输入数据时间范围、预测目标时间

注意：本模块不产生任何市场数据，只基于传入的价格序列计算；输入必须来自真实快照。
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timedelta

MODEL_VERSION = "baseline-momentum-v1"

# 正态分位数
_Z = {"p10": -1.2816, "p25": -0.6745, "p50": 0.0, "p75": 0.6745, "p90": 1.2816}


@dataclass(frozen=True)
class PredictionResult:
    item_id: int | None
    market_hash_name: str
    model_version: str
    predicted_at: datetime
    target_at: datetime
    horizon_days: int
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    prob_profit: float
    prob_loss: float
    confidence: float
    features: dict = field(default_factory=dict)


class BaselinePredictor:
    def __init__(
        self,
        horizon_days: int = 7,
        momentum_days: int = 7,
        momentum_decay: float = 0.5,
        min_history: int = 15,
    ):
        self.horizon_days = horizon_days
        self.momentum_days = momentum_days
        self.momentum_decay = momentum_decay
        self.min_history = min_history

    def predict(
        self,
        market_hash_name: str,
        prices: list[float],
        dates: list[datetime] | None = None,
        breakeven_price: float | None = None,
        item_id: int | None = None,
        predicted_at: datetime | None = None,
    ) -> PredictionResult:
        """prices: 按时间升序的历史价格（至少 min_history 条）。

        使用对数收益率；若历史不足则退化为保守区间（扩大波动率）。
        """
        if len(prices) < 2:
            raise ValueError("至少需要 2 条历史价格才能预测")

        latest = prices[-1]
        log_returns = [
            math.log(prices[i] / prices[i - 1]) for i in range(1, len(prices)) if prices[i - 1] > 0
        ]
        vol = statistics.pstdev(log_returns) if len(log_returns) >= 2 else 0.05
        # 数据不足时放大不确定性
        if len(prices) < self.min_history:
            vol = max(vol, 0.05) * 1.5

        # 动量：近 momentum_days 的累计对数收益
        window = prices[-self.momentum_days:]
        momentum = 0.0
        if len(window) >= 2 and window[0] > 0:
            momentum = math.log(window[-1] / window[0])

        drift = momentum * self.momentum_decay
        sigma_total = vol * math.sqrt(self.horizon_days)

        p50 = latest * math.exp(drift)
        quantiles = {q: round(p50 * math.exp(_Z[q] * sigma_total), 4) for q in _Z}
        # 价格不能为负
        for q in quantiles:
            quantiles[q] = max(quantiles[q], 0.0)

        # 盈利概率（假设对数价格近似正态）：P(log(price) > log(breakeven))
        prob_profit = 0.5
        if breakeven_price and breakeven_price > 0:
            if sigma_total < 1e-9:
                prob_profit = 1.0 if p50 > breakeven_price else (0.0 if p50 < breakeven_price else 0.5)
            else:
                mu = math.log(p50)
                prob_profit = 1.0 - _normal_cdf((math.log(breakeven_price) - mu) / sigma_total)
        prob_profit = max(0.0, min(1.0, prob_profit))
        prob_loss = 1.0 - prob_profit

        # 置信度：数据量越多、波动率越低越自信（0~1）
        confidence = max(0.1, min(0.95, 1.0 - sigma_total * 3.0))

        pred_at = predicted_at or datetime.utcnow()
        return PredictionResult(
            item_id=item_id,
            market_hash_name=market_hash_name,
            model_version=MODEL_VERSION,
            predicted_at=pred_at,
            target_at=pred_at + timedelta(days=self.horizon_days),
            horizon_days=self.horizon_days,
            **quantiles,
            prob_profit=round(prob_profit, 4),
            prob_loss=round(prob_loss, 4),
            confidence=round(confidence, 4),
            features={
                "latest_price": latest,
                "momentum": round(momentum, 6),
                "volatility": round(vol, 6),
                "history_len": len(prices),
                "input_reduced": True,
            },
        )


def _normal_cdf(x: float) -> float:
    """标准正态分布 CDF（Abramowitz-Stegun 近似）"""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))
