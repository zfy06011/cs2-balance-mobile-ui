"""radar：机会雷达（文档第八节）。

综合 C5 买入价、Steam 卖出价、双方成本、7 天预测净 ROI、流动性、风险等，
输出信号：🟢 买入候选 / 🟡 等待 / 🔴 不建议。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RadarInput:
    market_hash_name: str
    c5_buy_price: float | None
    steam_sell_price: float | None
    steam_volume: int = 0
    predicted_p50: float | None = None       # 7 天后预测中位价
    predicted_p25: float | None = None
    breakeven_price: float | None = None
    volatility: float = 0.05
    event_risk: float = 0.0                  # 0~1，事件系统给出
    seller_receive_ratio: float = 0.8696
    c5_fee_ratio: float = 0.01
    popular_rank: int | None = None       # Steam 热门榜排名（1 起），未提供不加分
    data_insufficient: bool = False       # 历史不足：信号封顶 wait、评分封顶 40
    event_adjust: float | None = None     # 事件价差修正（预测 event_adjust，如 -0.03）


@dataclass
class RadarOutput:
    market_hash_name: str
    signal: str                 # buy / wait / avoid
    expected_roi: float | None  # 按预测 P50 计算的 7 日预期 ROI
    pessimistic_roi: float | None  # 按 P25 计算的 ROI
    risk_level: str             # low / medium / high
    liquidity: str              # low / medium / high
    score: float
    details: dict


def _roi_of(sell_price: float | None, buy_price: float | None, receive_ratio: float, fee: float) -> float | None:
    if sell_price is None or buy_price is None or buy_price <= 0:
        return None
    total_cost = buy_price * (1 + fee)
    net = sell_price * receive_ratio - total_cost
    return net / total_cost


def _risk_level(volatility: float, event_risk: float, liquid: str) -> str:
    score = volatility * 100 + event_risk * 3.0 + (1.0 if liquid == "low" else 0.0)
    if score >= 3.0:
        return "high"
    if score >= 1.5:
        return "medium"
    return "low"


def _liquidity(volume: int) -> str:
    if volume >= 5000:
        return "high"
    if volume >= 1000:
        return "medium"
    return "low"


def evaluate(r: RadarInput) -> RadarOutput:
    liquid = _liquidity(r.steam_volume)
    risk = _risk_level(r.volatility, r.event_risk, liquid)

    # 事件价差修正：与 mobile/core/radar.ts 对齐。引擎传入还原后的原始 P50/P25，
    # 这里乘回 (1+event_adjust) 得到事件修正后的有效预测价（避免双重修正）。
    event_factor = 1.0 + (r.event_adjust if r.event_adjust is not None else 0.0)
    p50_base = r.predicted_p50 or r.steam_sell_price
    p50_sell = p50_base * event_factor if p50_base is not None else None
    expected_roi = _roi_of(p50_sell, r.c5_buy_price, r.seller_receive_ratio, r.c5_fee_ratio)
    p25_sell = r.predicted_p25 * event_factor if r.predicted_p25 is not None else None
    pessimistic_roi = _roi_of(p25_sell, r.c5_buy_price, r.seller_receive_ratio, r.c5_fee_ratio)

    # 信号规则
    if expected_roi is None:
        signal = "wait"
    elif r.data_insufficient:
        # 历史不足：预测不可信，绝不因预测给 buy；当前价格已明确亏损才 avoid
        signal = "avoid" if expected_roi < 0 else "wait"
    elif expected_roi >= 0.05 and pessimistic_roi is not None and pessimistic_roi >= -0.02 and risk != "high":
        signal = "buy"
    elif expected_roi >= 0.0 or (pessimistic_roi is not None and pessimistic_roi >= -0.05):
        signal = "wait"
    else:
        signal = "avoid"

    # 综合评分 0~100
    score = 0.0
    if expected_roi is not None:
        score += min(max(expected_roi * 200, -20), 40)
    if r.breakeven_price and r.predicted_p50:
        score += min(max((r.predicted_p50 / r.breakeven_price - 1.0) * 100, -10), 30)
    score += {"high": 15, "medium": 8, "low": 0}[liquid]
    score -= {"low": 0, "medium": 5, "high": 15}[risk]
    # 热门榜排名加分：进入 Steam 热门榜（<=100）流动性背书 +3，头部（<=30）再 +3
    if r.popular_rank is not None and r.popular_rank >= 1:
        if r.popular_rank <= 100:
            score += 3
        if r.popular_rank <= 30:
            score += 3
    # 事件价差修正偏移：大促压制期（负修正）买入机会加分，反弹期（正修正）减分（幅度封顶 ±8 分）
    if r.event_adjust is not None and r.event_adjust != 0:
        score += max(-8.0, min(8.0, r.event_adjust * -200.0))
    # 历史数据不足：评分封顶 40（避免「看似高分」误导）
    if r.data_insufficient:
        score = min(score, 40.0)
    score = max(0.0, min(100.0, round(score, 1)))

    return RadarOutput(
        market_hash_name=r.market_hash_name,
        signal=signal,
        expected_roi=round(expected_roi, 6) if expected_roi is not None else None,
        pessimistic_roi=round(pessimistic_roi, 6) if pessimistic_roi is not None else None,
        risk_level=risk,
        liquidity=liquid,
        score=score,
        details={
            "c5_buy_price": r.c5_buy_price,
            "steam_sell_price": r.steam_sell_price,
            "predicted_p50": round(p50_sell, 4) if p50_sell is not None else None,
            "breakeven_price": r.breakeven_price,
            "volatility": r.volatility,
            "popular_rank": r.popular_rank,
            "data_insufficient": r.data_insufficient,
            "event_adjust": r.event_adjust,
        },
    )
