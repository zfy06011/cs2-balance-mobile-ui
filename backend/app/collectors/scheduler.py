"""collectors/scheduler：异步采集任务（APScheduler）。

默认每 30 分钟采集一次核心池/候选池商品价格；
频率可配置且遵守数据源限流（单商品间隔 >= steam_req_delay_seconds）。
"""
from __future__ import annotations

import logging
import time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from ..adapters.steam import SteamAdapter
from ..config import settings
from ..database import SessionLocal
from ..models import Item, MarketSnapshot

logger = logging.getLogger(__name__)


def _store_snapshot(db, item: Item, source: str, lowest, median, volume, raw) -> None:
    snap = MarketSnapshot(
        item_id=item.id,
        source=source,
        currency="CNY",
        lowest_price=lowest,
        median_price=median,
        volume=volume,
        raw=raw,
    )
    db.add(snap)


def collect_round() -> dict:
    """一轮采集：从 items 表取出 core 池商品，逐个拉取 Steam 价格并落库。"""
    db = SessionLocal()
    stats = {"checked": 0, "ok": 0, "failed": 0}
    try:
        adapter = SteamAdapter(
            appid=settings.steam_appid,
            currency=settings.steam_currency,
            cookie=settings.steam_cookie,
            delay_seconds=settings.steam_req_delay_seconds,
        )
        items = db.query(Item).filter(Item.pool.in_(["core", "custom"])).all()
        for item in items:
            stats["checked"] += 1
            try:
                snap = adapter.get_price(item.market_hash_name)
            except Exception as exc:  # noqa: BLE001
                logger.exception("采集失败 %s: %s", item.market_hash_name, exc)
                stats["failed"] += 1
                continue
            if snap is None:
                stats["failed"] += 1
                continue
            _store_snapshot(
                db,
                item,
                snap.source,
                snap.lowest_price,
                snap.median_price,
                snap.volume,
                snap.raw,
            )
            stats["ok"] += 1
            time.sleep(0.2)  # 落库错峰
        db.commit()
    finally:
        db.close()
    return stats


def refresh_market_rank() -> dict:
    """从 Steam search/render 更新监控池排名（核心池/候选池）。"""
    db = SessionLocal()
    stats = {"found": 0, "updated": 0}
    try:
        adapter = SteamAdapter(
            appid=settings.steam_appid,
            currency=settings.steam_currency,
            cookie=settings.steam_cookie,
            delay_seconds=settings.steam_req_delay_seconds,
        )
        snaps = adapter.search(query="case", start=0, count=100)
        # 过滤武器箱/胶囊类
        cases = [s for s in snaps if any(k in s.market_hash_name for k in ("武器箱", "Case", "case", "胶囊", "Capsule"))]
        existing = {i.market_hash_name: i for i in db.query(Item).all()}
        for idx, snap in enumerate(cases):
            pool = "core" if idx < 50 else "candidate"
            item = existing.get(snap.market_hash_name)
            if item:
                if item.pool != pool:
                    item.pool = pool
                    stats["updated"] += 1
            else:
                db.add(
                    Item(
                        market_hash_name=snap.market_hash_name,
                        name=snap.market_hash_name,
                        appid=settings.steam_appid,
                        category="case",
                        pool=pool,
                    )
                )
                stats["updated"] += 1
        stats["found"] = len(cases)
        db.commit()
    finally:
        db.close()
    return stats


_scheduler: BackgroundScheduler | None = None


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    _scheduler = BackgroundScheduler(timezone="UTC")
    interval = max(5, settings.collect_interval_minutes)
    _scheduler.add_job(
        refresh_market_rank,
        IntervalTrigger(minutes=interval * 12),  # 排行榜 6 小时一次
        id="refresh_rank",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.add_job(
        collect_round,
        IntervalTrigger(minutes=interval),
        id="collect",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    logger.info("采集调度器已启动：每 %s 分钟采集，每 %s 小时刷新排行榜", interval, interval * 12 // 60)
    return _scheduler
