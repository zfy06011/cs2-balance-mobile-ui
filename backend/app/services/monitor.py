"""monitor：监控池管理（文档第四节）。

核心池默认 Top 50 成交量、候选池 51-100，排名动态更新，支持自定义关注。
第一版提供纯函数计算，后续由采集任务调用 Steam search/render 更新排名。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

CORE_POOL_SIZE = 50
CANDIDATE_POOL_SIZE = 100  # 51-100
CASE_KEYWORDS = ("武器箱", "case", "Case", "胶囊", "Stamp", "Capsule")


@dataclass
class MarketTicker:
    market_hash_name: str
    volume: int = 0
    sell_price: float | None = None
    selListings: int | None = None


def is_case_name(name: str) -> bool:
    return any(k in name for k in CASE_KEYWORDS)


def build_pools(tickers: list[MarketTicker]) -> dict[str, list[MarketTicker]]:
    """按成交量排序，返回 core（前 50）与 candidate（51-100）。"""
    cases = [t for t in tickers if is_case_name(t.market_hash_name)]
    cases.sort(key=lambda t: t.volume, reverse=True)
    return {
        "core": cases[:CORE_POOL_SIZE],
        "candidate": cases[CORE_POOL_SIZE:CANDIDATE_POOL_SIZE],
        "all": cases,
    }


def one_click_discover(
    core: list[MarketTicker],
    candidate: list[MarketTicker],
    quote_fn: Callable[[str], dict],
) -> list[dict]:
    """一键发现：扫描候选池及可用数据，寻找高流动性、较低买入价、合理价差、较高净 ROI、
    低/中风险对象。quote_fn 返回该商品跨市场报价字典（c5_buy_price/steam_sell_price/roi/risk）。
    """
    discovered = []
    for t in candidate:
        try:
            q = quote_fn(t.market_hash_name)
        except Exception:
            continue
        roi = q.get("expected_roi") or q.get("roi")
        if roi is None:
            continue
        risk = q.get("risk_level", "medium")
        score = roi * 1000 + t.volume * 0.001
        if roi > 0.02 and risk in ("low", "medium"):
            discovered.append(
                {
                    "market_hash_name": t.market_hash_name,
                    "volume": t.volume,
                    "roi": roi,
                    "risk_level": risk,
                    "score": round(score, 4),
                }
            )
    discovered.sort(key=lambda d: d["score"], reverse=True)
    return discovered
