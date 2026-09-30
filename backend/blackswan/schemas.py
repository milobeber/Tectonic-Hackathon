"""API contract between KBC and the Black Swan service.

KBC sends: enrollment (opt-in) + transactions.
We send back: a GameState that KBC renders in the swan screen.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Difficulty = Literal["easy", "normal", "hard"]
Tier = Literal["thriving", "healthy", "tired", "sick", "rotting", "dead"]
Mood = Literal["happy", "content", "worried", "sad", "critical", "dead"]
DayStatus = Literal["under", "over", "today"]
TodayStatus = Literal["on_track", "at_risk", "over"]
TxKind = Literal["income", "fixed", "recurring", "discretionary", "large"]
EventType = Literal[
    "day_under",
    "day_over",
    "large_expense_absorbed",
    "large_expense_uncovered",
    "large_expense_unaffordable",
    "limit_reduced",
    "limit_restored",
    "swan_died",
    "swan_reborn",
    "month_swept",
]

USER_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
# Demo seeding wipes the user first, so it may only touch the demo namespace.
DEMO_USER_ID_PATTERN = r"^demo-[A-Za-z0-9_-]{1,59}$"
MAX_TRANSACTIONS_PER_REQUEST = 10_000


# ---------------------------------------------------------------- input


class Transaction(BaseModel):
    """One booked transaction, roughly the shape of a PSD2 account transaction."""

    transaction_id: str = Field(..., min_length=1, max_length=128, examples=["tx_2026_09_14_0001"])
    booking_date: date
    amount: float = Field(
        ...,
        description="Signed amount in EUR. Negative = money out.",
        examples=[-23.5],
        ge=-1e9,
        le=1e9,
        allow_inf_nan=False,
    )
    currency: str = Field("EUR", max_length=8)
    merchant: str | None = Field(None, max_length=256, examples=["Delhaize"])
    category: str | None = Field(None, max_length=64, description="KBC category, lower_snake_case.", examples=["groceries"])
    description: str | None = Field(None, max_length=1024)


class EnrollmentRequest(BaseModel):
    difficulty: Difficulty = "normal"
    fund_id: str = Field("kbc-sustainable-balanced", max_length=64)
    enrolled_on: date | None = Field(None, description="Defaults to today.")


class Enrollment(BaseModel):
    user_id: str
    difficulty: Difficulty
    fund_id: str
    enrolled_on: date


class TransactionBatch(BaseModel):
    transactions: list[Transaction] = Field(..., max_length=MAX_TRANSACTIONS_PER_REQUEST)


class IngestResult(BaseModel):
    accepted: int
    duplicates: int
    game_state: "GameState | None" = None


class EvaluateRequest(BaseModel):
    """Stateless evaluation: send everything, get a game state back, nothing is stored."""

    user_id: str = Field("anonymous", pattern=USER_ID_PATTERN)
    enrollment: EnrollmentRequest
    transactions: list[Transaction] = Field(..., max_length=MAX_TRANSACTIONS_PER_REQUEST)
    as_of: date | None = None


class DemoSeedRequest(BaseModel):
    persona: str = Field("steady_saver", max_length=64)
    user_id: str | None = Field(None, pattern=DEMO_USER_ID_PATTERN, description="Must start with `demo-`.")
    as_of: date | None = Field(None, description="Last day of generated data. Defaults to today.")
    enrolled_days_ago: int = Field(20, ge=0, le=200)
    seed: int = Field(42, ge=0, le=2**31 - 1)


# ---------------------------------------------------------------- output


class Fund(BaseModel):
    id: str
    name: str
    risk_class: int = Field(..., ge=1, le=7)
    expected_annual_return: float = Field(..., description="Illustrative only, not a performance promise.")


class Wage(BaseModel):
    payer: str
    amount: float
    day_of_month: int


class SpendingProfile(BaseModel):
    """What the model learned about the user. Also used to explain the limit."""

    version: str
    confidence: Literal["low", "medium", "high"]
    history_days: int
    baseline_daily: float = Field(..., description="Average daily discretionary spend, noise removed.")
    savings_rate: float
    target_daily: float = Field(..., description="Average daily limit before weekday adjustment.")
    weekday_factors: dict[str, float]
    large_expense_threshold: float
    recurring_merchants: list[str]
    monthly_income: float
    monthly_fixed_costs: float
    wage: Wage | None = Field(None, description="Detected wage. Game cycles run payday to payday; calendar months if None.")
    affordable_daily: float | None = Field(None, description="Cap from income: 90% of (income - fixed costs) per day.")
    spend_by_category: dict[str, float] = Field(default_factory=dict, description="Average EUR/day per category in history.")
    ignored_one_offs_total: float = Field(0.0, description="Large one-offs in history left out of the baseline.")


class SwanState(BaseModel):
    health: float = Field(..., ge=0, le=100)
    tier: Tier
    mood: Mood
    alive: bool
    generation: int = Field(..., description="Increments each time a new swan hatches after a death.")
    streak_days: int = Field(..., description="Consecutive settled days within the limit.")


class TodayState(BaseModel):
    date: date
    base_limit: float
    limit_reduction: float
    limit: float
    spent: float
    remaining: float
    large_expenses: float
    status: TodayStatus


class MonthState(BaseModel):
    """The current game cycle: payday to payday if a wage was found, else the calendar month."""

    month: str = Field(..., description="YYYY-MM of the cycle start.")
    cycle_type: Literal["wage", "calendar"]
    start: date
    end: date = Field(..., description="Planned last day: the day before the expected payday, or the month end.")
    days_left: int
    buffer: float = Field(..., description="Money saved vs. the limit so far; swept to the fund at month end.")
    debt: float = Field(..., description="Overspend not covered by the buffer; earned back through lower limits.")
    limit_reduction_per_day: float
    days_under: int
    days_over: int
    large_expenses_total: float
    income: float = Field(..., description="Expected income for this cycle.")
    spent_total: float = Field(..., description="Everything spent this cycle, fixed costs included.")
    projected_end_balance: float = Field(
        ..., description="Income minus projected spending by cycle end at the current pace. Negative = running short."
    )


class DayRecord(BaseModel):
    date: date
    limit: float
    spent: float
    large_expenses: float
    buffer: float
    health: float
    status: DayStatus


class GameEvent(BaseModel):
    date: date
    type: EventType
    amount: float | None = None
    health_delta: float | None = None
    message: str


class Sweep(BaseModel):
    month: str
    amount: float
    fund_id: str
    cycle_start: date | None = None
    cycle_end: date | None = None


class CycleSummary(BaseModel):
    start: date
    end: date = Field(..., description="Last played day (as_of for the open cycle).")
    planned_end: date
    cycle_type: Literal["wage", "calendar"]
    closed: bool
    days_under: int
    days_over: int
    large_expenses_total: float
    swept: float
    swan_generation: int
    swan_died: bool


class Timeline(BaseModel):
    """Every day since enrollment, across cycles (for charts and scrubbing)."""

    user_id: str
    as_of: date
    cycles: list[CycleSummary]
    days: list[DayRecord]
    events: list[GameEvent] = Field(default_factory=list, description="Notable events since enrollment, oldest first.")


class Rewards(BaseModel):
    fund: Fund
    total_invested: float
    sweeps: list[Sweep]
    estimated_annual_passive_income: float
    disclaimer: str = "Illustrative estimate based on an assumed return. Not investment advice."


class GameState(BaseModel):
    user_id: str
    as_of: date
    swan: SwanState
    today: TodayState
    month: MonthState
    rewards: Rewards
    history: list[DayRecord] = Field(..., description="Settled days + today for the current month.")
    events: list[GameEvent] = Field(
        ..., description="Newest first. Notable events from the current + previous cycle, daily ones from the last 14 days."
    )
    model: SpendingProfile


IngestResult.model_rebuild()
