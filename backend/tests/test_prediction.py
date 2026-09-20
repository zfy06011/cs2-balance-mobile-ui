"""prediction 基线模型测试（文档第六节）"""
import math
import pytest

from app.services.prediction import BaselinePredictor, MODEL_VERSION


def _flat_prices(n=40, base=10.0):
    return [base] * n


def test_prediction_outputs_quantiles_ordered():
    prices = _flat_prices(40)
    pred = BaselinePredictor().predict("测试武器箱", prices, item_id=1)
    assert pred.model_version == MODEL_VERSION
    assert pred.p10 <= pred.p25 <= pred.p50 <= pred.p75 <= pred.p90
    assert pred.p50 > 0
    assert pred.target_at > pred.predicted_at
    assert pred.horizon_days == 7


def test_flat_series_p50_near_latest():
    prices = _flat_prices(40, base=12.5)
    pred = BaselinePredictor().predict("测试", prices)
    assert pred.p50 == pytest.approx(12.5, rel=0.05)


def test_uptrend_gives_higher_p50():
    up = [10.0 + i * 0.05 for i in range(40)]
    flat = _flat_prices(40, base=10.0)
    pred_up = BaselinePredictor().predict("up", up)
    pred_flat = BaselinePredictor().predict("flat", flat)
    assert pred_up.p50 > pred_flat.p50


def test_prob_profit_with_breakeven():
    prices = _flat_prices(40, base=12.0)
    pred = BaselinePredictor().predict("测试", prices, breakeven_price=10.0)
    assert 0.0 <= pred.prob_profit <= 1.0
    assert pred.prob_profit >= 0.5  # 盈亏平衡价低于预测中位价
    assert abs(pred.prob_profit + pred.prob_loss - 1.0) < 1e-9


def test_insufficient_history_raises():
    with pytest.raises(ValueError):
        BaselinePredictor().predict("测试", [9.0])

# ---------------- baseline-momentum-v2 ----------------

def _baseline():
    import json
    from pathlib import Path
    p = Path(__file__).resolve().parent.parent / "scripts" / "baseline.json"
    return json.loads(p.read_text(encoding="utf-8"))


def test_v2_matches_ts_baseline():
    from datetime import datetime
    from app.services.prediction import BaselinePredictorV2, MODEL_VERSION_V2

    b = _baseline()["prediction_v2"]
    pred = BaselinePredictorV2().predict(
        "V2 Test Case",
        [10.0, 10.4, 10.8, 11.3, 11.8],
        breakeven_price=10.1,
        item_id=1,
        predicted_at=datetime(2026, 9, 5),
        volume=6000.0,
        volume_history=[2000, 2500, 3000, 5000, 6000],
        popular_rank=12,
    )
    assert pred.model_version == MODEL_VERSION_V2
    assert pred.model_version == b["model_version"]
    for q in ("p10", "p25", "p50", "p75", "p90"):
        assert getattr(pred, q) == pytest.approx(b[q], abs=2e-4)
    assert pred.prob_profit == pytest.approx(b["prob_profit"], abs=2e-4)
    assert pred.prob_loss == pytest.approx(b["prob_loss"], abs=2e-4)
    assert pred.confidence == pytest.approx(b["confidence"], abs=2e-4)
    assert pred.features["trend_daily"] == pytest.approx(b["features"]["trend_daily"], abs=1e-6)
    assert pred.features["momentum"] == pytest.approx(b["features"]["momentum"], abs=1e-6)
    assert pred.features["volume_confirm"] == pytest.approx(1.15, abs=1e-9)
    assert pred.features["volume_ratio"] == pytest.approx(1.92, abs=1e-3)
    assert pred.features["popular_rank"] == 12
    assert pred.features["data_insufficient"] is False


def test_v2_low_data_matches_ts_baseline():
    from datetime import datetime
    from app.services.prediction import BaselinePredictorV2

    b = _baseline()["prediction_v2_low"]
    pred = BaselinePredictorV2().predict(
        "V2 Low",
        [12.0],
        breakeven_price=10.1,
        predicted_at=datetime(2026, 9, 5),
    )
    assert pred.p50 == pytest.approx(b["p50"], abs=2e-4)
    assert pred.confidence == pytest.approx(b["confidence"], abs=2e-4)
    assert pred.prob_profit == pytest.approx(b["prob_profit"], abs=2e-4)
    assert pred.features["data_insufficient"] is True
    assert pred.features["trend_daily"] == pytest.approx(0.0, abs=1e-9)


def test_v2_volume_contradiction_shrinks_p50():
    """缩量上涨：量能不支持趋势，p50 应低于放量上涨场景。"""
    from app.services.prediction import BaselinePredictorV2

    base = dict(
        prices=[10.0, 10.4, 10.8, 11.3, 11.8],
        breakeven_price=10.1,
    )
    up = BaselinePredictorV2().predict("up", **base, volume=6000.0, volume_history=[2000, 2500, 3000, 5000, 6000])
    weak = BaselinePredictorV2().predict("weak", **base, volume=1500.0, volume_history=[4000, 4200, 4500, 4800, 1500])
    assert weak.p50 < up.p50
    assert weak.features["volume_confirm"] == pytest.approx(0.85, abs=1e-9)

# ---------------- 事件日历 + 活动窗口价差修正（v1.4.0） ----------------

def _event_sale():
    from datetime import date
    from app.services.prediction import MarketEvent

    return MarketEvent(kind="steam-sale", start=date(2026, 9, 10), end=date(2026, 9, 16), name="Test Sale", pressure=0.03, recovery_days=14)


def test_v2_event_window_matches_ts_baseline():
    """事件窗口命中（target=2026-09-12 在 9/10~9/16 内）：与 TS 侧 baseline 逐项对拍。"""
    from datetime import datetime
    from app.services.prediction import BaselinePredictorV2

    b = _baseline()["prediction_v2_event"]
    pred = BaselinePredictorV2().predict(
        "V2 Event Case",
        [10.0, 10.4, 10.8, 11.3, 11.8],
        breakeven_price=10.1,
        item_id=1,
        predicted_at=datetime(2026, 9, 5),
        volume=6000.0,
        volume_history=[2000, 2500, 3000, 5000, 6000],
        popular_rank=12,
        events=[_event_sale()],
    )
    assert pred.model_version == b["model_version"]
    for q in ("p10", "p25", "p50", "p75", "p90"):
        assert getattr(pred, q) == pytest.approx(b[q], abs=2e-4)
    assert pred.prob_profit == pytest.approx(b["prob_profit"], abs=2e-4)
    assert pred.prob_loss == pytest.approx(b["prob_loss"], abs=2e-4)
    assert pred.confidence == pytest.approx(b["confidence"], abs=2e-4)
    assert pred.features["event_active"] is True
    assert pred.features["event_count"] == 1
    assert pred.features["event_adjust"] == pytest.approx(-0.03, abs=1e-9)
    assert pred.features["event_kinds"] == "steam-sale"
    assert pred.features["event_names"] == "Test Sale"


def test_v2_event_recovery_linear():
    """结束 7 天后（剩余 7/14 回补期）：factor = 1 + 0.03×(1 - 7/14) = 1.015。"""
    from datetime import date, datetime
    from app.services.prediction import MarketEvent, compute_event_adjust

    ev = MarketEvent(kind="steam-sale", start=date(2026, 9, 3), end=date(2026, 9, 5), name="Sale")
    res = compute_event_adjust(datetime(2026, 9, 12), [ev])
    assert res.factor == pytest.approx(1.015, abs=1e-12)
    assert res.count == 1
    assert res.kinds == ["steam-sale"]
    assert res.names == ["Sale"]


def test_v2_event_no_hit_unchanged():
    """事件未命中时与旧版（无事件参数）完全一致，features 不带 event_*。"""
    from datetime import date, datetime
    from app.services.prediction import BaselinePredictorV2, MarketEvent

    b = _baseline()["prediction_v2"]
    ev = MarketEvent(kind="steam-sale", start=date(2026, 8, 1), end=date(2026, 8, 7), name="Past Sale")
    pred = BaselinePredictorV2().predict(
        "V2 No Hit",
        [10.0, 10.4, 10.8, 11.3, 11.8],
        breakeven_price=10.1,
        predicted_at=datetime(2026, 9, 5),
        volume=6000.0,
        volume_history=[2000, 2500, 3000, 5000, 6000],
        popular_rank=12,
        events=[ev],
    )
    assert pred.p50 == pytest.approx(b["p50"], abs=2e-4)
    assert pred.confidence == pytest.approx(b["confidence"], abs=2e-4)
    assert "event_active" not in pred.features
    assert "event_adjust" not in pred.features


def test_steam_sale_events_2026_has_four():
    from app.services.prediction import STEAM_SALE_EVENTS_2026

    assert len(STEAM_SALE_EVENTS_2026) == 4
    kinds = {ev.kind for ev in STEAM_SALE_EVENTS_2026}
    assert kinds == {"steam-sale"}
    starts = [ev.start.isoformat() for ev in STEAM_SALE_EVENTS_2026]
    assert "2026-06-25" in starts  # 夏促


# ---------------- baseline-robust-v4 ----------------

def _v4_long_series():
    ts0 = 1735689600000
    prices = [round(10 + 2 * math.sin(i / 20) + i * 0.002, 6) for i in range(365)]
    ts = [ts0 + i * 86400000 for i in range(365)]
    vols = [100 + (i * 7) % 90 for i in range(365)]
    return prices, ts, vols


def test_v4_matches_ts_baseline():
    from datetime import datetime
    from app.services.prediction import BaselinePredictorV4, MODEL_VERSION_V4

    b = _baseline()["prediction_v4"]
    pred = BaselinePredictorV4().predict(
        "V4 Test Case",
        [10.0, 10.4, 10.8, 11.3, 11.8],
        breakeven_price=10.1,
        predicted_at=datetime(2026, 9, 5),
        volume=6000.0,
        volume_history=[2000, 2500, 3000, 5000, 6000],
        popular_rank=12,
    )
    assert pred.model_version == MODEL_VERSION_V4
    for q in ("p10", "p25", "p50", "p75", "p90"):
        assert getattr(pred, q) == pytest.approx(b[q], abs=2e-4)
    assert pred.prob_profit == pytest.approx(b["prob_profit"], abs=2e-4)
    assert pred.confidence == pytest.approx(b["confidence"], abs=2e-4)
    assert pred.features["theil_sen_slope"] == pytest.approx(b["features"]["theil_sen_slope"], abs=1e-6)
    assert pred.features["r2"] == pytest.approx(b["features"]["r2"], abs=1e-4)
    assert pred.features["market_state"] == b["features"]["market_state"]


def test_v4_event_matches_ts_baseline():
    from datetime import date, datetime
    from app.services.prediction import BaselinePredictorV4, MarketEvent

    b = _baseline()["prediction_v4_event"]
    pred = BaselinePredictorV4().predict(
        "V4 Event Case",
        [10.0, 10.4, 10.8, 11.3, 11.8],
        breakeven_price=10.1,
        predicted_at=datetime(2026, 9, 5),
        volume=6000.0,
        volume_history=[2000, 2500, 3000, 5000, 6000],
        popular_rank=12,
        events=[MarketEvent(kind="steam-sale", name="Test Sale", start=date(2026, 9, 10), end=date(2026, 9, 16), pressure=0.03, recovery_days=14)],
    )
    for q in ("p10", "p25", "p50", "p75", "p90"):
        assert getattr(pred, q) == pytest.approx(b[q], abs=2e-4)
    assert pred.features["event_names"] == "Test Sale"


def test_v4_low_data_matches_ts_baseline():
    from datetime import datetime
    from app.services.prediction import BaselinePredictorV4

    b = _baseline()["prediction_v4_low"]
    pred = BaselinePredictorV4().predict(
        "V4 Low", [12.0], breakeven_price=10.1, predicted_at=datetime(2026, 9, 5)
    )
    assert pred.p50 == pytest.approx(b["p50"], abs=2e-4)
    assert pred.features["data_insufficient"] is True


def test_v4_long_features_match_ts_baseline():
    """365 天合成序列：Theil-Sen / R² / CV / 均值回归 / 季节性 / 分位 / 波动比 全特征对拍。"""
    from datetime import datetime
    from app.services.prediction import BaselinePredictorV4

    prices, ts, vols = _v4_long_series()
    b = _baseline()["prediction_v4_long"]
    pred = BaselinePredictorV4().predict(
        "V4 Long Case",
        prices,
        breakeven_price=prices[-1] * 0.92,
        predicted_at=datetime(2026, 1, 1),
        volume=float(vols[-1]),
        volume_history=[float(v) for v in vols[-60:]],
        timestamps=ts,
        volumes=[float(v) for v in vols],
    )
    for q in ("p10", "p25", "p50", "p75", "p90"):
        assert getattr(pred, q) == pytest.approx(b[q], abs=2e-4)
    assert pred.confidence == pytest.approx(b["confidence"], abs=2e-4)
    for f in ("theil_sen_slope", "r2", "cv", "mean_rev", "seasonal", "pct_365", "pct_14", "vol_ratio", "sma_365"):
        assert pred.features[f] == pytest.approx(b["features"][f], abs=1e-4)
    assert pred.features["market_state"] == b["features"]["market_state"]
    assert pred.features["history_days"] == 365


def test_v4_high_percentile_suppresses_drift():
    """365 天高位（pct_365 > 0.8）时漂移被压制，P50 低于低位场景。"""
    from datetime import datetime
    from app.services.prediction import BaselinePredictorV4

    up = [round(10 + i * 0.02, 6) for i in range(365)]  # 单调上行 → 当前处于 365d 最高位
    ts = [1735689600000 + i * 86400000 for i in range(365)]
    pred = BaselinePredictorV4().predict(
        "V4 High", up, predicted_at=datetime(2026, 1, 1), timestamps=ts
    )
    assert pred.features["pct_365"] == pytest.approx(1.0, abs=1e-9)
    # 高位抑制后漂移应小于纯 Theil-Sen 斜率
    assert pred.features["trend_daily"] < pred.features["theil_sen_slope"]

