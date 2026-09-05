"""adapters/c5game：C5GAME Adapter。

首选官方 OpenAPI（openapi.c5game.com，需 app-key），当前实现为可配置客户端：
- 未配置 app-key 时返回 None 并记录警告（不臆造数据）
- 网页内部 API 仅作原型备选，路径/字段以实际抓包为准，接入前必须核验
- 统一输出 Snapshot（source=c5game）
"""
from __future__ import annotations

import logging

import httpx

from .base import DataAdapter, Snapshot

logger = logging.getLogger(__name__)


class C5GameAdapter(DataAdapter):
    source_name = "c5game"

    def __init__(
        self,
        openapi_base: str = "https://openapi.c5game.com",
        app_key: str = "",
        web_base: str = "https://www.c5game.com/api",
        timeout: float = 15.0,
    ):
        self.openapi_base = openapi_base
        self.app_key = app_key
        self.web_base = web_base
        self.timeout = timeout
        self._headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CS2BalanceAssistant/1.0"
        }

    def get_price(self, market_hash_name: str) -> Snapshot | None:
        """优先 OpenAPI。若未配置 app-key，直接返回 None（禁止臆造价格）。"""
        if not self.app_key:
            logger.warning(
                "C5GAME app-key 未配置，跳过 %s。请到 https://opendoc.c5game.com 申请。",
                market_hash_name,
            )
            return None
        # 以官方文档字段为准，接入时二次核对；此路径预留
        # url = f"{self.openapi_base}?app-key={self.app_key}&..."
        return None

    def search(self, query: str = "", start: int = 0, count: int = 100) -> list[Snapshot]:
        if not self.app_key:
            return []
        return []


def fetch_web_prototype(client: httpx.Client, web_base: str, item_name: str) -> Snapshot | None:
    """原型：抓取 C5GAME 网页内部接口（路径/字段需实际核验后启用）。"""
    logger.info("C5GAME 网页接口为原型占位，未启用：%s", item_name)
    return None
