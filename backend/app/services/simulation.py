"""simulation：资金模拟（文档第九节）。

输入预算，模拟不同组合：预计投入、数量、7 天后 Steam 到账、净利润、ROI、亏损概率。
提供稳健/平衡/激进三种配置。考虑单箱流动性，禁止无限量按最低价买入：
  每箱可买数量按 该箱近 30 日成交量/30/4 粗略估算（分桶），且不能超过可买上限。
目标余额反推：输入希望获得的 Steam 钱包余额，反推所需资金。
"""
from __future__ import annotations

from dataclasses import dataclass

CONFIG = {
    "conservative": {"max_items": 3, "risk_ceiling": "low", "liquidity_min": 5000},
    "balanced": {"max_items": 5, "risk_ceiling": "medium", "liquidity_min": 2000},
    "aggressive": {"max_items": 8, "risk_ceiling": "high", "liquidity_min": 800},
}


@dataclass
class SimItem:
    name: str
    c5_price: float
    predicted_p50: float
    predicted_p25: float
    prob_loss: float
    volume: int
    risk: str = "medium"
    liquidity: str = "medium"


@dataclass
class SimResult:
    allocation: str
    items: list[dict]
    total_buy_cost: float
    expected_steam_receive: float
    expected_net_profit: float
    expected_roi: float
    weighted_loss_prob: float
    target_reverse: dict | None = None


def _daily_volume(volume: int) -> int:
    """按 30 日成交量/30 估算日成交量（订单簿深度上限的粗略近似）"""
    return max(1, volume // 30)


def _max_buy_qty(item: SimItem, budget_per_item: float) -> int:
    """流动性上限：单次可买入量不超过日成交量的 1/4，且不超过预算允许数量"""
    depth = max(1, _daily_volume(item.volume) // 4)
    by_budget = int(budget_per_item // item.c5_price) if item.c5_price > 0 else 0
    return max(1, min(depth, by_budget))


def simulate(budget: float, items: list[SimItem], allocation: str = "balanced") -> SimResult | None:
    if budget <= 0 or not items:
        return None
    cfg = CONFIG.get(allocation, CONFIG["balanced"])

    # 排序：按 P50 ROI × 流动性 × (1-风险) 打分
    scored = []
    for it in items:
        if it.risk not in ("low", "medium", "high"):
            it.risk = "medium"
        if it.liquidity not in ("low", "medium", "high"):
            it.liquidity = "medium"
        roi = (it.predicted_p50 * 0.8696 - it.c5_price * 1.01) / (it.c5_price * 1.01) if it.c5_price > 0 else 0
        liq_score = {"high": 1.0, "medium": 0.6, "low": 0.2}[it.liquidity]
        risk_penalty = {"low": 0.05, "medium": 0.15, "high": 0.3}[it.risk]
        score = roi * 10 + liq_score * 0.5 - risk_penalty + (1 - it.prob_loss) * 0.3
        scored.append((score, it))
    scored.sort(key=lambda x: x[0], reverse=True)

    chosen: list[dict] = []
    remaining = budget
    for _, it in scored[: cfg["max_items"]]:
        if remaining <= 0:
            break
        budget_per = remaining / max(1, cfg["max_items"] - len(chosen))
        qty = _max_buy_qty(it, budget_per)
        cost = qty * it.c5_price * 1.01  # 含 C5 手续费
        if cost > remaining:
            qty = max(0, int(remaining // (it.c5_price * 1.01)))
            cost = qty * it.c5_price * 1.01
        if qty <= 0:
            continue
        expected_receive = qty * it.predicted_p50 * 0.8696
        chosen.append(
            {
                "name": it.name,
                "qty": qty,
                "buy_cost": round(cost, 2),
                "expected_receive": round(expected_receive, 2),
                "expected_roi": round((expected_receive - cost) / cost, 4) if cost else 0.0,
                "prob_loss": it.prob_loss,
            }
        )
        remaining -= cost
        if remaining < min((i.c5_price for i in items), default=9999):
            continue

    if not chosen:
        return None
    total_cost = sum(d["buy_cost"] for d in chosen)
    total_receive = sum(d["expected_receive"] for d in chosen)
    net = total_receive - total_cost
    weighted_loss = sum(d["buy_cost"] * d["prob_loss"] for d in chosen) / total_cost if total_cost else 0
    return SimResult(
        allocation=allocation,
        items=chosen,
        total_buy_cost=round(total_cost, 2),
        expected_steam_receive=round(total_receive, 2),
        expected_net_profit=round(net, 2),
        expected_roi=round(net / total_cost, 4) if total_cost else 0.0,
        weighted_loss_prob=round(weighted_loss, 4),
    )


def reverse_target(target_balance: float, expected_roi: float = 0.03) -> dict:
    """target_balance: 目标 Steam 钱包余额；expected_roi: 预估 7 日 ROI"""
    """目标余额反推：需要多少本金才能在 7 天后获得 target_balance 的 Steam 钱包余额。"""
    required_budget = target_balance / (1 + expected_roi)
    return {
        "target_balance": target_balance,
        "assumed_roi": expected_roi,
        "required_budget": round(required_budget, 2),
        "expected_profit": round(target_balance - required_budget, 2),
    }
