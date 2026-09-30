# Tectonic Hackathon: Black Swan 🦢

**KBC case: improve the experience of spenders.**

Customers opt in to a small game in the KBC app. A model learns their spending
behaviour and sets a personal **daily spending limit**. Staying under it keeps
their swan healthy. Regular overspending makes it sick, then it rots and dies.
Money left under the limit builds a **buffer** that is invested in a KBC fund at
month end, so good habits turn into passive income.

```
 KBC app / core banking                    Black Swan service (this repo)
 ─────────────────────                     ──────────────────────────────
 opt-in            ── PUT enrollment ─────▶  store enrollment
 booked txs        ── POST transactions ──▶  store txs (idempotent)
                                             model: learn profile ──▶ daily limit
                                             engine: replay days ──▶ swan, buffer, events
 swan screen       ◀── GameState JSON ─────  (returned inline or via GET game-state)
 month-end sweep   ◀── rewards.sweeps ─────  buffer to invest per month
```

## Repo layout

| Path | What |
|---|---|
| `backend/blackswan/model.py` | Spending model: splits fixed, recurring, discretionary and large one-offs, learns the daily baseline and weekday pattern |
| `backend/blackswan/engine.py` | Game engine: replays every day since enrollment (limit, buffer/debt, swan health, events, sweeps) |
| `backend/blackswan/api.py` | FastAPI app that KBC and the demo frontend call |
| `backend/blackswan/schemas.py` | **API contract** (request and response models) |
| `backend/blackswan/config.py` | Every tunable number (difficulty, health tuning, thresholds) |
| `backend/blackswan/synthetic.py` | Fake KBC customers (4 personas) for demos |
| `frontend/` | Demo UI (Vite + React), work in progress |
| `docs/API.md` | Integration guide for KBC with example payloads |
| `docs/GAME_RULES.md` | Game rules, model details, open questions |

## Run the backend

```bash
uv venv --python 3.13 .venv && uv pip install --python .venv -r backend/requirements-dev.txt
cd backend
../.venv/bin/uvicorn blackswan.api:app --reload --port 8000
```

- Interactive docs: http://localhost:8000/docs
- Every `/v1/*` call needs the header `X-API-Key: dev-key` (set real keys with `SWAN_API_KEYS=key1,key2`)
- SQLite file: `backend/data/swan.db` (override with `SWAN_DB_PATH`)

Try it in one call:

```bash
curl -s -X POST localhost:8000/v1/demo/seed -H 'X-API-Key: dev-key' -H 'content-type: application/json' \
  -d '{"persona":"big_purchase","as_of":"2026-09-30","enrolled_days_ago":29}'
```

Then scrub through time with `GET /v1/users/demo-big_purchase/game-state?as_of=2026-09-14`.

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q
```
