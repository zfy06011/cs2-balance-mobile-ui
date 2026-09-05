"""inventory：库存管理（文档第十节）。

记录箱子名称、数量、实际买入成本、购买时间、来源、预计解锁/可卖时间；
显示 7 天倒计时；实时计算当前市场估值、预计可到账、预计净利润和 ROI；
区分「当前估值」与「预计解除限制时估值」。
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import InventoryItem


class InventoryService:
    def __init__(self, db: Session, lock_hours: int = 168, seller_receive_ratio: float = 0.8696):
        self.db = db
        self.lock_hours = lock_hours
        self.seller_receive_ratio = seller_receive_ratio

    def add(
        self,
        item_name: str,
        quantity: int,
        buy_price: float,
        buy_at: datetime | None = None,
        source: str = "c5game",
        item_id: int | None = None,
    ) -> InventoryItem:
        buy_at = buy_at or datetime.utcnow()
        unlock_at = buy_at + timedelta(hours=self.lock_hours)
        inv = InventoryItem(
            item_id=item_id,
            item_name=item_name,
            quantity=quantity,
            buy_price=buy_price,
            buy_at=buy_at,
            source=source,
            unlock_at=unlock_at,
        )
        self.db.add(inv)
        self.db.commit()
        self.db.refresh(inv)
        return inv

    def list_items(self) -> list[dict]:
        rows = self.db.execute(
            select(InventoryItem).order_by(InventoryItem.unlock_at.asc())
        ).scalars().all()
        now = datetime.utcnow()
        out = []
        for r in rows:
            days_left = max(0.0, (r.unlock_at - now).total_seconds() / 86400.0)
            out.append(
                {
                    "id": r.id,
                    "item_name": r.item_name,
                    "quantity": r.quantity,
                    "buy_price": r.buy_price,
                    "buy_at": r.buy_at.isoformat(),
                    "source": r.source,
                    "unlock_at": r.unlock_at.isoformat(),
                    "days_left": round(days_left, 2),
                }
            )
        return out

    def compute_estimate(self, inv: InventoryItem, current_market_price: float | None, predicted_price: float | None) -> dict:
        """current_market_price: Steam 当前卖价；predicted_price: 解除限制时预测卖价"""
        buy_total = inv.buy_price * inv.quantity
        base = {
            "id": inv.id,
            "item_name": inv.item_name,
            "quantity": inv.quantity,
            "buy_total_cost": round(buy_total, 2),
        }
        if current_market_price:
            net_now = current_market_price * self.seller_receive_ratio * inv.quantity
            base.update(
                {
                    "current_estimate": round(current_market_price * inv.quantity, 2),
                    "net_receive_now": round(net_now, 2),
                    "net_profit_now": round(net_now - buy_total, 2),
                    "roi_now": round((net_now - buy_total) / buy_total, 4) if buy_total else 0.0,
                }
            )
        if predicted_price:
            net_future = predicted_price * self.seller_receive_ratio * inv.quantity
            base.update(
                {
                    "predicted_estimate": round(predicted_price * inv.quantity, 2),
                    "net_receive_at_unlock": round(net_future, 2),
                    "net_profit_at_unlock": round(net_future - buy_total, 2),
                    "roi_at_unlock": round((net_future - buy_total) / buy_total, 4) if buy_total else 0.0,
                }
            )
        return base
