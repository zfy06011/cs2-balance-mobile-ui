from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    String,
    Text,
    DateTime,
    Float,
    Integer,
    Boolean,
    ForeignKey,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_naive() -> datetime:
    # 为兼容 SQLite，统一存 naive UTC
    return datetime.utcnow()


class Item(Base):
    """items：武器箱基本信息"""
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(primary_key=True)
    market_hash_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    appid: Mapped[int] = mapped_column(Integer, default=730)
    category: Mapped[str] = mapped_column(String(32), default="case")  # case / sticker / capsule
    pool: Mapped[str] = mapped_column(String(16), default="candidate")  # core / candidate / custom

    snapshots = relationship("MarketSnapshot", back_populates="item")


class MarketSnapshot(Base):
    """market_snapshots：市场快照，source、item、price、volume、timestamp"""
    __tablename__ = "market_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), index=True)
    source: Mapped[str] = mapped_column(String(32), index=True)  # steam / c5game
    currency: Mapped[str] = mapped_column(String(8), default="CNY")
    lowest_price: Mapped[float | None]
    median_price: Mapped[float | None]
    sell_listings: Mapped[int | None]
    volume: Mapped[int | None]
    raw: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, index=True)

    item = relationship("Item", back_populates="snapshots")


class FeeRule(Base):
    """fees：手续费规则及生效时间（版本化）"""
    __tablename__ = "fees"

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String(32), index=True)  # steam / c5game / withdrawal
    fee_type: Mapped[str] = mapped_column(String(32), default="seller")  # seller / buyer
    ratio: Mapped[float]  # 例如 steam=0.15（买家总费）或 seller_receive=0.8696
    mode: Mapped[str] = mapped_column(String(32), default="ratio")  # ratio / fixed
    effective_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    source: Mapped[str] = mapped_column(String(255))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class Event(Base):
    """events：特殊事件数据库"""
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    start_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    end_at: Mapped[datetime | None]
    event_type: Mapped[str] = mapped_column(String(64), index=True)  # sale / major / update / promo
    scope: Mapped[str] = mapped_column(String(32), default="all")  # all / cases / specific
    items: Mapped[list | None] = mapped_column(JSON, nullable=True)  # 受影响物品名
    impact_direction: Mapped[str | None] = mapped_column(String(16), nullable=True)  # up / down / unknown
    impact_duration_days: Mapped[int | None]
    source: Mapped[str] = mapped_column(String(255))
    confidence: Mapped[float] = mapped_column(Float, default=0.5)  # 0-1


class Prediction(Base):
    """predictions：模型预测及版本"""
    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), index=True)
    model_version: Mapped[str] = mapped_column(String(64), index=True)
    predicted_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, index=True)
    target_at: Mapped[datetime] = mapped_column(DateTime, index=True)  # 预计可卖时点
    horizon_days: Mapped[int] = mapped_column(Integer, default=7)
    p10: Mapped[float]
    p25: Mapped[float]
    p50: Mapped[float]
    p75: Mapped[float]
    p90: Mapped[float]
    prob_profit: Mapped[float]
    prob_loss: Mapped[float]
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    features: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # 输入数据版本/特征
    input_data_version: Mapped[str | None] = mapped_column(String(64), nullable=True)


class PredictionResult(Base):
    """prediction_results：预测与真实结果"""
    __tablename__ = "prediction_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    prediction_id: Mapped[int] = mapped_column(ForeignKey("predictions.id"), index=True)
    actual_price: Mapped[float | None]
    actual_at: Mapped[datetime | None]
    error: Mapped[float | None]
    hit: Mapped[bool | None]  # 实际是否落在 P10-P90 区间
    evaluated_at: Mapped[datetime | None]


class Backtest(Base):
    """backtests：回测任务及结果"""
    __tablename__ = "backtests"

    id: Mapped[int] = mapped_column(primary_key=True)
    model_version: Mapped[str] = mapped_column(String(64), index=True)
    start_at: Mapped[datetime]
    end_at: Mapped[datetime]
    metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # mae/rmse/方向准确率/区间覆盖率等
    status: Mapped[str] = mapped_column(String(16), default="running")  # running / done / failed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)


class InventoryItem(Base):
    """inventory：用户库存"""
    __tablename__ = "inventory"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    buy_price: Mapped[float]  # 单件 C5GAME 实际总成本
    buy_at: Mapped[datetime] = mapped_column(DateTime)
    source: Mapped[str] = mapped_column(String(32), default="c5game")
    unlock_at: Mapped[datetime] = mapped_column(DateTime, index=True)  # 预计可卖时间


class Transaction(Base):
    """transactions：用户实际/模拟交易"""
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_name: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    side: Mapped[str] = mapped_column(String(8))  # buy / sell
    price: Mapped[float]
    fee: Mapped[float] = mapped_column(Float, default=0.0)
    net_amount: Mapped[float]
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)


class AlertRule(Base):
    """alerts：提醒规则与触发记录"""
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)  # roi / risk / price / volume / unlock
    item_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    operator: Mapped[str] = mapped_column(String(8), default="gte")  # gte / lte
    threshold: Mapped[float | None]
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_triggered_at: Mapped[datetime | None]
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class AppSetting(Base):
    """settings：采集频率、监控数量、风险偏好等（KV）"""
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)
