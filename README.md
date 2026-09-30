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
| `backend/blackswan/cases.py` | The four story-driven deck customers (Sofie, Lucas, Emma, Jonas) |
| `backend/blackswan/store.py` | SQLite persistence (enrollments and raw transactions only) |
| `frontend/` | Demo UI (Vite + React): the swan screen as it would appear in KBC Mobile |
| `video/` | Demo film (HyperFrames), built from the real frontend components and engine output |
| `docs/API.md` | Integration guide for KBC with example payloads |
| `docs/GAME_RULES.md` | Game rules, model details, open questions |

## Technical overview

### Layers

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Clients                                                                  │
│   KBC app / core banking (server to server)   Demo frontend (React)      │
└───────────────┬───────────────────────────────────────┬──────────────────┘
                │ HTTPS + X-API-Key, JSON               │ same API, or an in-browser mock
┌───────────────▼───────────────────────────────────────▼──────────────────┐
│ API layer        api.py (FastAPI)  +  schemas.py (Pydantic contract)     │
│   auth, CORS, security headers, input validation, date-window limits     │
├──────────────────────────────────────────────────────────────────────────┤
│ Domain layer     engine.py  ──uses──▶  model.py        config.py         │
│   day-by-day replay:            learns the spending     every tunable    │
│   limits, buffer/debt,          profile + daily goal    number           │
│   swan health, sweeps           from 90 days history                     │
├──────────────────────────────────────────────────────────────────────────┤
│ Persistence      store.py (SQLite): enrollments + raw transactions only  │
├──────────────────────────────────────────────────────────────────────────┤
│ Demo data        synthetic.py (personas), cases.py (deck customers),     │
│                  funds.py (placeholder KBC fund catalogue)               │
└──────────────────────────────────────────────────────────────────────────┘
```

The backend is pure Python (FastAPI, Pydantic, SQLite from the standard library). No numpy,
no ML framework: the model is plain statistics so every limit can be explained to a customer.

### Request lifecycle

Take `POST /v1/users/{id}/transactions`, the call KBC makes whenever transactions book:

1. **Middleware**: CORS check for browser callers, then the API key is compared in constant
   time. Security headers are added to every response on the way out.
2. **Validation**: Pydantic parses the body against `TransactionBatch` (bounded sizes,
   finite amounts, valid ids). Bad input returns 422 before any code runs.
3. **Store**: transactions are inserted with `INSERT OR IGNORE` on
   `(user_id, transaction_id)`, so late or duplicate deliveries are harmless.
4. **Replay**: `engine.replay` loads all of the user's transactions and plays the game from
   the enrollment date to `as_of`, one day at a time (details below).
5. **Response**: a `GameState` JSON with the swan, today's limit, the current cycle, rewards,
   history and events. KBC renders it as is.

### Model: from history to a daily goal (`model.py`)

Learned once, from the 90 days before enrollment, then frozen (re-learning from game data
would ratchet savers' limits tighter every cycle):

1. **Classify** every transaction: income, fixed cost (by category), recurring (same merchant,
   about monthly, stable amount), large one-off, or discretionary.
2. **Detect the wage**: the biggest income that lands about monthly. It defines the game's
   cycles (payday to payday; calendar months when there is none).
3. **Baseline**: mean daily discretionary spend, one-offs removed, winsorized at p98.
4. **Weekday factors**: per-weekday spend relative to the mean, shrunk toward 1 and clipped.
5. **Target**: baseline × (1 − savings rate by difficulty), capped at 90% of disposable
   income and floored at EUR 5. Daily base limit = target × weekday factor.

`GET /v1/users/{id}/profile` returns exactly these numbers, which is what the app's
"Why €X today?" screen shows.

### Engine: deterministic replay (`engine.py`)

Game state is never stored. Every request replays from scratch, which makes the service
stateless apart from raw inputs, idempotent, and trivially correct when data arrives late.
For each day the engine:

- computes the day's limit (base limit minus any debt reduction),
- settles yesterday: under the limit adds to the **buffer**, over takes from it,
- handles large one-offs: paid from the buffer, the uncovered part becomes **debt** that
  lowers the remaining days' limits,
- scores the rolling 7-day pace and moves the swan's **health** (EWMA), with extra penalties
  for unaffordable buys; below 10 health the swan dies until the next cycle,
- on payday closes the cycle: the buffer is **swept** into the chosen fund (never more than
  what is really left of the income), debt is forgiven, a dead swan re-hatches.

A replay of a few months takes milliseconds, and the window is capped at 3 years per request.
The full rules and every constant are in [docs/GAME_RULES.md](docs/GAME_RULES.md); the
numbers live in `config.py`.

### Persistence (`store.py`)

Two SQLite tables: `enrollments` (difficulty, fund, enrollment date) and `transactions` (the
raw JSON payload, keyed on user + transaction id). No derived data is stored, so opting out
(`DELETE /enrollment`) deletes everything we know about a customer in one transaction. All
queries are parameterized; a lock serializes access to the single connection.

### Frontend (`frontend/`)

Vite + React 19 + TypeScript, no UI or state library.

- `api/client.ts` defines one `SwanSource` interface with two implementations: `liveSource`
  (the real API) and `mockSource` (`mock/simulate.ts`, an in-browser port of the model and
  engine), so the demo also runs with no backend. `api/types.ts` mirrors `schemas.py`.
- `App.tsx` owns the state (persona, date, `GameState`) and caches a state per day, so
  scrubbing the timeline is instant.
- `screens/` (pond, opt-in, gallery) and `components/` (swan, weather, lake, phone frame)
  render only what is in `GameState`. KBC could rebuild the screen natively from the same JSON.
- `components/DemoPanel.tsx` has the presenter controls (data source, persona, timeline,
  test spending).

### Demo film (`video/`)

A HyperFrames project: each scene is an HTML composition animated with GSAP. `npm run build`
runs the real engine offline (`build/export_data.py`), renders the real React components to
static HTML (`build/snippets.tsx`) and copies the app's CSS, so every screen and number in the
film comes from the actual product. See [video/README.md](video/README.md).

### Tests

`backend/tests/` (pytest) covers the model, the engine, payday cycles, the full API flow
and the security hardening.

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

## Run the frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

The demo shows the swan screen inside a phone frame, the way it would appear in KBC Mobile.
It starts on an **in-browser mock** of the model and engine, so it works with no backend.
Click **Live API** in the demo controls (or open `/?live`) to use the real backend on port 8000.
`/?api=http://<ip>:8000` points it at another machine, `/?gallery` shows all six swan states.

What the screen shows, all taken from the API's `GameState`:

- **Big number in the sky**: what is left to spend today, or how much over the limit.
- **Swan and weather**: the swan's health tier, from thriving in the sun to dead in a night storm.
- **Lake**: grows with the money invested in the fund so far, plus the estimated yearly return.
- **Saved since payday / left by payday**: the cycle's buffer, any debt, and the projected balance.
- **Cycle bars**: spent vs limit for every day of the current cycle, one-offs marked.
- **Why €X today?**: the model's explanation (habits, savings rate, weekday factor, noise ignored).
- **Recent**: the latest game events.

Demo controls (hide with **H**, **Space** plays the timeline, **←/→** steps a day): pick a
customer (the four deck cases first), scrub the timeline, add a purchase for today, preview any
swan look, or run the opt-in flow (difficulty, fund, consent, egg hatching).

Optional config in `frontend/.env.local`: `VITE_API_URL`, `VITE_API_KEY` (demo key only, it
ships in the browser bundle). Full details in [frontend/README.md](frontend/README.md).

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q
```
