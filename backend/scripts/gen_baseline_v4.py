"""生成 V4 预测基线（与 verify_core.cjs 的 V4 测试输入完全一致），合并进 scripts/baseline.json。

长周期用例（prediction_v4_long）用确定性合成序列，保证 Python / TS 两侧输入逐点相同：
  prices[i]  = 10 + 2*sin(i/20) + i*0.002   (i = 0..364)
  ts[i]      = 1735689600000 + i*86400000  (2025-01-01T00:00:00Z 起，每日一点)
  volumes[i] = 100 + (i*7) % 90
"""
import json
import math
import sys
from datetime import date, datetime
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.prediction import BaselinePredictorV4, MarketEvent

BASE = Path(__file__).parent / "baseline.json"

TS0 = 1735689600000
LONG_N = 365


def to_jsonable(res):
    d = asdict(res)
    d["predicted_at"] = res.predicted_at.isoformat()
    d["target_at"] = res.target_at.isoformat()
    return d


def long_series():
    prices = [round(10 + 2 * math.sin(i / 20) + i * 0.002, 6) for i in range(LONG_N)]
    ts = [TS0 + i * 86400000 for i in range(LONG_N)]
    vols = [100 + (i * 7) % 90 for i in range(LONG_N)]
    return prices, ts, vols


at = datetime(2026, 9, 5, 0, 0, 0)
p4 = BaselinePredictorV4().predict(
    market_hash_name="V4 Test Case",
    prices=[10, 10.4, 10.8, 11.3, 11.8],
    breakeven_price=10.1,
    predicted_at=at,
    volume=6000,
    volume_history=[2000, 2500, 3000, 5000, 6000],
    popular_rank=12,
)
p4e = BaselinePredictorV4().predict(
    market_hash_name="V4 Event Case",
    prices=[10, 10.4, 10.8, 11.3, 11.8],
    breakeven_price=10.1,
    predicted_at=at,
    volume=6000,
    volume_history=[2000, 2500, 3000, 5000, 6000],
    popular_rank=12,
    events=[MarketEvent(kind="steam-sale", name="Test Sale", start=date(2026, 9, 10), end=date(2026, 9, 16), pressure=0.03, recovery_days=14)],
)
p4low = BaselinePredictorV4().predict(
    market_hash_name="V4 Low",
    prices=[12],
    breakeven_price=10.1,
    predicted_at=at,
)

lp, lts, lvols = long_series()
p4long = BaselinePredictorV4().predict(
    market_hash_name="V4 Long Case",
    prices=lp,
    breakeven_price=lp[-1] * 0.92,
    predicted_at=datetime(2026, 1, 1, 0, 0, 0),
    volume=float(lvols[-1]),
    volume_history=[float(v) for v in lvols[-60:]],
    timestamps=lts,
    volumes=[float(v) for v in lvols],
)

base = json.loads(BASE.read_text(encoding="utf-8"))
base["prediction_v4"] = to_jsonable(p4)
base["prediction_v4_event"] = to_jsonable(p4e)
base["prediction_v4_low"] = to_jsonable(p4low)
base["prediction_v4_long"] = to_jsonable(p4long)
BASE.write_text(json.dumps(base, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("v4 baselines written:",
      {k: base[k]["p50"] for k in ("prediction_v4", "prediction_v4_event", "prediction_v4_low", "prediction_v4_long")},
      base["prediction_v4"]["model_version"], base["prediction_v4"]["confidence"])
print("v4 long features:", base["prediction_v4_long"]["features"])
