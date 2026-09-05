from datetime import datetime
from pydantic import BaseModel, Field


class ItemOut(BaseModel):
    id: int
    market_hash_name: str
    name: str
    appid: int = 730
    category: str = "case"
    pool: str = "candidate"

    model_config = {"from_attributes": True}


class SnapshotOut(BaseModel):
    id: int
    item_id: int
    source: str
    currency: str = "CNY"
    lowest_price: float | None = None
    median_price: float | None = None
    sell_listings: int | None = None
    volume: int | None = None
    fetched_at: datetime

    model_config = {"from_attributes": True}


class Quote(BaseModel):
    """单个武器箱的跨市场报价（计算后）"""
    item_id: int | None = None
    market_hash_name: str
    c5_buy_price: float | None = None          # C5GAME 买入价
    steam_sell_price: float | None = None      # Steam 当前卖价（挂牌价）
    steam_volume: int | None = None
    c5_fee_ratio: float = 0.01
    steam_seller_receive_ratio: float = 0.8696
    lock_days: int = 7

    # 收益模型输出
    steam_net_receive: float | None = None     # Steam 实际到账 = 卖价*0.8696
    net_profit: float | None = None            # 净利润
    roi: float | None = None                   # ROI
    breakeven_sell_price: float | None = None  # 盈亏平衡卖出价
    signal: str = "waiting"                    # buy / wait / avoid


class ScenarioOut(BaseModel):
    label: str  # pessimistic / base / optimistic
    predicted_sell_price: float
    net_profit: float
    roi: float


class PredictionOut(BaseModel):
    item_id: int
    market_hash_name: str
    model_version: str
    target_at: datetime
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    prob_profit: float
    prob_loss: float
    confidence: float
    scenarios: list[ScenarioOut] = Field(default_factory=list)


class RadarItemOut(BaseModel):
    market_hash_name: str
    c5_buy_price: float | None = None
    steam_sell_price: float | None = None
    expected_roi: float | None = None
    risk_level: str = "medium"   # low / medium / high
    liquidity: str = "medium"    # low / medium / high
    signal: str = "waiting"
    score: float = 0.0
    details: dict = Field(default_factory=dict)


class SimulationOut(BaseModel):
    budget: float
    allocation: str  # conservative / balanced / aggressive
    items: list[dict] = Field(default_factory=list)
    total_buy_cost: float = 0.0
    expected_steam_receive: float = 0.0
    expected_net_profit: float = 0.0
    expected_roi: float = 0.0
    weighted_loss_prob: float = 0.0


class InventoryOut(BaseModel):
    id: int
    item_name: str
    quantity: int
    buy_price: float
    buy_at: datetime
    source: str = "c5game"
    unlock_at: datetime
    days_left: float = 0.0
    current_estimate: float | None = None
    net_receive_estimate: float | None = None
    net_profit_estimate: float | None = None
    roi_estimate: float | None = None
