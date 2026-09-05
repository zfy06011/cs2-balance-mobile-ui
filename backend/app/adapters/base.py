"""adapters/base：Data Adapter 抽象层。

更换数据源时不得修改分析核心：所有外部数据统一为 MarketTicker/Snapshot 结构，
必须携带 source 与 timestamp。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Snapshot:
    source: str
    market_hash_name: str
    lowest_price: float | None = None
    median_price: float | None = None
    sell_listings: int | None = None
    volume: int | None = None
    currency: str = "CNY"
    raw: dict | None = None
    fetched_at: datetime = field(default_factory=datetime.utcnow)


class DataAdapter(ABC):
    source_name: str = "base"

    @abstractmethod
    def get_price(self, market_hash_name: str) -> Snapshot | None: ...

    @abstractmethod
    def search(self, query: str = "", start: int = 0, count: int = 100) -> list[Snapshot]: ...
