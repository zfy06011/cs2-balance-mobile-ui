"""API 集成测试：使用独立 SQLite 内存库 + FastAPI TestClient"""
import os
import pathlib

pathlib.Path("data").mkdir(parents=True, exist_ok=True)
os.environ["DATABASE_URL"] = "sqlite:///./data/test_api.db"
os.environ["ENVIRONMENT"] = "test"

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine, SessionLocal
from app.main import app


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_quote_unknown_item_creates_record(client):
    r = client.get("/api/v1/quote/测试武器箱")
    assert r.status_code == 200
    body = r.json()
    assert body["market_hash_name"] == "测试武器箱"
    assert body["c5_buy_price"] is None  # 未采集，不臆造


def test_radar_empty_ok(client):
    r = client.get("/api/v1/radar")
    assert r.status_code == 200
    assert r.json() == []


def test_inventory_flow(client):
    r = client.post(
        "/api/v1/inventory",
        params={"item_name": "狂牙武器箱", "quantity": 3, "buy_price": 4.5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["days"] == 7
    r2 = client.get("/api/v1/inventory")
    assert len(r2.json()) == 1
    inv = r2.json()[0]
    assert inv["item_name"] == "狂牙武器箱"
    assert inv["days_left"] <= 7.0


def test_prediction_insufficient_data_400(client):
    r = client.get("/api/v1/prediction/不存在箱")
    assert r.status_code == 404


def test_simulate_reverse(client):
    r = client.get("/api/v1/simulate/reverse", params={"target_balance": 1000})
    assert r.status_code == 200
    assert r.json()["required_budget"] > 900
