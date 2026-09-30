import pytest
from fastapi.testclient import TestClient

from blackswan.api import create_app
from blackswan.store import Store
from conftest import ENROLLED

H = {"X-API-Key": "test-key"}


@pytest.fixture
def client():
    return TestClient(create_app(Store(":memory:"), {"test-key"}))


def tx_json(tx_list):
    return [t.model_dump(mode="json") for t in tx_list]


def test_health_is_open(client):
    assert client.get("/health").json()["status"] == "ok"


def test_requires_api_key(client):
    assert client.get("/v1/funds").status_code == 401
    assert client.get("/v1/funds", headers={"X-API-Key": "nope"}).status_code == 401
    assert client.get("/v1/funds", headers=H).status_code == 200


def test_full_kbc_flow(client, tx):
    r = client.put("/v1/users/u1/enrollment", json={"enrolled_on": ENROLLED.isoformat()}, headers=H)
    assert r.status_code == 200 and r.json()["difficulty"] == "normal"

    history = tx_json(tx.history())
    r = client.post("/v1/users/u1/transactions", json={"transactions": history}, params={"as_of": "2026-09-01"}, headers=H)
    body = r.json()
    assert body["accepted"] == 90 and body["duplicates"] == 0
    assert body["game_state"]["today"]["limit"] == pytest.approx(18)

    r = client.post("/v1/users/u1/transactions", json={"transactions": history[:10]}, params={"include_state": False}, headers=H)
    assert r.json() == {"accepted": 0, "duplicates": 10, "game_state": None}

    r = client.get("/v1/users/u1/game-state", params={"as_of": "2026-09-05"}, headers=H)
    assert r.status_code == 200
    state = r.json()
    assert state["swan"]["tier"] in {"thriving", "healthy"}
    assert len(state["history"]) == 5

    assert client.get("/v1/users/u1/profile", headers=H).json()["target_daily"] == pytest.approx(18)


def test_game_state_before_enrollment_is_422(client, tx):
    client.put("/v1/users/u1/enrollment", json={"enrolled_on": ENROLLED.isoformat()}, headers=H)
    r = client.get("/v1/users/u1/game-state", params={"as_of": "2026-08-01"}, headers=H)
    assert r.status_code == 422


def test_data_only_accepted_after_opt_in_and_deleted_on_opt_out(client, tx):
    body = {"transactions": tx_json(tx.history(days=3))}
    assert client.post("/v1/users/u2/transactions", json=body, headers=H).status_code == 404

    client.put("/v1/users/u2/enrollment", json={}, headers=H)
    assert client.post("/v1/users/u2/transactions", json=body, params={"include_state": False}, headers=H).json()["accepted"] == 3

    assert client.delete("/v1/users/u2/enrollment", headers=H).status_code == 204
    assert client.get("/v1/users/u2/game-state", headers=H).status_code == 404
    client.put("/v1/users/u2/enrollment", json={}, headers=H)
    assert client.post("/v1/users/u2/transactions", json=body, params={"include_state": False}, headers=H).json()["accepted"] == 3


def test_unknown_fund_rejected(client):
    r = client.put("/v1/users/u1/enrollment", json={"fund_id": "nope"}, headers=H)
    assert r.status_code == 422


def test_evaluate_is_stateless(client, tx):
    body = {
        "user_id": "anon",
        "enrollment": {"enrolled_on": ENROLLED.isoformat(), "difficulty": "hard"},
        "transactions": tx_json(tx.history()),
        "as_of": "2026-09-01",
    }
    r = client.post("/v1/evaluate", json=body, headers=H)
    assert r.status_code == 200
    assert r.json()["model"]["target_daily"] == pytest.approx(16)
    assert client.get("/v1/users/anon/enrollment", headers=H).status_code == 404


@pytest.mark.parametrize("persona", ["steady_saver", "weekend_splurger", "impulse_spender", "big_purchase"])
def test_demo_seed_personas(client, persona):
    r = client.post("/v1/demo/seed", json={"persona": persona, "as_of": "2026-09-30", "enrolled_days_ago": 29}, headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == f"demo-{persona}"
    assert body["game_state"]["month"]["month"] == "2026-09"
    r = client.get(f"/v1/users/demo-{persona}/game-state", params={"as_of": "2026-09-15"}, headers=H)
    assert r.status_code == 200


def test_demo_personas_tell_their_story(client):
    def seed(p):
        return client.post(
            "/v1/demo/seed", json={"persona": p, "as_of": "2026-09-30", "enrolled_days_ago": 29}, headers=H
        ).json()["game_state"]

    assert seed("steady_saver")["swan"]["tier"] == "thriving"
    seed("impulse_spender")
    timeline = client.get("/v1/users/demo-impulse_spender/timeline", params={"as_of": "2026-09-30"}, headers=H).json()
    assert any(c["swan_died"] for c in timeline["cycles"])
    big = seed("big_purchase")
    assert any(e["type"] in ("large_expense_uncovered", "large_expense_absorbed", "large_expense_unaffordable") for e in big["events"])


def test_deck_cases_tell_their_story(client):
    def run(key):
        client.post("/v1/demo/seed", json={"persona": key, "as_of": "2026-09-30"}, headers=H)
        tl = client.get(f"/v1/users/demo-{key}/timeline", params={"as_of": "2026-09-30"}, headers=H).json()
        gs = client.get(f"/v1/users/demo-{key}/game-state", params={"as_of": "2026-09-30"}, headers=H).json()
        return gs, tl

    sofie, tl = run("sofie_steady")
    assert sofie["month"]["cycle_type"] == "wage" and sofie["rewards"]["total_invested"] > 200
    assert not any(c["swan_died"] for c in tl["cycles"])

    lucas, tl = run("lucas_freelancer")
    assert lucas["month"]["cycle_type"] == "calendar" and lucas["rewards"]["total_invested"] > 100
    assert not any(c["swan_died"] for c in tl["cycles"])

    emma, tl = run("emma_gourmet")
    assert emma["model"]["affordable_daily"] < emma["model"]["baseline_daily"] * 0.6
    assert emma["rewards"]["total_invested"] == 0
    assert all(c["swan_died"] for c in tl["cycles"] if c["closed"])

    jonas, tl = run("jonas_impulse")
    assert jonas["rewards"]["total_invested"] == 0
    assert all(c["swan_died"] for c in tl["cycles"])
    assert any(e["type"] == "large_expense_unaffordable" for e in jonas["events"])


# ---------------------------------------------------------------- hardening


def test_security_headers(client):
    r = client.get("/v1/funds", headers=H)
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"
    assert "default-src 'none'" in r.headers["content-security-policy"]
    assert "content-security-policy" not in client.get("/docs").headers


def test_cors_only_allows_local_frontend(client):
    ok = client.options("/v1/funds", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options("/v1/funds", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


def test_demo_seed_cannot_touch_real_users(client):
    client.put("/v1/users/u1/enrollment", json={}, headers=H)
    r = client.post("/v1/demo/seed", json={"persona": "steady_saver", "user_id": "u1"}, headers=H)
    assert r.status_code == 422
    assert client.get("/v1/users/u1/enrollment", headers=H).status_code == 200


def test_replay_window_is_bounded(client):
    client.put("/v1/users/u1/enrollment", json={"enrolled_on": ENROLLED.isoformat()}, headers=H)
    assert client.get("/v1/users/u1/game-state", params={"as_of": "9999-12-31"}, headers=H).status_code == 422
    assert client.get("/v1/users/u1/timeline", params={"as_of": "2040-01-01"}, headers=H).status_code == 422
    assert client.put("/v1/users/u1/enrollment", json={"enrolled_on": "0001-01-01"}, headers=H).status_code == 422
    r = client.post("/v1/demo/seed", json={"persona": "sofie_steady", "as_of": "9999-12-31"}, headers=H)
    assert r.status_code == 422


def test_rejects_non_finite_and_oversized_input(client, tx):
    client.put("/v1/users/u1/enrollment", json={}, headers=H)
    nan = '{"transactions": [{"transaction_id": "x", "booking_date": "2026-09-01", "amount": NaN}]}'
    r = client.post("/v1/users/u1/transactions", content=nan, headers={**H, "content-type": "application/json"})
    assert r.status_code == 422
    long_id = {"transactions": [{"transaction_id": "x" * 500, "booking_date": "2026-09-01", "amount": -1}]}
    assert client.post("/v1/users/u1/transactions", json=long_id, headers=H).status_code == 422
    body = {"user_id": "../../etc", "enrollment": {}, "transactions": []}
    assert client.post("/v1/evaluate", json=body, headers=H).status_code == 422


def test_production_mode(monkeypatch):
    monkeypatch.setenv("SWAN_ENV", "production")
    monkeypatch.delenv("SWAN_API_KEYS", raising=False)
    with pytest.raises(RuntimeError):
        create_app(Store(":memory:"))
    monkeypatch.setenv("SWAN_API_KEYS", "dev-key")
    with pytest.raises(RuntimeError):
        create_app(Store(":memory:"))

    monkeypatch.setenv("SWAN_API_KEYS", "prod-key")
    prod = TestClient(create_app(Store(":memory:")))
    assert prod.get("/v1/funds", headers={"X-API-Key": "dev-key"}).status_code == 401
    assert prod.get("/v1/funds", headers={"X-API-Key": "prod-key"}).status_code == 200
    assert prod.get("/docs").status_code == 404
    assert prod.get("/v1/demo/personas", headers={"X-API-Key": "prod-key"}).status_code == 404
