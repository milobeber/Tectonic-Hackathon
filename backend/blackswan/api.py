"""HTTP API that KBC (and our demo frontend) talks to.

Run:  uvicorn blackswan.api:app --reload   (from backend/)
Docs: http://localhost:8000/docs
"""

import os
from datetime import date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Path, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from . import cases, engine, synthetic
from .funds import FUNDS
from .schemas import (
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

BRUSSELS = ZoneInfo("Europe/Brussels")
UserId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
AsOf = Annotated[date | None, Query(description="Simulate the game as of this date. Defaults to today (Brussels).")]


def today() -> date:
    return datetime.now(BRUSSELS).date()


def create_app(store: Store | None = None, api_keys: set[str] | None = None) -> FastAPI:
    store = store or Store(os.environ.get("SWAN_DB_PATH", "data/swan.db"))
    api_keys = api_keys or {k.strip() for k in os.environ.get("SWAN_API_KEYS", "dev-key").split(",") if k.strip()}

    app = FastAPI(
        title="Black Swan API",
        version="0.1.0",
        description=(
            "Learns a KBC customer's spending behaviour, sets a personal daily limit and returns "
            "the state of their swan for KBC to render. Authenticate with the `X-API-Key` header."
        ),
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.environ.get("SWAN_CORS_ORIGINS", "*").split(","),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def require_key(x_api_key: Annotated[str | None, Header()] = None) -> None:
        if x_api_key not in api_keys:
            raise HTTPException(status_code=401, detail="Missing or invalid X-API-Key")

    auth = [Depends(require_key)]

    def enrollment_or_404(user_id: str) -> Enrollment:
        e = store.get_enrollment(user_id)
        if not e:
            raise HTTPException(status_code=404, detail="User is not enrolled")
        return e

    def check_fund(fund_id: str) -> None:
        if fund_id not in FUNDS:
            raise HTTPException(status_code=422, detail=f"Unknown fund_id '{fund_id}'")

    def game_state(user_id: str, e: Enrollment, as_of: date | None) -> GameState:
        as_of = as_of or today()
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
        try:
            return engine.replay(user_id, e, store.get_transactions(user_id), as_of or today())[1]
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
        try:
            return engine.simulate(body.user_id, e, body.transactions, as_of)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    # ------------------------------------------------------------ demo helpers

    @app.get("/v1/demo/personas", tags=["demo"], dependencies=auth)
    def personas() -> list[dict]:
        """Deck cases (fixed story dates, from 2026-07-24) first, then generic personas."""
        deck = [
            {"key": c.key, "kind": "case", "name": c.name, "tagline": c.tagline, "verdict": c.verdict,
             "description": c.story, "enrolled_on": c.enrolled_on}
            for c in cases.CASES.values()
        ]
        generic = [{"key": p.key, "kind": "persona", "description": p.description} for p in synthetic.PERSONAS.values()]
        return deck + generic

    @app.post("/v1/demo/seed", tags=["demo"], dependencies=auth)
    def seed(body: DemoSeedRequest) -> dict:
        """Create an enrolled demo user with synthetic KBC-like history. Replaces any previous data for that user.

        Deck cases keep their own story dates (enrolled_days_ago is ignored); generic personas enroll
        `enrolled_days_ago` before `as_of`.
        """
        user_id = body.user_id or f"demo-{body.persona}"
        end = body.as_of or today()
        if body.persona in cases.CASES:
            enrolled_on = cases.CASES[body.persona].enrolled_on
            if end < enrolled_on:
                raise HTTPException(status_code=422, detail=f"as_of must be on or after {enrolled_on}")
            txs = cases.generate_case(body.persona, end=end, user_id=user_id)
        elif body.persona in synthetic.PERSONAS:
            enrolled_on = end - timedelta(days=body.enrolled_days_ago)
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
