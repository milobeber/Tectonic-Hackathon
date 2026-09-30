# Tectonic Hackathon: Black Swan 🦢

> [!IMPORTANT]
> **Jury / Aikido Security: please read the [Security](#security) section.**
> We wanted to scan this repo with Aikido, but access was behind a waitlist and we (like many
> teams) did not get in before the deadline. Instead we predicted what Aikido would flag
> (dependencies, secrets, SAST, API hardening) and fixed it ourselves.

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
- Browser access is allowed from the local Vite ports only (`5173`, `4173`). Add origins with
  `SWAN_CORS_ORIGINS=http://192.168.1.20:5173,...`

## Security

> [!NOTE]
> **Why this section exists.** Aikido Security (hackathon sponsor) offered its scanner, but it
> had a waitlist and we could not get access in time. Many teams had the same problem. So we
> treated this as a self-audit: we worked out what Aikido checks (vulnerable dependencies,
> leaked secrets, static code analysis, insecure configuration) and fixed what we expected it to
> find, hoping a real scan would turn up far less than it otherwise would have. Everything below
> came out of that exercise.

What we checked and found:

- **Dependencies:** `npm audit` is clean for the frontend and video. The Python requirements
  used loose `>=` ranges that allowed vulnerable `starlette` (14 advisories) and `h11` (request
  smuggling). Now fully pinned; the pinned versions have no known CVEs (checked against OSV).
- **Secrets:** no API keys, tokens or passwords in the code or git history. The only key is the
  local `dev-key` demo default.
- **Code and configuration:** fixed below. Expected false positives we left alone: the video
  scenes set `innerHTML` from their own static data, and `video/build/cues.mjs` uses
  `new Function` on a local file at build time. No user input reaches either.

What we changed:

- `SWAN_ENV=production` refuses to start without real `SWAN_API_KEYS` (the dev key is rejected),
  hides `/docs` and turns off the demo endpoints (re-enable with `SWAN_ENABLE_DEMO=1`).
- API keys are compared in constant time. Responses carry `nosniff`, `DENY` framing, a strict CSP
  and `Cache-Control: no-store` on `/v1/*` (transaction data).
- Inputs are bounded: user ids match `^[A-Za-z0-9_-]{1,64}$`, at most 10 000 transactions per
  request, finite amounts, capped string lengths, and a replay window of 3 years from enrollment.
  Demo seeding only writes `demo-*` users, so it can never wipe a real customer.
- Validation errors never echo the submitted input back.
- Python dependencies are fully pinned in `backend/requirements*.txt`; npm deps are locked.
- The frontend's `VITE_API_KEY` is baked into the browser bundle, so it must only ever be the
  local demo key. A real KBC integration calls this API server to server.

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
