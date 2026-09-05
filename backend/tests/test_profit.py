"""profit 收益计算测试（文档第五节）"""
import pytest

from app.services.profit import ProfitCalculator


def test_c5_total_cost_includes_fee():
    calc = ProfitCalculator(c5_fee_ratio=0.01, steam_seller_receive_ratio=0.8696)
    assert calc.c5_total_cost(100) == pytest.approx(101.0)


def test_steam_net_receive():
    calc = ProfitCalculator()
    assert calc.steam_net_receive(100) == pytest.approx(86.96)


def test_breakeven():
    calc = ProfitCalculator(c5_fee_ratio=0.01, steam_seller_receive_ratio=0.8696)
    # 101 / 0.8696
    assert calc.breakeven_sell_price(100) == pytest.approx(101 / 0.8696, rel=1e-4)


def test_profit_positive_case():
    calc = ProfitCalculator()
    r = calc.calculate(c5_buy_price=10.0, steam_sell_price=13.0)
    assert r.net_profit > 0
    assert r.is_profitable()
    # 净到账 = 13 * 0.8696 ≈ 11.3048；成本 = 10.1
    assert r.net_profit == pytest.approx(13 * 0.8696 - 10.1, abs=1e-3)
    assert r.roi > 0


def test_profit_loss_case():
    calc = ProfitCalculator()
    r = calc.calculate(c5_buy_price=12.0, steam_sell_price=12.0)
    # 到账 10.4352 < 成本 12.12
    assert r.net_profit < 0
    assert not r.is_profitable()


def test_scenarios():
    calc = ProfitCalculator()
    sc = calc.scenarios(10.0, {"pessimistic": 10.5, "base": 12.0, "optimistic": 14.0})
    assert sc["optimistic"]["roi"] > sc["base"]["roi"] > sc["pessimistic"]["roi"]
