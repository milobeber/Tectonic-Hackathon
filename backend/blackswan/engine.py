"""Swan game engine.

The game state is never stored: it is replayed day by day from the enrollment
date to `as_of`. That keeps it deterministic, idempotent, and correct when KBC
delivers transactions late or twice.

Money is tracked as one signed monthly balance:
    balance += base_limit - spent        (every settled day, floored at 0 when negative)
    balance -= large_expense             (immediately, can go below 0)
- balance >= 0 is the buffer, swept into the chosen fund at month end.
- balance <  0 is debt, only ever caused by large expenses the buffer could not
  cover. It is spread over the remaining days of the month as a lower daily
  limit (never below `min_limit_ratio` of the base limit). Saving pays the debt
  back and the limit recovers automatically.

The swan:
- health moves toward 100 * day_score (EWMA), so one bad day hurts a bit but
  regular overspending slowly kills the swan; overspend the buffer can cover
  counts only half
- a large expense the buffer cannot cover is a one-off hit; one it can cover is
  treated as noise and costs no health
- a dead swan stays dead for the month; a new one hatches next month
"""

import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from .config import GAME, MODEL, GameConfig, ModelConfig
from .funds import FUNDS
from .model import Profile, build_profile
from .schemas import (
    DayRecord,
    Enrollment,
    GameEvent,
    GameState,
    MonthState,
    Rewards,
    Sweep,
    SwanState,
    TodayState,
    Transaction,
)

MAX_EVENTS = 50


def month_end(day: date) -> date:
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


def _money(x: float) -> float:
    return round(x, 2) + 0.0  # + 0.0 turns -0.0 into 0.0


@dataclass
class _Swan:
    health: float
    alive: bool = True
    generation: int = 1
    streak: int = 0


@dataclass
class _Month:
    start: date
    end: date
    profile: Profile
    balance: float = 0.0
    days_under: int = 0
    days_over: int = 0
    large_total: float = 0.0
    records: list[DayRecord] = field(default_factory=list)
    today: TodayState | None = None

    @property
    def buffer(self) -> float:
        return max(self.balance, 0.0)

    @property
    def debt(self) -> float:
        return max(-self.balance, 0.0)


class _Replay:
    def __init__(self, enrollment: Enrollment, txs: list[Transaction], as_of: date, mcfg: ModelConfig, gcfg: GameConfig):
        self.enrollment = enrollment
        self.txs = txs
        self.as_of = as_of
        self.mcfg = mcfg
        self.gcfg = gcfg
        self.swan = _Swan(health=gcfg.start_health)
        self.events: list[GameEvent] = []
        self.sweeps: list[Sweep] = []
        self.by_day: dict[date, list[Transaction]] = defaultdict(list)
        for tx in txs:
            if tx.booking_date >= enrollment.enrolled_on:
                self.by_day[tx.booking_date].append(tx)

    # ---------------------------------------------------------- helpers

    def _event(self, day: date, type_: str, message: str, amount: float | None = None, health_delta: float | None = None):
        self.events.append(
            GameEvent(
                date=day,
                type=type_,
                amount=None if amount is None else _money(amount),
                health_delta=None if health_delta is None else round(health_delta, 1),
                message=message,
            )
        )

    def _set_health(self, day: date, new_health: float) -> float:
        """Apply a health change; returns the delta. Handles death."""
        if not self.swan.alive:
            return 0.0
        old = self.swan.health
        self.swan.health = min(max(new_health, 0.0), 100.0)
        if self.swan.health < self.gcfg.death_threshold:
            self.swan.health = 0.0
            self.swan.alive = False
            self._event(day, "swan_died", "Your swan did not make it this month. A new egg hatches next month.")
        return self.swan.health - old

    def _move_balance(self, m: _Month, day: date, delta: float) -> None:
        """Change the balance and announce when the limit starts or stops being reduced."""
        was_in_debt = m.debt > 0
        m.balance += delta
        if m.debt > 0 and not was_in_debt:
            days_after = (m.end - day).days
            per_day = m.debt / days_after if days_after else 0.0
            self._event(
                day,
                "limit_reduced",
                f"Buffer empty: EUR {m.debt:.2f} to earn back, daily limit about EUR {per_day:.2f} lower.",
                amount=m.debt,
            )
        elif was_in_debt and m.debt == 0:
            self._event(day, "limit_restored", "Debt earned back. Your full daily limit is back.")

    def _reduction(self, m: _Month, day: date, base: float) -> float:
        days_left = (m.end - day).days + 1
        return min(m.debt / days_left, base * (1 - self.gcfg.min_limit_ratio))

    # ---------------------------------------------------------- simulation

    def run(self) -> _Month:
        start = self.enrollment.enrolled_on
        # Learned once, from pre-enrollment behaviour. Re-learning from game months would
        # ratchet: savers get a tighter limit every month, overspenders a looser one.
        profile = enrollment_profile(self.enrollment, self.txs, self.mcfg)
        while True:
            end = month_end(start)
            m = _Month(start=start, end=end, profile=profile)
            day = start
            while day <= min(end, self.as_of):
                self._play_day(m, day)
                day += timedelta(days=1)
            if self.as_of <= end:
                return m
            self._close_month(m)
            start = end + timedelta(days=1)

    def _play_day(self, m: _Month, day: date) -> None:
        spent = 0.0
        large = 0.0
        for tx in self.by_day.get(day, []):
            kind = m.profile.classify(tx, self.mcfg)
            if kind == "discretionary":
                spent += -tx.amount
            elif kind == "large":
                large += -tx.amount
                self._large_expense(m, day, tx)
        m.large_total += large

        base = m.profile.base_limit(day)
        reduction = self._reduction(m, day, base)
        limit = max(base - reduction, self.mcfg.min_daily_limit)

        if day == self.as_of:
            status = "over" if spent > limit else "at_risk" if spent >= 0.8 * limit else "on_track"
            m.today = TodayState(
                date=day,
                base_limit=_money(base),
                limit_reduction=_money(max(base - limit, 0.0)),
                limit=_money(limit),
                spent=_money(spent),
                remaining=_money(max(limit - spent, 0.0)),
                large_expenses=_money(large),
                status=status,
            )
            m.records.append(self._record(m, day, limit, spent, large, "today"))
            return

        buffer_before = m.buffer
        delta = base - spent
        if delta < 0:
            # Everyday overspending drains the buffer but never creates debt: only large expenses do.
            delta = max(delta, -m.buffer)
        self._move_balance(m, day, delta)
        over = spent - limit
        if over <= 0:
            m.days_under += 1
            self.swan.streak += 1
            score = 1.0
        else:
            m.days_over += 1
            self.swan.streak = 0
            # Overspend your own buffer can cover hurts less: saving earlier days earns slack.
            effective = over - self.gcfg.buffer_cushion * min(over, buffer_before)
            score = max(0.0, 1 - self.gcfg.overspend_steepness * effective / limit)

        delta = self._set_health(day, self.swan.health + self.gcfg.health_alpha * (100.0 * score - self.swan.health))
        if over <= 0:
            self._event(day, "day_under", f"Within your limit with EUR {-over:.2f} to spare.", -over, delta)
        else:
            self._event(day, "day_over", f"EUR {over:.2f} over your limit.", over, delta)
        m.records.append(self._record(m, day, limit, spent, large, "under" if over <= 0 else "over"))

    def _large_expense(self, m: _Month, day: date, tx: Transaction) -> None:
        amount = -tx.amount
        what = tx.merchant or "Large expense"
        covered = min(amount, m.buffer)
        self._move_balance(m, day, -amount)
        if covered == amount:
            self._event(day, "large_expense_absorbed", f"{what}: EUR {amount:.2f} covered by your buffer.", amount)
            return
        delta = self._set_health(day, self.swan.health - self.gcfg.uncovered_large_expense_penalty)
        self._event(
            day,
            "large_expense_uncovered",
            f"{what}: EUR {amount:.2f}, buffer could only cover EUR {covered:.2f}.",
            amount,
            delta,
        )

    def _record(self, m: _Month, day: date, limit: float, spent: float, large: float, status: str) -> DayRecord:
        return DayRecord(
            date=day,
            limit=_money(limit),
            spent=_money(spent),
            large_expenses=_money(large),
            buffer=_money(m.buffer),
            health=round(self.swan.health, 1),
            status=status,
        )

    def _close_month(self, m: _Month) -> None:
        """Sweep the buffer into the fund. Leftover debt is forgiven: every month is a fresh start."""
        label = m.end.strftime("%Y-%m")
        if m.buffer > 0:
            self.sweeps.append(Sweep(month=label, amount=_money(m.buffer), fund_id=self.enrollment.fund_id))
            self._event(m.end, "month_swept", f"EUR {m.buffer:.2f} invested in your fund.", m.buffer)
        if not self.swan.alive:
            self.swan = _Swan(health=self.gcfg.rebirth_health, generation=self.swan.generation + 1)
            self._event(m.end + timedelta(days=1), "swan_reborn", "A new cygnet hatched. Fresh start!")


def _tier(health: float, alive: bool, cfg: GameConfig) -> str:
    if not alive:
        return "dead"
    for lower, name in cfg.tiers:
        if health >= lower:
            return name
    return "rotting"


_MOOD = {"thriving": "happy", "healthy": "content", "tired": "worried", "sick": "sad", "rotting": "critical", "dead": "dead"}


def simulate(
    user_id: str,
    enrollment: Enrollment,
    transactions: list[Transaction],
    as_of: date,
    mcfg: ModelConfig = MODEL,
    gcfg: GameConfig = GAME,
) -> GameState:
    if as_of < enrollment.enrolled_on:
        raise ValueError("as_of is before the enrollment date")
    txs = sorted(transactions, key=lambda t: (t.booking_date, t.transaction_id))
    replay = _Replay(enrollment, txs, as_of, mcfg, gcfg)
    m = replay.run()
    swan = replay.swan
    assert m.today is not None

    tier = _tier(swan.health, swan.alive, gcfg)
    mood = _MOOD[tier]
    if m.today.status == "over" and mood in ("happy", "content"):
        mood = "worried"

    fund = FUNDS[enrollment.fund_id]
    total_invested = sum(s.amount for s in replay.sweeps)
    return GameState(
        user_id=user_id,
        as_of=as_of,
        swan=SwanState(
            health=round(swan.health, 1),
            tier=tier,
            mood=mood,
            alive=swan.alive,
            generation=swan.generation,
            streak_days=swan.streak,
        ),
        today=m.today,
        month=MonthState(
            month=m.end.strftime("%Y-%m"),
            start=m.start,
            end=m.end,
            days_left=(m.end - as_of).days,
            buffer=_money(m.buffer),
            debt=_money(m.debt),
            limit_reduction_per_day=m.today.limit_reduction,
            days_under=m.days_under,
            days_over=m.days_over,
            large_expenses_total=_money(m.large_total),
        ),
        rewards=Rewards(
            fund=fund,
            total_invested=_money(total_invested),
            sweeps=replay.sweeps,
            estimated_annual_passive_income=_money(total_invested * fund.expected_annual_return),
        ),
        history=m.records,
        events=_recent_events(replay.events, m.start),
        model=m.profile.to_schema(),
    )


def _recent_events(events: list[GameEvent], month_start: date) -> list[GameEvent]:
    cutoff = (month_start.replace(day=1) - timedelta(days=1)).replace(day=1)
    recent = [e for e in events if e.date >= cutoff]
    return list(reversed(recent))[:MAX_EVENTS]


def enrollment_profile(enrollment: Enrollment, transactions: list[Transaction], mcfg: ModelConfig = MODEL) -> Profile:
    """The profile the game runs on: learned from history before the enrollment date."""
    savings_rate = mcfg.difficulty_savings_rate[enrollment.difficulty]
    return build_profile(transactions, before=enrollment.enrolled_on, savings_rate=savings_rate, cfg=mcfg)
