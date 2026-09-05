"""simulation 资金模拟测试（文档第九节）"""
import pytest

from app.services.simulation import simulate, SimItem, reverse_target


def _items():
    return [
        SimItem(name="A箱", c5_price=5.0, predicted_p50=7.0, predicted_p25=5.8, prob_loss=0.2, volume=9000, risk="low", liquidity="high"),
        SimItem(name="B箱", c5_price=2.0, predicted_p50=2.6, predicted_p25=2.1, prob_loss=0.3, volume=4000, risk="medium", liquidity="medium"),
    ]


def test_simulate_respects_budget():
    result = simulate(100.0, _items(), "balanced")
    assert result is not None
    assert result.total_buy_cost <= 100.0
    assert result.expected_roi > 0
    assert result.weighted_loss_prob >= 0.0
    assert len(result.items) >= 1


def test_simulate_flow_limit():
    # 低流动性箱子的买入数量应受成交量限制
    items = [SimItem(name="冷门箱", c5_price=1.0, predicted_p50=1.3, predicted_p25=1.1, prob_loss=0.4, volume=30, risk="high", liquidity="low")]
    result = simulate(10000.0, items, "aggressive")
    assert result is not None
    total_qty = sum(d["qty"] for d in result.items)
    assert total_qty <= 30 // 4 + 1  # 日成交量上限约 1/4


def test_reverse_target():
    out = reverse_target(1000.0, expected_roi=0.03)
    assert out["required_budget"] == pytest.approx(1000 / 1.03, rel=1e-3)
    assert out["expected_profit"] > 0
