"""api/routes：REST API（供手机端调用）。"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..adapters.steam import SteamAdapter
from ..config import settings
from ..database import get_db
from ..models import InventoryItem, Item, MarketSnapshot, Prediction
from ..schemas import (
    InventoryOut,
    ItemOut,
    PredictionOut,
    Quote,
    RadarItemOut,
    ScenarioOut,
    SimulationOut,
)
from ..services.fees import FeeService
from ..services.inventory import InventoryService
from ..services.monitor import build_pools, MarketTicker
from ..services.prediction import BaselinePredictor
from ..services.profit import ProfitCalculator
from ..services.radar import RadarInput, evaluate
from ..services.simulation import reverse_target, simulate, SimItem

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "app": settings.app_name, "time": datetime.utcnow().isoformat()}


@router.get("/items", response_model=list[ItemOut])
def list_items(db: Session = Depends(get_db)):
    return db.execute(select(Item).order_by(Item.pool)).scalars().all()


def _latest_snapshot(db: Session, item_id: int, source: str) -> MarketSnapshot | None:
    return (
        db.execute(
            select(MarketSnapshot)
            .where(MarketSnapshot.item_id == item_id, MarketSnapshot.source == source)
            .order_by(MarketSnapshot.fetched_at.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )


@router.get("/quote/{market_hash_name}", response_model=Quote)
def quote(market_hash_name: str, db: Session = Depends(get_db)) -> Quote:
    """实时跨市场报价 + 收益计算（数据来自本地快照，未采集到时返回 None 字段）。"""
    item = db.execute(
        select(Item).where(Item.market_hash_name == market_hash_name)
    ).scalar_one_or_none()
    if item is None:
        item = Item(market_hash_name=market_hash_name, name=market_hash_name)
        db.add(item)
        db.commit()
        db.refresh(item)

    fees = FeeService(db).get_bundle()
    calc = ProfitCalculator(
        c5_fee_ratio=fees.c5_buy_fee_ratio,
        steam_seller_receive_ratio=fees.steam_seller_receive_ratio,
    )

    steam_snap = _latest_snapshot(db, item.id, "steam")
    c5_snap = _latest_snapshot(db, item.id, "c5game")
    c5_buy = c5_snap.lowest_price if c5_snap else None
    steam_price = steam_snap.lowest_price if steam_snap else None

    result = calc.calculate(c5_buy, steam_price) if c5_buy and steam_price else None
    signal = "waiting"
    if result is not None:
        signal = "buy" if result.roi >= 0.05 else ("wait" if result.roi >= 0 else "avoid")

    return Quote(
        item_id=item.id,
        market_hash_name=item.market_hash_name,
        c5_buy_price=c5_buy,
        steam_sell_price=steam_price,
        steam_volume=steam_snap.volume if steam_snap else None,
        c5_fee_ratio=fees.c5_buy_fee_ratio,
        steam_seller_receive_ratio=fees.steam_seller_receive_ratio,
        lock_days=settings.lock_days,
        steam_net_receive=result.steam_net_receive if result else None,
        net_profit=result.net_profit if result else None,
        roi=result.roi if result else None,
        breakeven_sell_price=result.breakeven_sell_price if result else None,
        signal=signal,
    )


@router.get("/radar", response_model=list[RadarItemOut])
def radar(db: Session = Depends(get_db)):
    """机会雷达：基于本地快照 + 基线预测，输出全池信号。"""
    items = db.execute(select(Item)).scalars().all()
    fees = FeeService(db).get_bundle()
    calc = ProfitCalculator(fees.c5_buy_fee_ratio, fees.steam_seller_receive_ratio)
    predictor = BaselinePredictor()

    out: list[RadarItemOut] = []
    for item in items:
        steam_snap = _latest_snapshot(db, item.id, "steam")
        c5_snap = _latest_snapshot(db, item.id, "c5game")
        if steam_snap is None or c5_snap is None:
            continue
        # 用最近若干条 steam 快照做简单价格序列
        snaps = (
            db.execute(
                select(MarketSnapshot)
                .where(MarketSnapshot.item_id == item.id, MarketSnapshot.source == "steam")
                .order_by(MarketSnapshot.fetched_at.asc())
            )
            .scalars()
            .all()
        )
        prices = [s.lowest_price for s in snaps if s.lowest_price]
        if len(prices) < 2:
            prices = [c5_snap.lowest_price or 0.0, steam_snap.lowest_price or 0.0]

        pred = predictor.predict(
            item.market_hash_name,
            prices,
            breakeven_price=calc.breakeven_sell_price(c5_snap.lowest_price or 0.0),
            item_id=item.id,
        )
        radar_in = RadarInput(
            market_hash_name=item.market_hash_name,
            c5_buy_price=c5_snap.lowest_price,
            steam_sell_price=steam_snap.lowest_price,
            steam_volume=steam_snap.volume or 0,
            predicted_p50=pred.p50,
            predicted_p25=pred.p25,
            breakeven_price=calc.breakeven_sell_price(c5_snap.lowest_price or 0.0),
            volatility=pred.features.get("volatility", 0.05),
            seller_receive_ratio=fees.steam_seller_receive_ratio,
            c5_fee_ratio=fees.c5_buy_fee_ratio,
        )
        r = evaluate(radar_in)
        out.append(
            RadarItemOut(
                market_hash_name=item.market_hash_name,
                c5_buy_price=c5_snap.lowest_price,
                steam_sell_price=steam_snap.lowest_price,
                expected_roi=r.expected_roi,
                risk_level=r.risk_level,
                liquidity=r.liquidity,
                signal=r.signal,
                score=r.score,
                details={
                    "predicted_p50": pred.p50,
                    "predicted_p25": pred.p25,
                    "breakeven_price": calc.breakeven_sell_price(c5_snap.lowest_price or 0.0),
                    "prob_profit": pred.prob_profit,
                    "confidence": pred.confidence,
                },
            )
        )
    out.sort(key=lambda x: x.score, reverse=True)
    return out


@router.get("/prediction/{market_hash_name}", response_model=PredictionOut)
def prediction(market_hash_name: str, db: Session = Depends(get_db)):
    items = db.execute(
        select(Item).where(Item.market_hash_name == market_hash_name)
    ).scalars().all()
    if not items:
        raise HTTPException(404, "未找到该商品")
    item = items[0]
    snaps = (
        db.execute(
            select(MarketSnapshot)
            .where(MarketSnapshot.item_id == item.id, MarketSnapshot.source == "steam")
            .order_by(MarketSnapshot.fetched_at.asc())
        )
        .scalars()
        .all()
    )
    prices = [s.lowest_price for s in snaps if s.lowest_price]
    if len(prices) < 2:
        raise HTTPException(400, "历史数据不足，无法预测（至少 2 条快照）")
    predictor = BaselinePredictor()
    pred = predictor.predict(market_hash_name, prices, item_id=item.id)
    calc = ProfitCalculator()
    c5_snap = _latest_snapshot(db, item.id, "c5game")
    if c5_snap and c5_snap.lowest_price:
        scenarios = calc.scenarios(
            c5_snap.lowest_price,
            {
                "pessimistic": pred.p25,
                "base": pred.p50,
                "optimistic": pred.p75,
            },
        )
    else:
        scenarios = {}
    return PredictionOut(
        item_id=item.id,
        market_hash_name=market_hash_name,
        model_version=pred.model_version,
        target_at=pred.target_at,
        p10=pred.p10,
        p25=pred.p25,
        p50=pred.p50,
        p75=pred.p75,
        p90=pred.p90,
        prob_profit=pred.prob_profit,
        prob_loss=pred.prob_loss,
        confidence=pred.confidence,
        scenarios=[
            ScenarioOut(label=k, predicted_sell_price=v["predicted_sell_price"], net_profit=v["net_profit"], roi=v["roi"])
            for k, v in scenarios.items()
        ],
    )


@router.get("/inventory", response_model=list[InventoryOut])
def inventory(db: Session = Depends(get_db)):
    svc = InventoryService(db, lock_hours=settings.lock_hours)
    rows = db.execute(select(InventoryItem).order_by(InventoryItem.unlock_at.asc())).scalars().all()
    out = []
    for r in rows:
        snap = _latest_snapshot(db, r.item_id or 0, "steam")
        current = snap.lowest_price if snap else None
        est = svc.compute_estimate(r, current, None)
        out.append(
            InventoryOut(
                id=r.id,
                item_name=r.item_name,
                quantity=r.quantity,
                buy_price=r.buy_price,
                buy_at=r.buy_at,
                source=r.source,
                unlock_at=r.unlock_at,
                days_left=max(0.0, (r.unlock_at - datetime.utcnow()).total_seconds() / 86400.0),
                current_estimate=est.get("current_estimate"),
                net_receive_estimate=est.get("net_receive_now"),
                net_profit_estimate=est.get("net_profit_now"),
                roi_estimate=est.get("roi_now"),
            )
        )
    return out


@router.post("/inventory")
def add_inventory(
    item_name: str,
    quantity: int,
    buy_price: float,
    source: str = "c5game",
    db: Session = Depends(get_db),
):
    svc = InventoryService(db, lock_hours=settings.lock_hours)
    inv = svc.add(item_name, quantity, buy_price, source=source)
    return {"id": inv.id, "unlock_at": inv.unlock_at.isoformat(), "days": settings.lock_days}


@router.get("/simulate", response_model=SimulationOut)
def simulate_endpoint(
    budget: float,
    allocation: str = "balanced",
    db: Session = Depends(get_db),
):
    """资金模拟：基于机会雷达候选，给出组合。"""
    radar_items = radar(db)
    sim_items = []
    for r in radar_items[:20]:
        details = r.details
        sim_items.append(
            SimItem(
                name=r.market_hash_name,
                c5_price=r.c5_buy_price or 0.0,
                predicted_p50=details.get("predicted_p50") or r.steam_sell_price or 0.0,
                predicted_p25=details.get("predicted_p25") or 0.0,
                prob_loss=max(0.0, 1.0 - details.get("prob_profit", 0.5)),
                volume=5000 if r.liquidity == "high" else (1200 if r.liquidity == "medium" else 300),
                risk=r.risk_level,
                liquidity=r.liquidity,
            )
        )
    result = simulate(budget, sim_items, allocation)
    if result is None:
        raise HTTPException(422, "预算不足或候选不足")
    return SimulationOut(
        budget=budget,
        allocation=result.allocation,
        items=result.items,
        total_buy_cost=result.total_buy_cost,
        expected_steam_receive=result.expected_steam_receive,
        expected_net_profit=result.expected_net_profit,
        expected_roi=result.expected_roi,
        weighted_loss_prob=result.weighted_loss_prob,
    )


@router.get("/simulate/reverse")
def simulate_reverse(target_balance: float, roi: float = 0.03):
    return reverse_target(target_balance, roi)
