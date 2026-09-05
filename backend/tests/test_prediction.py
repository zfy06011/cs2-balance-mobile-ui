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
