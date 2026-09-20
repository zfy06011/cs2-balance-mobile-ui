"""prediction：7 天限制期价格预测（文档第六节）。

第一版使用可解释基线模型，不用机器学习：
- 动量基线：P50 = 最新价 × (1 + 近 7 日动量 × 动量衰减系数)
- 区间：基于日收益率标准差（波动率）与正态分位数扩展 P10/P25/P50/P75/P90
- 盈利/亏损概率：以盈亏平衡价为阈值，用对数正态近似计算
- 输出必须包含 model_version、输入数据时间范围、预测目标时间

注意：本模块不产生任何市场数据，只基于传入的价格序列计算；输入必须来自真实快照。
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Literal

MODEL_VERSION = "baseline-momentum-v1"

# 正态分位数
_Z = {"p10": -1.2816, "p25": -0.6745, "p50": 0.0, "p75": 0.6745, "p90": 1.2816}


@dataclass(frozen=True)
class PredictionResult:
    item_id: int | None
    market_hash_name: str
    model_version: str
    predicted_at: datetime
    target_at: datetime
    horizon_days: int
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    prob_profit: float
    prob_loss: float
    confidence: float
    features: dict = field(default_factory=dict)


class BaselinePredictor:
    def __init__(
        self,
        horizon_days: int = 7,
        momentum_days: int = 7,
        momentum_decay: float = 0.5,
        min_history: int = 15,
    ):
        self.horizon_days = horizon_days
        self.momentum_days = momentum_days
        self.momentum_decay = momentum_decay
        self.min_history = min_history

    def predict(
        self,
        market_hash_name: str,
        prices: list[float],
        dates: list[datetime] | None = None,
        breakeven_price: float | None = None,
        item_id: int | None = None,
        predicted_at: datetime | None = None,
    ) -> PredictionResult:
        """prices: 按时间升序的历史价格（至少 min_history 条）。

        使用对数收益率；若历史不足则退化为保守区间（扩大波动率）。
        """
        if len(prices) < 2:
            raise ValueError("至少需要 2 条历史价格才能预测")

        latest = prices[-1]
        log_returns = [
            math.log(prices[i] / prices[i - 1]) for i in range(1, len(prices)) if prices[i - 1] > 0
        ]
        vol = statistics.pstdev(log_returns) if len(log_returns) >= 2 else 0.05
        # 数据不足时放大不确定性
        if len(prices) < self.min_history:
            vol = max(vol, 0.05) * 1.5

        # 动量：近 momentum_days 的累计对数收益
        window = prices[-self.momentum_days:]
        momentum = 0.0
        if len(window) >= 2 and window[0] > 0:
            momentum = math.log(window[-1] / window[0])

        drift = momentum * self.momentum_decay
        sigma_total = vol * math.sqrt(self.horizon_days)

        p50 = latest * math.exp(drift)
        quantiles = {q: round(p50 * math.exp(_Z[q] * sigma_total), 4) for q in _Z}
        # 价格不能为负
        for q in quantiles:
            quantiles[q] = max(quantiles[q], 0.0)

        # 盈利概率（假设对数价格近似正态）：P(log(price) > log(breakeven))
        prob_profit = 0.5
        if breakeven_price and breakeven_price > 0:
            if sigma_total < 1e-9:
                prob_profit = 1.0 if p50 > breakeven_price else (0.0 if p50 < breakeven_price else 0.5)
            else:
                mu = math.log(p50)
                prob_profit = 1.0 - _normal_cdf((math.log(breakeven_price) - mu) / sigma_total)
        prob_profit = max(0.0, min(1.0, prob_profit))
        prob_loss = 1.0 - prob_profit

        # 置信度：数据量越多、波动率越低越自信（0~1）
        confidence = max(0.1, min(0.95, 1.0 - sigma_total * 3.0))

        pred_at = predicted_at or datetime.utcnow()
        return PredictionResult(
            item_id=item_id,
            market_hash_name=market_hash_name,
            model_version=MODEL_VERSION,
            predicted_at=pred_at,
            target_at=pred_at + timedelta(days=self.horizon_days),
            horizon_days=self.horizon_days,
            **quantiles,
            prob_profit=round(prob_profit, 4),
            prob_loss=round(prob_loss, 4),
            confidence=round(confidence, 4),
            features={
                "latest_price": latest,
                "momentum": round(momentum, 6),
                "volatility": round(vol, 6),
                "history_len": len(prices),
                "input_reduced": True,
            },
        )


def _normal_cdf(x: float) -> float:
    """标准正态分布 CDF（Abramowitz-Stegun 近似）"""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


# =====================================================================
# baseline-momentum-v2：推荐/雷达使用的增强版预测（与 mobile/core/prediction.ts 对齐）
# 优化点：
#  1) 趋势改为窗口内对数价格最小二乘回归斜率（不足 4 点退化为首末对数收益），
#     单日漂移限幅 5%，防短窗口外推爆炸；
#  2) 量价配合：最新成交量 vs 历史均量显著放大/萎缩时按方向放大/缩小漂移；
#  3) 历史不足 4 点标记 data_insufficient（置信度封顶 0.25），供雷达封顶 wait；
#  4) 置信度叠加历史长度因子与量价微调。
# =====================================================================

MODEL_VERSION_V2 = "baseline-momentum-v2"

# 市场事件类型：Steam 大促 / 游戏内活动 / Major 赛事 / 新箱子发布 / 箱子移除 / Valve 政策
MarketEventKind = Literal[
    "steam-sale", "game-event", "major", "case-release", "case-removal", "valve-policy"
]


@dataclass(frozen=True)
class MarketEvent:
    kind: MarketEventKind
    start: date          # 开始日期（UTC，含当天）
    end: date            # 结束日期（UTC，含当天）
    name: str | None = None
    pressure: float | None = None       # 窗口内价差幅度（默认 0.03 = 3%）
    recovery_days: int | None = None    # 事件结束后回补天数（默认 14；仅 suppress 类有效）
    impact: str | None = None           # suppress / boost；缺省按 kind 推断


@dataclass(frozen=True)
class EventAdjustResult:
    factor: float        # 总价差乘数：1=无影响；<1 压制；>1 回补/提振
    count: int           # 命中事件数
    kinds: list[str]     # 命中事件种类（去重、保序）
    names: list[str]     # 命中事件名称（去重、保序）


def _default_impact(ev: MarketEvent) -> str:
    if ev.impact:
        return ev.impact
    return "suppress" if ev.kind in ("steam-sale", "valve-policy", "case-removal") else "boost"


def compute_event_adjust(target_at: datetime, events: list[MarketEvent]) -> EventAdjustResult:
    """计算 target_at 的事件价差修正（与 mobile/core/prediction.ts 对齐）。

    - suppress（大促/政策利空）：窗口内（含首尾日）×(1 - pressure)；结束后 recovery_days 天内
      ×(1 + pressure × (1 - d / recovery_days)) 线性回补
    - boost（Major/春节等需求提振）：窗口内 ×(1 + pressure)；开始前 3 天预期 ×(1 + pressure/2)；无回补尾
    - 多事件命中按乘法叠加；空列表时 factor = 1
    """
    factor = 1.0
    count = 0
    kinds: list[str] = []
    names: list[str] = []
    target_day = target_at.date()
    for ev in events:
        start_day = ev.start
        end_day = ev.end
        pressure = ev.pressure if ev.pressure is not None else 0.03
        impact = _default_impact(ev)
        hit = False
        if impact == "boost":
            if start_day <= target_day <= end_day:
                factor *= 1.0 + pressure
                hit = True
            else:
                d = (start_day - target_day).days
                if 0 < d <= 3:
                    factor *= 1.0 + pressure / 2
                    hit = True
        else:
            if start_day <= target_day <= end_day:
                factor *= 1.0 - pressure
                hit = True
            else:
                d = (target_day - end_day).days
                recovery_days = ev.recovery_days if ev.recovery_days is not None else 14
                if 0 < d <= recovery_days:
                    factor *= 1.0 + pressure * (1.0 - d / recovery_days)
                    hit = True
        if hit:
            count += 1
            if ev.kind not in kinds:
                kinds.append(ev.kind)
            nm = (ev.name or "").strip()
            if nm and nm not in names:
                names.append(nm)
    return EventAdjustResult(factor=factor, count=count, kinds=kinds, names=names)


# Steam 2026 官方大促日历（UTC 日期近似）：窗口内压制 3%，结束后 14 天内线性回补
STEAM_SALE_EVENTS_2026: list[MarketEvent] = [
    MarketEvent(kind="steam-sale", start=date(2026, 3, 19), end=date(2026, 3, 26), name="Steam 春季特卖"),
    MarketEvent(kind="steam-sale", start=date(2026, 6, 25), end=date(2026, 7, 9), name="Steam 夏季特卖"),
    MarketEvent(kind="steam-sale", start=date(2026, 10, 1), end=date(2026, 10, 8), name="Steam 秋季特卖"),
    MarketEvent(kind="steam-sale", start=date(2026, 12, 17), end=date(2027, 1, 4), name="Steam 冬季特卖"),
]


def _least_squares_slope(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = sum((x - mx) ** 2 for x in xs)
    return num / den if den > 0 else 0.0


class BaselinePredictorV2:
    def __init__(
        self,
        horizon_days: int = 7,
        trend_days: int = 7,
        momentum_decay: float = 0.5,
        min_history: int = 15,
        min_trend_points: int = 4,
        max_daily_drift: float = 0.05,
    ):
        self.horizon_days = horizon_days
        self.trend_days = trend_days
        self.momentum_decay = momentum_decay
        self.min_history = min_history
        self.min_trend_points = min_trend_points
        self.max_daily_drift = max_daily_drift

    def predict(
        self,
        market_hash_name: str,
        prices: list[float],
        breakeven_price: float | None = None,
        item_id: int | None = None,
        predicted_at: datetime | None = None,
        volume: float | None = None,
        volume_history: list[float] | None = None,
        popular_rank: int | None = None,
        events: list[MarketEvent] | None = None,
    ) -> PredictionResult:
        if len(prices) < 1:
            raise ValueError("至少需要 1 条历史价格才能预测")

        latest = prices[-1]
        log_returns = [
            math.log(prices[i] / prices[i - 1]) for i in range(1, len(prices)) if prices[i - 1] > 0
        ]
        vol = statistics.pstdev(log_returns) if len(log_returns) >= 2 else 0.05
        if len(prices) < self.min_history:
            vol = max(vol, 0.05) * 1.5

        # 趋势：对数价格回归斜率 或 首末对数收益
        window = prices[-self.trend_days:]
        insufficient = len(prices) < self.min_trend_points
        raw_drift = 0.0
        trend_clamped = False
        if len(window) >= 2:
            if len(window) >= self.min_trend_points:
                xs = [float(i) for i in range(len(window))]
                ys = [math.log(p) for p in window]
                raw_drift = _least_squares_slope(xs, ys)
            elif window[0] > 0:
                raw_drift = math.log(window[-1] / window[0]) / (len(window) - 1)
            if raw_drift > self.max_daily_drift:
                raw_drift = self.max_daily_drift
                trend_clamped = True
            elif raw_drift < -self.max_daily_drift:
                raw_drift = -self.max_daily_drift
                trend_clamped = True

        # 量价配合
        volume_ratio: float | None = None
        volume_confirm = 1.0
        if volume is not None and volume > 0 and volume_history and len(volume_history) >= 2:
            base = volume_history[:-1]
            pos = [v for v in base if v and v > 0]
            avg = sum(pos) / len(pos) if pos else 0.0
            if avg > 0:
                volume_ratio = volume / avg
                if raw_drift > 0.0005 and volume_ratio >= 1.3:
                    volume_confirm = 1.15
                elif raw_drift > 0.0005 and volume_ratio <= 0.6:
                    volume_confirm = 0.85
                elif raw_drift < -0.0005 and volume_ratio >= 1.3:
                    volume_confirm = 1.15
                elif raw_drift < -0.0005 and volume_ratio <= 0.6:
                    volume_confirm = 0.85
        drift_daily = raw_drift * volume_confirm

        drift = drift_daily * self.horizon_days * self.momentum_decay
        sigma_total = vol * math.sqrt(self.horizon_days)
        pred_at = predicted_at or datetime.utcnow()
        target_at = pred_at + timedelta(days=self.horizon_days)
        # 事件窗口价差修正：压制期 ×(1-pressure)，结束后 recovery_days 天内线性回补
        event_res = compute_event_adjust(target_at, events or [])
        event_factor = event_res.factor
        p50 = latest * math.exp(drift) * event_factor

        quantiles = {q: max(round(p50 * math.exp(_Z[q] * sigma_total), 4), 0.0) for q in _Z}

        prob_profit = 0.5
        if breakeven_price and breakeven_price > 0:
            if sigma_total < 1e-9:
                prob_profit = 1.0 if p50 > breakeven_price else (0.0 if p50 < breakeven_price else 0.5)
            else:
                mu = math.log(p50)
                prob_profit = 1.0 - _normal_cdf((math.log(breakeven_price) - mu) / sigma_total)
        prob_profit = max(0.0, min(1.0, prob_profit))
        prob_loss = 1.0 - prob_profit

        confidence = max(0.1, min(0.95, 1.0 - sigma_total * 3.0))
        len_factor = 0.6 + 0.4 * min(1.0, max(1, len(prices)) / self.min_history)
        confidence *= len_factor
        if insufficient:
            confidence = min(confidence, 0.25)
        if volume_confirm != 1.0:
            confidence = max(0.1, min(0.95, confidence + (0.05 if volume_confirm > 1 else -0.05)))
        confidence = round(confidence, 4)

        # 事件命中：对大促等事件窗口内的预测打 9 折置信度（保留 0.1~0.95 封顶）
        if event_res.count > 0:
            confidence = max(0.1, min(0.95, confidence * 0.9))
            confidence = round(confidence, 4)

        anchor = max(0, len(prices) - self.trend_days)
        momentum = math.log(latest / prices[anchor]) if len(prices) >= 2 and prices[anchor] > 0 else 0.0

        features: dict = {
            "latest_price": round(latest, 4),
            "momentum": round(momentum, 6),
            "trend_daily": round(raw_drift, 6),
            "volatility": round(vol, 6),
            "history_len": len(prices),
            "data_insufficient": insufficient,
            "trend_clamped": trend_clamped,
            "volume_confirm": volume_confirm,
        }
        if volume_ratio is not None:
            features["volume_ratio"] = round(volume_ratio, 3)
        if popular_rank is not None and popular_rank > 0:
            features["popular_rank"] = popular_rank
        if event_res.count > 0:
            features["event_active"] = True
            features["event_count"] = event_res.count
            features["event_adjust"] = round(event_factor - 1.0, 6)
            features["event_kinds"] = ",".join(event_res.kinds)
            features["event_names"] = ",".join(event_res.names)

        return PredictionResult(
            item_id=item_id,
            market_hash_name=market_hash_name,
            model_version=MODEL_VERSION_V2,
            predicted_at=pred_at,
            target_at=target_at,
            horizon_days=self.horizon_days,
            **quantiles,
            prob_profit=round(prob_profit, 4),
            prob_loss=round(prob_loss, 4),
            confidence=confidence,
            features=features,
        )


MODEL_VERSION_V3 = "baseline-momentum-v3"


class BaselinePredictorV3:
    """V3：EW 加权 21 点对数回归（半衰期 7）+ EWMA 波动率（λ=0.94）
    + 连续量价确认（tanh 映射，[0.85,1.15]）+ 波动自适应漂移限幅（min(2%, max(0.5%, 3σ)))。
    与 mobile/src/core/prediction.ts#BaselinePredictorV3 逐位对齐。"""

    def __init__(
        self,
        horizon_days: int = 7,
        trend_days: int = 21,
        trend_half_life: float = 7.0,
        momentum_decay: float = 0.5,
        min_history: int = 15,
        min_trend_points: int = 3,
        ewma_lambda: float = 0.94,
    ):
        self.horizon_days = horizon_days
        self.trend_days = trend_days
        self.trend_half_life = trend_half_life
        self.momentum_decay = momentum_decay
        self.min_history = min_history
        self.min_trend_points = min_trend_points
        self.ewma_lambda = ewma_lambda

    def predict(
        self,
        market_hash_name: str,
        prices: list[float],
        breakeven_price: float | None = None,
        item_id: int | None = None,
        predicted_at: datetime | None = None,
        volume: float | None = None,
        volume_history: list[float] | None = None,
        popular_rank: int | None = None,
        events: list[MarketEvent] | None = None,
    ) -> PredictionResult:
        if len(prices) < 1:
            raise ValueError("至少需要 1 条历史价格才能预测")

        latest = prices[-1]
        log_returns = [
            math.log(prices[i] / prices[i - 1]) for i in range(1, len(prices)) if prices[i - 1] > 0
        ]
        # EWMA 波动率
        ew_var = 0.0
        has_ew = False
        for r in log_returns:
            ew_var = self.ewma_lambda * ew_var + (1 - self.ewma_lambda) * r * r if has_ew else r * r
            has_ew = True
        vol = math.sqrt(ew_var) if has_ew else 0.05
        if len(prices) < self.min_history:
            vol = max(vol, 0.05) * 1.5

        # 趋势：EW 加权对数回归（或首末对数收益回退）
        window = prices[-self.trend_days:]
        insufficient = len(prices) < self.min_trend_points
        drift_clamp = min(0.02, max(0.005, 3 * vol))
        raw_drift = 0.0
        trend_clamped = False
        if len(window) >= 2:
            if len(window) >= self.min_trend_points:
                n = len(window)
                sw = sx = sy = sxx = sxy = 0.0
                for i, p in enumerate(window):
                    w = 0.5 ** ((n - 1 - i) / self.trend_half_life)
                    sw += w
                    sx += w * i
                    sy += w * math.log(p)
                    sxx += w * i * i
                    sxy += w * i * math.log(p)
                den = sw * sxx - sx * sx
                raw_drift = (sw * sxy - sx * sy) / den if den > 0 else 0.0
            elif window[0] > 0:
                raw_drift = math.log(window[-1] / window[0]) / (len(window) - 1)
            if raw_drift > drift_clamp:
                raw_drift = drift_clamp
                trend_clamped = True
            elif raw_drift < -drift_clamp:
                raw_drift = -drift_clamp
                trend_clamped = True

        # 量价配合：连续映射
        volume_ratio: float | None = None
        volume_confirm = 1.0
        if volume is not None and volume > 0 and volume_history and len(volume_history) >= 2:
            base = volume_history[:-1]
            pos = [v for v in base if v and v > 0]
            avg = sum(pos) / len(pos) if pos else 0.0
            if avg > 0:
                volume_ratio = volume / avg
                if abs(raw_drift) > 0.0005:
                    volume_confirm = max(0.85, min(1.15, 1 + 0.15 * math.tanh((volume_ratio - 1) / 0.35)))
        drift_daily = raw_drift * volume_confirm

        drift = drift_daily * self.horizon_days * self.momentum_decay
        sigma_total = vol * math.sqrt(self.horizon_days)
        pred_at = predicted_at or datetime.utcnow()
        target_at = pred_at + timedelta(days=self.horizon_days)
        event_res = compute_event_adjust(target_at, events or [])
        event_factor = event_res.factor
        p50 = latest * math.exp(drift) * event_factor

        quantiles = {q: max(round(p50 * math.exp(_Z[q] * sigma_total), 4), 0.0) for q in _Z}

        prob_profit = 0.5
        if breakeven_price and breakeven_price > 0:
            if sigma_total < 1e-9:
                prob_profit = 1.0 if p50 > breakeven_price else (0.0 if p50 < breakeven_price else 0.5)
            else:
                mu = math.log(p50)
                prob_profit = 1.0 - _normal_cdf((math.log(breakeven_price) - mu) / sigma_total)
        prob_profit = max(0.0, min(1.0, prob_profit))
        prob_loss = 1.0 - prob_profit

        confidence = max(0.1, min(0.95, 1.0 - sigma_total * 3.0))
        len_factor = 0.6 + 0.4 * min(1.0, max(1, len(prices)) / self.min_history)
        confidence *= len_factor
        if insufficient:
            confidence = min(confidence, 0.25)
        if volume_confirm > 1.03:
            confidence = max(0.1, min(0.95, confidence + 0.05))
        elif volume_confirm < 0.97:
            confidence = max(0.1, min(0.95, confidence - 0.05))
        confidence = round(confidence, 4)

        if event_res.count > 0:
            confidence = max(0.1, min(0.95, confidence * 0.9))
            confidence = round(confidence, 4)

        anchor = max(0, len(prices) - 7)
        momentum = math.log(latest / prices[anchor]) if len(prices) >= 2 and prices[anchor] > 0 else 0.0

        features: dict = {
            "latest_price": round(latest, 4),
            "momentum": round(momentum, 6),
            "trend_daily": round(raw_drift, 6),
            "volatility": round(vol, 6),
            "history_len": len(prices),
            "data_insufficient": insufficient,
            "trend_clamped": trend_clamped,
            "volume_confirm": round(volume_confirm, 4),
            "trend_points": len(window),
            "drift_clamp": round(drift_clamp, 6),
        }
        if volume_ratio is not None:
            features["volume_ratio"] = round(volume_ratio, 3)
        if popular_rank is not None and popular_rank > 0:
            features["popular_rank"] = popular_rank
        if event_res.count > 0:
            features["event_active"] = True
            features["event_count"] = event_res.count
            features["event_adjust"] = round(event_factor - 1.0, 6)
            features["event_kinds"] = ",".join(event_res.kinds)
            features["event_names"] = ",".join(event_res.names)

        return PredictionResult(
            item_id=item_id,
            market_hash_name=market_hash_name,
            model_version=MODEL_VERSION_V3,
            predicted_at=pred_at,
            target_at=target_at,
            horizon_days=self.horizon_days,
            **quantiles,
            prob_profit=round(prob_profit, 4),
            prob_loss=round(prob_loss, 4),
            confidence=confidence,
            features=features,
        )


MODEL_VERSION_V4 = "baseline-robust-v4"


def _median(xs: list[float]) -> float:
    if not xs:
        return 0.0
    return statistics.median(xs)


def _stddev(xs: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mean = sum(xs) / n
    return math.sqrt(sum((x - mean) ** 2 for x in xs) / n)


def _log_returns(prices: list[float]) -> list[float]:
    out: list[float] = []
    for i in range(1, len(prices)):
        if prices[i - 1] > 0 and prices[i] > 0:
            out.append(math.log(prices[i] / prices[i - 1]))
    return out


def theil_sen_slope(ys: list[float]) -> float:
    """所有点对 (j,i) 斜率的中位数（对异常值鲁棒）。"""
    n = len(ys)
    if n < 2:
        return 0.0
    slopes: list[float] = []
    for i in range(1, n):
        for j in range(i):
            if ys[j] > 0 and ys[i] > 0:
                slopes.append((math.log(ys[i]) - math.log(ys[j])) / (i - j))
    return _median(slopes) if slopes else 0.0


def _r_squared(ys: list[float]) -> float:
    n = len(ys)
    if n < 3:
        return 0.0
    logs = [math.log(y) if y > 0 else 0.0 for y in ys]
    mx = sum(range(n)) / n
    my = sum(logs) / n
    sxx = sum((i - mx) ** 2 for i in range(n))
    sxy = sum((i - mx) * (logs[i] - my) for i in range(n))
    slope = sxy / sxx if sxx > 0 else 0.0
    ss_tot = sum((logs[i] - my) ** 2 for i in range(n))
    ss_res = sum((logs[i] - (my + slope * (i - mx))) ** 2 for i in range(n))
    if ss_tot <= 0:
        return 0.0
    return max(0.0, min(1.0, 1.0 - ss_res / ss_tot))


def _percentile_of(window: list[float], latest: float) -> float | None:
    if not window:
        return None
    below = sum(1 for p in window if p <= latest)
    return below / len(window)


class BaselinePredictorV4:
    """V4：长周期鲁棒预测器（借鉴 steam-skin-ops / AetherSwap / cs2-market-bot）。
    与 mobile/src/core/prediction.ts#BaselinePredictorV4 逐位对齐。"""

    def __init__(
        self,
        horizon_days: int = 7,
        trend_days: int = 21,
        momentum_decay: float = 0.5,
        min_history: int = 15,
        min_trend_points: int = 3,
        ewma_lambda: float = 0.94,
        kappa: float = 0.02,
        seasonal_weight: float = 0.5,
        min_long_history: int = 180,
        momentum_blend: float = 0.6,
    ):
        self.horizon_days = horizon_days
        self.trend_days = trend_days
        self.momentum_decay = momentum_decay
        self.min_history = min_history
        self.min_trend_points = min_trend_points
        self.ewma_lambda = ewma_lambda
        self.kappa = kappa
        self.seasonal_weight = seasonal_weight
        self.min_long_history = min_long_history
        self.momentum_blend = momentum_blend

    def predict(
        self,
        market_hash_name: str,
        prices: list[float],
        breakeven_price: float | None = None,
        item_id: int | None = None,
        predicted_at: datetime | None = None,
        volume: float | None = None,
        volume_history: list[float] | None = None,
        popular_rank: int | None = None,
        timestamps: list[int] | None = None,
        volumes: list[float | None] | None = None,
        events: list[MarketEvent] | None = None,
    ) -> PredictionResult:
        if len(prices) < 1:
            raise ValueError("至少需要 1 条历史价格才能预测")

        # 按 UTC 日去重（每日保留最后一个点）
        # v1.8.1：同步生成日级规范时间戳（day*86400000），否则两数组长度不等会让
        # _seasonal_daily 直接返回 0（季节性特征永远失效）。
        day_ts = timestamps
        if timestamps is not None and len(timestamps) == len(prices):
            by_day: dict[int, float] = {}
            for i in range(len(prices)):
                t = timestamps[i]
                if not math.isfinite(t):
                    continue
                day = int(t // 86400000)
                by_day[day] = prices[i]
            order = sorted(by_day.keys())
            prices = [by_day[d] for d in order]
            day_ts = [d * 86400000 for d in order]

        latest = prices[-1]
        log_returns = _log_returns(prices)

        ew_var = 0.0
        has_ew = False
        for r in log_returns:
            ew_var = self.ewma_lambda * ew_var + (1 - self.ewma_lambda) * r * r if has_ew else r * r
            has_ew = True
        ewma_vol = math.sqrt(ew_var) if has_ew else 0.05
        if len(prices) < self.min_history:
            ewma_vol = max(ewma_vol, 0.05) * 1.5

        window = prices[-self.trend_days:]
        insufficient = len(prices) < self.min_trend_points
        drift_clamp = min(0.02, max(0.005, 3 * ewma_vol))

        trend_slope = 0.0
        if len(window) >= self.min_trend_points:
            trend_slope = theil_sen_slope(window)
        elif len(window) >= 2 and window[0] > 0:
            trend_slope = math.log(window[-1] / window[0]) / (len(window) - 1)
        r2 = _r_squared(window)

        # 方向补充：近 7 日对数动量（Theil-Sen 偏平，混入它以提升方向准确率）
        momentum_daily = 0.0
        mom_idx = max(0, len(prices) - 7)
        if len(prices) >= 2 and prices[mom_idx] > 0 and latest > 0:
            momentum_daily = math.log(latest / prices[mom_idx]) / (len(prices) - 1 - mom_idx)
        trend_mixed = (1 - self.momentum_blend) * trend_slope + self.momentum_blend * momentum_daily

        win30 = prices[-30:]
        cv = 0.0
        if len(win30) >= 2:
            mean30 = sum(win30) / len(win30)
            if mean30 > 0:
                cv = _stddev(win30) / mean30
        cv_threshold = 0.04 if latest >= 100 else 0.08

        win365 = prices[-365:]
        win14 = prices[-14:]
        pct365 = _percentile_of(win365, latest)
        pct14 = _percentile_of(win14, latest)

        mean_rev = 0.0
        sma365: float | None = None
        if len(win365) >= self.min_long_history:
            sma365 = sum(win365) / len(win365)
            if sma365 > 0 and latest > 0:
                mean_rev = -self.kappa * math.log(latest / sma365)

        vol30 = 0.0
        vol365 = 0.0
        ret30 = _log_returns(prices[-31:])
        ret365 = _log_returns(prices[-366:])
        if len(ret30) >= 2:
            vol30 = _stddev(ret30)
        if len(ret365) >= 2:
            vol365 = _stddev(ret365)
        vol_ratio: float | None = None
        if vol30 > 0 and vol365 > 0:
            vol_ratio = vol30 / vol365

        seasonal = self._seasonal_daily(prices, day_ts, predicted_at or datetime.utcnow())

        volume_ratio: float | None = None
        volume_confirm = 1.0
        if volume is not None and volume > 0 and volume_history and len(volume_history) >= 2:
            base = volume_history[:-1]
            pos = [v for v in base if v and v > 0]
            avg = sum(pos) / len(pos) if pos else 0.0
            if avg > 0:
                volume_ratio = volume / avg
                if abs(trend_slope) > 0.0005:
                    volume_confirm = max(0.85, min(1.15, 1 + 0.15 * math.tanh((volume_ratio - 1) / 0.35)))

        trend_eps = 0.0005
        if cv > cv_threshold * 2 or (len(window) >= 3 and r2 < 0.3 and abs(trend_slope) > trend_eps * 4):
            market_state = "CHAOS"
        elif trend_slope > trend_eps and r2 >= 0.6:
            market_state = "RISING"
        elif trend_slope < -trend_eps and r2 >= 0.6:
            market_state = "FALLING"
        else:
            market_state = "STABLE"

        drift_daily = trend_mixed + mean_rev
        if pct365 is not None and pct365 > 0.8:
            drift_daily *= 0.5
        if vol_ratio is not None and vol_ratio > 1.5:
            drift_daily *= 0.7
        drift_daily *= volume_confirm
        drift_daily += seasonal
        trend_clamped = False
        if drift_daily > drift_clamp:
            drift_daily = drift_clamp
            trend_clamped = True
        elif drift_daily < -drift_clamp:
            drift_daily = -drift_clamp
            trend_clamped = True

        sigma_daily = max(ewma_vol, vol30, 0.5 * vol365 if vol365 > 0 else 0.0)
        if sigma_daily <= 0:
            sigma_daily = 0.05
        regime_factor = 1.2 if (vol_ratio is not None and vol_ratio > 1.5) else 1.0
        sigma_total = sigma_daily * regime_factor * math.sqrt(self.horizon_days)

        drift = drift_daily * self.horizon_days * self.momentum_decay
        pred_at = predicted_at or datetime.utcnow()
        target_at = pred_at + timedelta(days=self.horizon_days)
        event_res = compute_event_adjust(target_at, events or [])
        p50 = latest * math.exp(drift) * event_res.factor

        quantiles = {q: max(round(p50 * math.exp(_Z[q] * sigma_total), 4), 0.0) for q in _Z}

        prob_profit = 0.5
        if breakeven_price and breakeven_price > 0:
            if sigma_total < 1e-9:
                prob_profit = 1.0 if p50 > breakeven_price else (0.0 if p50 < breakeven_price else 0.5)
            else:
                prob_profit = 1.0 - _normal_cdf((math.log(breakeven_price) - math.log(p50)) / sigma_total)
        prob_profit = max(0.0, min(1.0, prob_profit))
        prob_loss = 1.0 - prob_profit

        confidence = max(0.1, min(0.95, 1.0 - sigma_total * 3.0))
        len_factor = 0.6 + 0.4 * min(1.0, max(1, len(prices)) / self.min_history)
        confidence *= len_factor
        confidence *= 0.8 + 0.2 * r2
        confidence *= 0.7 if market_state == "CHAOS" else (1.0 if market_state == "STABLE" else 0.95)
        if regime_factor > 1:
            confidence /= regime_factor
        if insufficient:
            confidence = min(confidence, 0.25)
        if volume_confirm > 1.03:
            confidence += 0.05
        elif volume_confirm < 0.97:
            confidence -= 0.05
        confidence = max(0.1, min(0.95, confidence))
        if event_res.count > 0:
            confidence = max(0.1, min(0.95, confidence * 0.9))
        confidence = round(confidence, 4)

        anchor = max(0, len(prices) - 7)
        momentum = math.log(latest / prices[anchor]) if len(prices) >= 2 and prices[anchor] > 0 else 0.0

        features: dict = {
            "latest_price": round(latest, 4),
            "momentum": round(momentum, 6),
            "trend_daily": round(drift_daily, 6),
            "theil_sen_slope": round(trend_slope, 6),
            "momentum_daily": round(momentum_daily, 6),
            "r2": round(r2, 4),
            "cv": round(cv, 6),
            "volatility": round(sigma_daily, 6),
            "history_len": len(prices),
            "history_days": len(prices),
            "data_insufficient": insufficient,
            "trend_clamped": trend_clamped,
            "volume_confirm": round(volume_confirm, 4),
            "trend_points": len(window),
            "drift_clamp": round(drift_clamp, 6),
            "market_state": market_state,
            "mean_rev": round(mean_rev, 6),
            "seasonal": round(seasonal, 6),
        }
        if pct365 is not None:
            features["pct_365"] = round(pct365, 4)
        if pct14 is not None:
            features["pct_14"] = round(pct14, 4)
        if vol_ratio is not None:
            features["vol_ratio"] = round(vol_ratio, 4)
        if sma365 is not None:
            features["sma_365"] = round(sma365, 4)
        if volume_ratio is not None:
            features["volume_ratio"] = round(volume_ratio, 3)
        if popular_rank is not None and popular_rank > 0:
            features["popular_rank"] = popular_rank
        if event_res.count > 0:
            features["event_active"] = True
            features["event_count"] = event_res.count
            features["event_adjust"] = round(event_res.factor - 1.0, 6)
            features["event_kinds"] = ",".join(event_res.kinds)
            features["event_names"] = ",".join(event_res.names)

        return PredictionResult(
            item_id=item_id,
            market_hash_name=market_hash_name,
            model_version=MODEL_VERSION_V4,
            predicted_at=pred_at,
            target_at=target_at,
            horizon_days=self.horizon_days,
            **quantiles,
            prob_profit=round(prob_profit, 4),
            prob_loss=round(prob_loss, 4),
            confidence=confidence,
            features=features,
        )

    def _seasonal_daily(
        self, prices: list[float], timestamps: list[int] | None, pred_at: datetime
    ) -> float:
        """目标月份在往年同月的对数收益均值 ÷ 30 × 权重；需 ≥min_long_history 点。"""
        if not timestamps or len(timestamps) != len(prices) or len(prices) < self.min_long_history:
            return 0.0
        target_month = pred_at.month
        by_year: dict[int, list[float]] = {}
        for i in range(len(prices)):
            t = timestamps[i]
            if not math.isfinite(t) or prices[i] <= 0:
                continue
            d = datetime.utcfromtimestamp(t / 1000.0)
            if d.month != target_month:
                continue
            by_year.setdefault(d.year, []).append(prices[i])
        rets: list[float] = []
        for y, vals in by_year.items():
            if y >= pred_at.year:
                continue
            if vals and vals[0] > 0 and vals[-1] > 0:
                rets.append(math.log(vals[-1] / vals[0]))
        if not rets:
            return 0.0
        mean_ret = sum(rets) / len(rets)
        return (mean_ret / 30.0) * self.seasonal_weight