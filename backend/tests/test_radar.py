"""radar 机会雷达测试（文档第八节）"""
import pytest
from app.services.radar import RadarInput, evaluate


def _input(**overrides):
    base = dict(
        market_hash_name="测试箱",
        c5_buy_price=10.0,
        steam_sell_price=12.0,
        steam_volume=8000,
        predicted_p50=13.0,
        predicted_p25=11.5,
        breakeven_price=11.6,
        volatility=0.02,
        event_risk=0.0,
    )
    base.update(overrides)
    return RadarInput(**base)


def test_buy_signal_for_good_opportunity():
    r = evaluate(_input())
    assert r.signal == "buy"
    assert r.liquidity == "high"
    assert r.expected_roi > 0.05


def test_avoid_signal_for_bad_spread():
    r = evaluate(_input(predicted_p50=10.5, predicted_p25=9.5, steam_sell_price=10.5))
    assert r.signal == "avoid"


def test_wait_signal_for_marginal():
    r = evaluate(_input(predicted_p50=11.8, predicted_p25=10.9, breakeven_price=11.6))
    assert r.signal == "wait"


def test_high_volatility_raises_risk():
    calm = evaluate(_input(volatility=0.01))
    wild = evaluate(_input(volatility=0.12))
    assert wild.risk_level in ("high", "medium")
    assert calm.risk_level == "low"


def test_liquidity_levels():
    assert evaluate(_input(steam_volume=99)).liquidity == "low"
    assert evaluate(_input(steam_volume=1500)).liquidity == "medium"

def test_insufficient_data_caps_to_wait():
    """数据不足时，即使表面 ROI 很好也只给 wait，评分封顶 40。"""
    r = evaluate(_input(
        predicted_p50=16.0,
        predicted_p25=14.5,
        popular_rank=5,
        data_insufficient=True,
    ))
    assert r.signal == "wait"
    assert r.score == pytest.approx(40.0, abs=1e-6)
    assert r.details["data_insufficient"] is True
    assert r.details["popular_rank"] == 5


def test_insufficient_data_matches_ts_baseline():
    import json
    from pathlib import Path

    b = json.loads((Path(__file__).resolve().parent.parent / "scripts" / "baseline.json").read_text(encoding="utf-8"))["radar_insufficient"]
    r = evaluate(_input(
        predicted_p50=16.0,
        predicted_p25=14.5,
        popular_rank=5,
        data_insufficient=True,
    ))
    assert r.signal == b["signal"]
    assert r.expected_roi == pytest.approx(b["expected_roi"], abs=1e-6)
    assert r.pessimistic_roi == pytest.approx(b["pessimistic_roi"], abs=1e-6)
    assert r.score == pytest.approx(b["score"], abs=1e-6)


def test_popular_rank_bonus():
    hot = evaluate(_input(popular_rank=12))
    cold = evaluate(_input(popular_rank=None))
    assert hot.score > cold.score
    assert hot.details["popular_rank"] == 12