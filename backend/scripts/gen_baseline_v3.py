"""生成 V3 预测基线（与 verify_core.cjs 的 V3 测试输入完全一致），合并进 scripts/baseline.json。"""
import json
import sys
from datetime import date, datetime
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.prediction import BaselinePredictorV3, MarketEvent

BASE = Path(__file__).parent / "baseline.json"


def to_jsonable(res):
    d = asdict(res)
    d["predicted_at"] = res.predicted_at.isoformat()
    d["target_at"] = res.target_at.isoformat()
    return d


at = datetime(2026, 9, 5, 0, 0, 0)
p3 = BaselinePredictorV3().predict(
    market_hash_name="V3 Test Case",
    prices=[10, 10.4, 10.8, 11.3, 11.8],
    breakeven_price=10.1,
    predicted_at=at,
    volume=6000,
    volume_history=[2000, 2500, 3000, 5000, 6000],
    popular_rank=12,
)
p3e = BaselinePredictorV3().predict(
    market_hash_name="V3 Event Case",
    prices=[10, 10.4, 10.8, 11.3, 11.8],
    breakeven_price=10.1,
    predicted_at=at,
    volume=6000,
    volume_history=[2000, 2500, 3000, 5000, 6000],
    popular_rank=12,
    events=[MarketEvent(kind="steam-sale", name="Test Sale", start=date(2026, 9, 10), end=date(2026, 9, 16), pressure=0.03, recovery_days=14)],
)
p3low = BaselinePredictorV3().predict(
    market_hash_name="V3 Low",
    prices=[12],
    breakeven_price=10.1,
    predicted_at=at,
)

base = json.loads(BASE.read_text(encoding="utf-8"))
base["prediction_v3"] = to_jsonable(p3)
base["prediction_v3_event"] = to_jsonable(p3e)
base["prediction_v3_low"] = to_jsonable(p3low)
BASE.write_text(json.dumps(base, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("v3 baselines written:",
      {k: base[k]["p50"] for k in ("prediction_v3", "prediction_v3_event", "prediction_v3_low")},
      base["prediction_v3"]["model_version"], base["prediction_v3"]["confidence"])
