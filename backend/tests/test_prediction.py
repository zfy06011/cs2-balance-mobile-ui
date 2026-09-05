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