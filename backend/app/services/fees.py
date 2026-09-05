"""fees：手续费配置服务。

费率必须配置化且版本化（fees 表），禁止写死在业务代码中。
优先级：数据库 fee_rules（按 effective_at 取 <= now 的最新一条） > 代码默认值。
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import FeeRule


# 代码默认值（仅在数据库无配置时兜底，且必须记录 source）
DEFAULTS = {
    # Steam 市场：约 15%（10% Steam + 5% 游戏内），卖家实得 = 挂牌价 / 1.15
    "steam_seller_receive_ratio": 0.8696,
    # C5GAME：2026-04-09 起普通用户 CS2 交易手续费 1%
    "c5_buy_fee_ratio": 0.01,
    # C5GAME 提现手续费（仅供参考，不计入单笔倒余额成本）
    "c5_withdrawal_fee_ratio": 0.009,
}

DEFAULT_SOURCES = {
    "steam_seller_receive_ratio": "Steam 市场官方：10% Steam 费用 + 5% 游戏内费用，卖家实得 1/1.15≈86.96%",
    "c5_buy_fee_ratio": "C5GAME 公告 2026-04-09：CS2 交易手续费普通用户 1%",
    "c5_withdrawal_fee_ratio": "C5GAME 公告：提现手续费约 0.9%",
}


@dataclass(frozen=True)
class FeeBundle:
    """某一时刻生效的费用集合"""
    steam_seller_receive_ratio: float
    c5_buy_fee_ratio: float
    c5_withdrawal_fee_ratio: float
    fee_version: str = "defaults"
    sources: dict = None  # type: ignore[assignment]


class FeeService:
    def __init__(self, db: Session | None = None):
        self._db = db

    def _latest_ratio(self, platform: str, fee_type: str, default: float) -> tuple[float, str]:
        if self._db is None:
            return default, "code-default"
        rule = self._db.execute(
            select(FeeRule)
            .where(
                FeeRule.platform == platform,
                FeeRule.fee_type == fee_type,
                FeeRule.effective_at <= datetime.utcnow(),
            )
            .order_by(FeeRule.effective_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if rule is None:
            return default, "code-default"
        return rule.ratio, f"fee#{rule.id}"

    def get_bundle(self) -> FeeBundle:
        steam_ratio, steam_ver = self._latest_ratio(
            "steam", "seller", DEFAULTS["steam_seller_receive_ratio"]
        )
        c5_ratio, c5_ver = self._latest_ratio("c5game", "buy", DEFAULTS["c5_buy_fee_ratio"])
        wd_ratio, wd_ver = self._latest_ratio(
            "c5game", "withdrawal", DEFAULTS["c5_withdrawal_fee_ratio"]
        )
        return FeeBundle(
            steam_seller_receive_ratio=steam_ratio,
            c5_buy_fee_ratio=c5_ratio,
            c5_withdrawal_fee_ratio=wd_ratio,
            fee_version=f"{steam_ver}|{c5_ver}|{wd_ver}",
            sources={
                "steam_seller_receive_ratio": DEFAULT_SOURCES["steam_seller_receive_ratio"],
                "c5_buy_fee_ratio": DEFAULT_SOURCES["c5_buy_fee_ratio"],
                "c5_withdrawal_fee_ratio": DEFAULT_SOURCES["c5_withdrawal_fee_ratio"],
            },
        )
