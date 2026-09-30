"""HTTP API that KBC (and our demo frontend) talks to.

Run:  uvicorn blackswan.api:app --reload   (from backend/)
Docs: http://localhost:8000/docs

Environment:
  SWAN_ENV            "dev" (default) or "production". Production requires SWAN_API_KEYS and
                      turns off /docs and the demo endpoints (unless SWAN_ENABLE_DEMO=1).
  SWAN_API_KEYS       Comma-separated API keys. Dev falls back to "dev-key".
  SWAN_CORS_ORIGINS   Comma-separated allowed browser origins. Defaults to the local Vite ports.
  SWAN_DB_PATH        SQLite file, default data/swan.db.
"""

import logging
import os
import secrets
from datetime import date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Path, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import cases, engine, synthetic
from .funds import FUNDS
from .schemas import (
    USER_ID_PATTERN,
    DemoSeedRequest,
    Enrollment,
    EnrollmentRequest,
    EvaluateRequest,
    Fund,
    GameState,
    IngestResult,
    SpendingProfile,
    Timeline,
    TransactionBatch,
)
from .store import Store

log = logging.getLogger("blackswan")

BRUSSELS = ZoneInfo("Europe/Brussels")
UserId = Annotated[str, Path(pattern=USER_ID_PATTERN)]
AsOf = Annotated[date | None, Query(description="Simulate the game as of this date. Defaults to today (Brussels).")]

DEV_API_KEY = "dev-key"  # local demo only; never accepted when SWAN_ENV=production
DEV_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
# Replaying is one loop per day, so cap the window to keep a single request cheap.
EARLIEST_DATE = date(2000, 1, 1)
LATEST_DATE = date(2100, 12, 31)
MAX_REPLAY_DAYS = 3 * 366

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cross-Origin-Resource-Policy": "same-site",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
# Swagger UI loads its own scripts, so the strict CSP only covers the JSON API.
API_CSP = "default-src 'none'; frame-ancestors 'none'"
DOCS_PATHS = ("/docs", "/redoc")


def today() -> date:
    return datetime.now(BRUSSELS).date()


def _csv_env(name: str, default: str = "") -> list[str]:
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


def _load_api_keys(production: bool) -> set[str]:
    keys = set(_csv_env("SWAN_API_KEYS"))
    if production:
        if not keys or DEV_API_KEY in keys:
            raise RuntimeError("SWAN_ENV=production needs SWAN_API_KEYS set to real keys (not the dev key)")
        return keys
    if not keys:
        log.warning("SWAN_API_KEYS not set: accepting the local dev key. Do not expose this server.")
        keys = {DEV_API_KEY}
    return keys


def create_app(store: Store | None = None, api_keys: set[str] | None = None) -> FastAPI:
    production = os.environ.get("SWAN_ENV", "dev").lower() == "production"
    demo_enabled = not production or os.environ.get("SWAN_ENABLE_DEMO") == "1"
    store = store or Store(os.environ.get("SWAN_DB_PATH", "data/swan.db"))
    api_keys = api_keys or _load_api_keys(production)
    key_bytes = [k.encode() for k in api_keys]

    app = FastAPI(
        title="Black Swan API",
        version="0.1.0",
        description=(
            "Learns a KBC customer's spending behaviour, sets a personal daily limit and returns "
            "the state of their swan for KBC to render. Authenticate with the `X-API-Key` header."
        ),
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_csv_env("SWAN_CORS_ORIGINS", "" if production else DEV_CORS_ORIGINS),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-API-Key"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.update(SECURITY_HEADERS)
        if not request.url.path.startswith(DOCS_PATHS):
            response.headers["Content-Security-Policy"] = API_CSP
        if request.url.path.startswith("/v1/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Don't echo the raw input back: it can be large, sensitive, or not JSON-encodable (NaN).
        detail = [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": detail})

    def require_key(x_api_key: Annotated[str | None, Header()] = None) -> None:
        # Constant-time compare so the key can't be guessed byte by byte from response timing.
        given = (x_api_key or "").encode()
        if not any(secrets.compare_digest(given, k) for k in key_bytes):
            raise HTTPException(status_code=401, detail="Missing or invalid X-API-Key")

    def require_demo() -> None:
        if not demo_enabled:
            raise HTTPException(status_code=404, detail="Not Found")

    auth = [Depends(require_key)]
    demo_auth = [Depends(require_demo), Depends(require_key)]

    def enrollment_or_404(user_id: str) -> Enrollment:
        e = store.get_enrollment(user_id)
        if not e:
            raise HTTPException(status_code=404, detail="User is not enrolled")
        return e

    def check_fund(fund_id: str) -> None:
        if fund_id not in FUNDS:
            raise HTTPException(status_code=422, detail=f"Unknown fund_id '{fund_id}'")

    def check_window(enrolled_on: date, as_of: date) -> None:
        if not (EARLIEST_DATE <= enrolled_on and as_of <= LATEST_DATE):
            raise HTTPException(status_code=422, detail=f"Dates must be between {EARLIEST_DATE} and {LATEST_DATE}")
        if (as_of - enrolled_on).days > MAX_REPLAY_DAYS:
            raise HTTPException(status_code=422, detail=f"as_of must be within {MAX_REPLAY_DAYS} days of enrollment")

    def game_state(user_id: str, e: Enrollment, as_of: date | None) -> GameState:
        as_of = as_of or today()
        check_window(e.enrolled_on, as_of)
        try:
            return engine.simulate(user_id, e, store.get_transactions(user_id), as_of)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    # ------------------------------------------------------------ meta

    @app.get("/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok", "model_version": "stat-v1", "today": today().isoformat()}

    @app.get("/v1/funds", tags=["meta"], dependencies=auth)
    def list_funds() -> list[Fund]:
        return list(FUNDS.values())

    # ------------------------------------------------------------ enrollment

    @app.put("/v1/users/{user_id}/enrollment", tags=["enrollment"], dependencies=auth)
    def enroll(user_id: UserId, body: EnrollmentRequest) -> Enrollment:
        """Opt in (or change difficulty / fund). Only enrolled users' data is accepted."""
        check_fund(body.fund_id)
        existing = store.get_enrollment(user_id)
        enrolled_on = body.enrolled_on or (existing.enrolled_on if existing else today())
        if not EARLIEST_DATE <= enrolled_on <= LATEST_DATE:
            raise HTTPException(status_code=422, detail=f"enrolled_on must be between {EARLIEST_DATE} and {LATEST_DATE}")
        e = Enrollment(user_id=user_id, difficulty=body.difficulty, fund_id=body.fund_id, enrolled_on=enrolled_on)
        store.upsert_enrollment(e)
        return e

    @app.get("/v1/users/{user_id}/enrollment", tags=["enrollment"], dependencies=auth)
    def get_enrollment(user_id: UserId) -> Enrollment:
        return enrollment_or_404(user_id)

    @app.delete("/v1/users/{user_id}/enrollment", tags=["enrollment"], dependencies=auth, status_code=204)
    def opt_out(user_id: UserId) -> Response:
        """Opt out. Deletes the enrollment and all stored transactions."""
        if not store.delete_user(user_id):
            raise HTTPException(status_code=404, detail="User is not enrolled")
        return Response(status_code=204)

    # ------------------------------------------------------------ data in, game out

    @app.post("/v1/users/{user_id}/transactions", tags=["game"], dependencies=auth)
    def ingest(
        user_id: UserId,
        body: TransactionBatch,
        include_state: Annotated[bool, Query(description="Return the updated game state in the response.")] = True,
        as_of: AsOf = None,
    ) -> IngestResult:
        """Push booked transactions (history on enrollment, then new ones as they book). Idempotent on transaction_id."""
        e = enrollment_or_404(user_id)
        accepted, duplicates = store.add_transactions(user_id, body.transactions)
        state = game_state(user_id, e, as_of) if include_state else None
        return IngestResult(accepted=accepted, duplicates=duplicates, game_state=state)

    @app.get("/v1/users/{user_id}/game-state", tags=["game"], dependencies=auth)
    def get_game_state(user_id: UserId, as_of: AsOf = None) -> GameState:
        """Everything KBC needs to render the swan screen."""
        return game_state(user_id, enrollment_or_404(user_id), as_of)

    @app.get("/v1/users/{user_id}/timeline", tags=["game"], dependencies=auth)
    def get_timeline(user_id: UserId, as_of: AsOf = None) -> Timeline:
        """Every day since enrollment across all cycles, plus a summary per cycle. For charts."""
        e = enrollment_or_404(user_id)
        as_of = as_of or today()
        check_window(e.enrolled_on, as_of)
        try:
            return engine.replay(user_id, e, store.get_transactions(user_id), as_of)[1]
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.get("/v1/users/{user_id}/profile", tags=["game"], dependencies=auth)
    def get_profile(user_id: UserId) -> SpendingProfile:
        """What the model learned: baseline, weekday pattern, recurring payments, noise threshold."""
        e = enrollment_or_404(user_id)
        return engine.enrollment_profile(e, store.get_transactions(user_id)).to_schema()

    @app.post("/v1/evaluate", tags=["game"], dependencies=auth)
    def evaluate(body: EvaluateRequest) -> GameState:
        """Stateless: send enrollment + transactions, get a game state. Nothing is stored."""
        check_fund(body.enrollment.fund_id)
        as_of = body.as_of or today()
        e = Enrollment(
            user_id=body.user_id,
            difficulty=body.enrollment.difficulty,
            fund_id=body.enrollment.fund_id,
            enrolled_on=body.enrollment.enrolled_on or as_of,
        )
        check_window(e.enrolled_on, as_of)
        try:
            return engine.simulate(body.user_id, e, body.transactions, as_of)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    # ------------------------------------------------------------ demo helpers

    @app.get("/v1/demo/personas", tags=["demo"], dependencies=demo_auth)
    def personas() -> list[dict]:
        """Deck cases (fixed story dates, from 2026-07-24) first, then generic personas."""
        deck = [
            {"key": c.key, "kind": "case", "name": c.name, "tagline": c.tagline, "verdict": c.verdict,
             "description": c.story, "enrolled_on": c.enrolled_on}
            for c in cases.CASES.values()
        ]
        generic = [{"key": p.key, "kind": "persona", "description": p.description} for p in synthetic.PERSONAS.values()]
        return deck + generic

    @app.post("/v1/demo/seed", tags=["demo"], dependencies=demo_auth)
    def seed(body: DemoSeedRequest) -> dict:
        """Create an enrolled demo user with synthetic KBC-like history. Replaces any previous data for that user.

        Deck cases keep their own story dates (enrolled_days_ago is ignored); generic personas enroll
        `enrolled_days_ago` before `as_of`.
        """
        user_id = body.user_id or f"demo-{body.persona}"
        end = body.as_of or today()
        if not EARLIEST_DATE <= end <= LATEST_DATE:
            raise HTTPException(status_code=422, detail=f"as_of must be between {EARLIEST_DATE} and {LATEST_DATE}")
        if body.persona in cases.CASES:
            enrolled_on = cases.CASES[body.persona].enrolled_on
            if end < enrolled_on:
                raise HTTPException(status_code=422, detail=f"as_of must be on or after {enrolled_on}")
            check_window(enrolled_on, end)
            txs = cases.generate_case(body.persona, end=end, user_id=user_id)
        elif body.persona in synthetic.PERSONAS:
            enrolled_on = end - timedelta(days=body.enrolled_days_ago)
            check_window(enrolled_on, end)
            txs = synthetic.generate(body.persona, user_id, end=end, enrolled_on=enrolled_on, seed=body.seed)
        else:
            raise HTTPException(status_code=422, detail=f"Unknown persona '{body.persona}'")
        store.delete_user(user_id)
        e = Enrollment(user_id=user_id, difficulty="normal", fund_id="kbc-sustainable-balanced", enrolled_on=enrolled_on)
        store.upsert_enrollment(e)
        store.add_transactions(user_id, txs)
        return {
            "user_id": user_id,
            "persona": body.persona,
            "enrollment": e,
            "transactions": len(txs),
            "game_state": game_state(user_id, e, end),
        }

    return app


app = create_app()
