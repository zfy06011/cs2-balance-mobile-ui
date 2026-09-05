"""adapters/steam：Steam Community Market Adapter。

接口（已验证可行性，见 docs/DATA_SOURCE_REPORT.md）：
- priceoverview：当前价/中位价/成交量
- pricehistory：历史价格（需 cookie）
- search/render：按成交量排序搜索（构建监控池）
遵守限流：单商品间隔 >= steam_req_delay_seconds，失败指数退避。
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.parse

import httpx

from .base import DataAdapter, Snapshot

logger = logging.getLogger(__name__)

MARKET_BASE = "https://steamcommunity.com/market"


class SteamAdapter(DataAdapter):
    source_name = "steam"

    def __init__(
        self,
        appid: int = 730,
        currency: int = 23,
        cookie: str = "",
        delay_seconds: float = 3.0,
        timeout: float = 15.0,
        max_retries: int = 3,
    ):
        self.appid = appid
        self.currency = currency
        self.cookie = cookie
        self.delay_seconds = delay_seconds
        self.timeout = timeout
        self.max_retries = max_retries
        self._headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
            )
        }
        if cookie:
            self._headers["Cookie"] = cookie

    def _sleep(self) -> None:
        time.sleep(self.delay_seconds)

    def _get(self, url: str, params: dict) -> httpx.Response | None:
        for attempt in range(1, self.max_retries + 1):
            try:
                resp = httpx.get(url, params=params, headers=self._headers, timeout=self.timeout)
                if resp.status_code == 200:
                    return resp
                if resp.status_code in (429, 403):
                    backoff = 2 ** attempt * 5
                    logger.warning("Steam 限流/拒绝 (%s)，%ss 后重试", resp.status_code, backoff)
                    time.sleep(backoff)
                    continue
                logger.warning("Steam 返回 %s：%s", resp.status_code, resp.text[:200])
            except httpx.HTTPError as exc:
                logger.warning("Steam 请求失败：%s", exc)
                backoff = 2 ** attempt * 2
                time.sleep(backoff)
        return None

    def get_price(self, market_hash_name: str) -> Snapshot | None:
        self._sleep()
        resp = self._get(
            f"{MARKET_BASE}/priceoverview/",
            {
                "appid": self.appid,
                "currency": self.currency,
                "market_hash_name": market_hash_name,
            },
        )
        if resp is None:
            return None
        try:
            data = resp.json()
        except json.JSONDecodeError:
            logger.error("priceoverview 返回非 JSON：%s", resp.text[:200])
            return None
        if not data.get("success"):
            logger.warning("priceoverview success=false for %s", market_hash_name)
            return None

        def _parse_price(text: str | None) -> float | None:
            if not text:
                return None
            cleaned = text.replace("¥", "").replace("￥", "").replace("元", "").replace(",", "").strip()
            try:
                return float(cleaned)
            except ValueError:
                return None

        return Snapshot(
            source=self.source_name,
            market_hash_name=market_hash_name,
            lowest_price=_parse_price(data.get("lowest_price")),
            median_price=_parse_price(data.get("median_price")),
            volume=int(data["volume"]) if str(data.get("volume", "")).isdigit() else None,
            currency="CNY",
            raw=data,
        )

    def price_history(self, market_hash_name: str) -> list[dict]:
        self._sleep()
        resp = self._get(
            f"{MARKET_BASE}/pricehistory/",
            {"appid": self.appid, "market_hash_name": market_hash_name},
        )
        if resp is None:
            return []
        try:
            data = resp.json()
        except json.JSONDecodeError:
            logger.error("pricehistory 返回非 JSON：%s", resp.text[:200])
            return []
        rows = data.get("prices") or []
        out = []
        for row in rows:
            if len(row) < 3:
                continue
            out.append(
                {
                    "timestamp": row[0],
                    "price": float(row[1].replace(",", "")),
                    "volume": int(row[2]) if str(row[2]).isdigit() else 0,
                    "source": self.source_name,
                }
            )
        return out

    def search(self, query: str = "", start: int = 0, count: int = 100) -> list[Snapshot]:
        self._sleep()
        params = {
            "appid": self.appid,
            "norender": 1,
            "query": query,
            "start": start,
            "count": count,
            "sort_column": "volume",
            "sort_dir": "desc",
        }
        resp = self._get(f"{MARKET_BASE}/search/render/", params)
        if resp is None:
            return []
        try:
            data = resp.json()
        except json.JSONDecodeError:
            logger.error("search/render 返回非 JSON")
            return []
        results = data.get("results") or []
        snapshots = []
        for r in results:
            price = r.get("sell_price")
            snapshots.append(
                Snapshot(
                    source=self.source_name,
                    market_hash_name=r.get("name", ""),
                    lowest_price=float(price) / 100.0 if price else None,
                    sell_listings=r.get("sell_listings"),
                    volume=r.get("sale_price_text") or 0,
                    raw=r,
                )
            )
        return snapshots


async def async_get_price(client: httpx.AsyncClient, adapter: SteamAdapter, name: str) -> Snapshot | None:
    """异步版本：供采集调度器使用"""
    return await asyncio.to_thread(adapter.get_price, name)
