"""fees 手续费配置测试"""
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import FeeRule
from app.services.fees import FeeService, DEFAULTS


def _make_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_defaults_when_no_rules():
    svc = FeeService(db=None)
    bundle = svc.get_bundle()
    assert bundle.steam_seller_receive_ratio == 0.8696
    assert bundle.c5_buy_fee_ratio == 0.01


def test_db_rule_overrides_default():
    db = _make_db()
    db.add(
        FeeRule(
            platform="steam",
            fee_type="seller",
            ratio=0.85,
            effective_at=datetime.utcnow() - timedelta(days=1),
            source="test",
        )
    )
    db.commit()
    bundle = FeeService(db).get_bundle()
    assert bundle.steam_seller_receive_ratio == 0.85


def test_future_rule_not_effective():
    db = _make_db()
    db.add(
        FeeRule(
            platform="steam",
            fee_type="seller",
            ratio=0.80,
            effective_at=datetime.utcnow() + timedelta(days=1),
            source="test",
        )
    )
    db.commit()
    bundle = FeeService(db).get_bundle()
    assert bundle.steam_seller_receive_ratio == DEFAULTS["steam_seller_receive_ratio"]
