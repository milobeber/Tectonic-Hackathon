"""Swan game engine.

The game state is never stored: it is replayed day by day from the enrollment
date to `as_of`. That keeps it deterministic, idempotent, and correct when KBC
delivers transactions late or twice.

Cycles run from payday to payday when the model found a wage (the biggest
income that arrives about monthly), otherwise per calendar month. A cycle
closes when the next wage actually lands (early or late by a few days is fine),
or at the expected payday once `wage_grace_days` pass without one.

Money is tracked as one signed balance per cycle:
    balance += base_limit - spent        (every settled day, floored at 0 when negative)
    balance -= large_expense             (immediately, can go below 0)
- balance >= 0 is the buffer, swept into the chosen fund when the cycle closes,
  capped by what is really left of the cycle's income (we never invest money
  the customer does not have).
- balance <  0 is debt, only ever caused by large expenses the buffer could not
  cover. It is spread over the remaining days of the cycle as a lower daily
  limit (never below `min_limit_ratio` of the base limit). Saving pays the debt
  back and the limit recovers automatically.

The swan:
- every settled day is scored on the rolling pace of the last 7 days (spent vs
  limits), so one big shop balanced by quiet days is fine but a habit is not;
  health moves toward 100 * score (EWMA)
- a large expense the buffer covers is noise and costs no health; one it cannot
  cover is a hit, a bigger one if it means spending more than the cycle's income
  (escalating with every such buy in the same cycle)
- a dead swan stays dead for the cycle; a new one hatches next cycle
"""

import bisect
import calendar
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date, timedelta

from .config import GAME, MODEL, GameConfig, ModelConfig
from .funds import FUNDS
from .model import DAYS_PER_MONTH, Profile, WageInfo, build_profile
from .schemas import (
    CycleSummary,
    DayRecord,
    Enrollment,
    GameEvent,
    GameState,
    MonthState,
    Rewards,
    Sweep,
    SwanState,
    Timeline,
    TodayState,
    Transaction,
)

DAILY_EVENT_DAYS = 14  # day_under / day_over are kept for this many days; notable events for two cycles
ONE_DAY = timedelta(days=1)


def month_end(day: date) -> date:
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


def next_payday(after: date, day_of_month: int) -> date:
    """First date strictly after `after` that falls on the payday (clipped to short months)."""
    year, month = after.year, after.month
    while True:
        candidate = date(year, month, min(day_of_month, calendar.monthrange(year, month)[1]))
        if candidate > after:
            return candidate
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def _money(x: float) -> float:
    return round(x, 2) + 0.0  # + 0.0 turns -0.0 into 0.0


@dataclass
class _Swan:
    health: float
    alive: bool = True
    generation: int = 1
    streak: int = 0


@dataclass
class _Cycle:
    start: date
    end: date  # planned last day: the day before the expected payday, or the month end
    kind: str  # "wage" | "calendar"
    profile: Profile
    balance: float = 0.0
    days_under: int = 0
    days_over: int = 0
    large_total: float = 0.0
    fixed_spent: float = 0.0  # fixed + recurring outflows
    flex_spent: float = 0.0  # discretionary + large outflows, today included
    settled_regular: float = 0.0  # discretionary spend on settled days (for the pace projection)
    unaffordable_buys: int = 0
    records: list[DayRecord] = field(default_factory=list)
    today: TodayState | None = None

    @property
    def length(self) -> int:
        return (self.end - self.start).days + 1

    @property
    def income(self) -> float:
        return self.profile.monthly_income * self.length / DAYS_PER_MONTH

    @property
    def expected_fixed(self) -> float:
        return max(self.fixed_spent, self.profile.monthly_fixed_costs * self.length / DAYS_PER_MONTH)

    @property
    def buffer(self) -> float:
        return max(self.balance, 0.0)

    @property
    def debt(self) -> float:
        return max(-self.balance, 0.0)

    @property
    def label(self) -> str:
        return self.start.strftime("%Y-%m")

    def days_left(self, day: date) -> int:
        """Days from `day` to the planned end, `day` included (at least 1 while waiting for a late wage)."""
        return max((self.end - day).days + 1, 1)


class _Replay:
    def __init__(self, enrollment: Enrollment, txs: list[Transaction], as_of: date, mcfg: ModelConfig, gcfg: GameConfig):
        self.enrollment = enrollment
        self.as_of = as_of
        self.mcfg = mcfg
        self.gcfg = gcfg
        # Learned once, from pre-enrollment behaviour. Re-learning from game cycles would
        # ratchet: savers get a tighter limit every cycle, overspenders a looser one.
        self.profile = enrollment_profile(enrollment, txs, mcfg)
        self.swan = _Swan(health=gcfg.start_health)
        self.events: list[GameEvent] = []
        self.sweeps: list[Sweep] = []
        self.cycles: list[CycleSummary] = []
        self.all_records: list[DayRecord] = []
        self.pace_window: deque[tuple[float, float]] = deque(maxlen=gcfg.pace_window_days)  # (spent, limit)
        self.by_day: dict[date, list[Transaction]] = defaultdict(list)
        for tx in txs:
            if enrollment.enrolled_on <= tx.booking_date <= as_of:
                self.by_day[tx.booking_date].append(tx)
        wage = self.profile.wage
        self.wage_days = sorted({t.booking_date for t in txs if wage and t.booking_date <= as_of and wage.matches(t)})

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
            self._event(day, "swan_died", "Your swan did not make it this cycle. A new egg hatches next payday.")
        return self.swan.health - old

    def _move_balance(self, c: _Cycle, day: date, delta: float) -> None:
        """Change the balance and announce when the limit starts or stops being reduced."""
        was_in_debt = c.debt > 0
        c.balance += delta
        if c.debt > 0 and not was_in_debt:
            days_after = max((c.end - day).days, 1)
            self._event(
                day,
                "limit_reduced",
                f"Buffer empty: EUR {c.debt:.2f} to earn back, daily limit about EUR {c.debt / days_after:.2f} lower.",
                amount=c.debt,
            )
        elif was_in_debt and c.debt == 0:
            self._event(day, "limit_restored", "Debt earned back. Your full daily limit is back.")

    def _reduction(self, c: _Cycle, day: date, base: float) -> float:
        return min(c.debt / c.days_left(day), base * (1 - self.gcfg.min_limit_ratio))

    # ---------------------------------------------------------- cycle clock

    def _cycle_bounds(self, start: date, anchor: date | None) -> tuple[date, date | None, str]:
        """(planned end, next cycle start or None if still open at as_of, kind)."""
        wage: WageInfo | None = self.profile.wage
        if wage is None:
            end = month_end(start)
            return end, end + ONE_DAY, "calendar"

        earliest = start if anchor is None else max(start, anchor + timedelta(days=self.mcfg.wage_min_gap_days))
        expected = next_payday(max(start, earliest - ONE_DAY), wage.day_of_month)
        latest = expected + timedelta(days=self.mcfg.wage_grace_days)
        i = bisect.bisect_left(self.wage_days, max(earliest, start + ONE_DAY))
        if i < len(self.wage_days) and self.wage_days[i] <= latest:
            return expected - ONE_DAY, self.wage_days[i], "wage"
        if self.as_of > latest:  # wage never came: close at the expected payday
            return expected - ONE_DAY, expected, "wage"
        return expected - ONE_DAY, None, "wage"

    # ---------------------------------------------------------- simulation

    def run(self) -> _Cycle:
        start = self.enrollment.enrolled_on
        prior = [d for d in self.wage_days if d <= start]
        anchor = prior[-1] if prior else None
        while True:
            end, next_start, kind = self._cycle_bounds(start, anchor)
            c = _Cycle(start=start, end=end, kind=kind, profile=self.profile)
            last = self.as_of if next_start is None else min(self.as_of, next_start - ONE_DAY)
            day = start
            while day <= last:
                self._play_day(c, day)
                day += ONE_DAY
            if next_start is None or next_start > self.as_of:
                self._summarize(c, last, swept=None)
                return c
            self._close_cycle(c, last, next_start)
            anchor = start = next_start

    def _play_day(self, c: _Cycle, day: date) -> None:
        spent = 0.0
        large = 0.0
        for tx in self.by_day.get(day, []):
            kind = c.profile.classify(tx, self.mcfg)
            if kind in ("fixed", "recurring"):
                c.fixed_spent += -tx.amount
            elif kind == "discretionary":
                spent += -tx.amount
                c.flex_spent += -tx.amount
            elif kind == "large":
                large += -tx.amount
                c.flex_spent += -tx.amount
                self._large_expense(c, day, tx)
        c.large_total += large

        base = c.profile.base_limit(day)
        reduction = self._reduction(c, day, base)
        limit = max(base - reduction, self.mcfg.min_daily_limit)

        if day == self.as_of:
            status = "over" if spent > limit else "at_risk" if spent >= 0.8 * limit else "on_track"
            c.today = TodayState(
                date=day,
                base_limit=_money(base),
                limit_reduction=_money(max(base - limit, 0.0)),
                limit=_money(limit),
                spent=_money(spent),
                remaining=_money(max(limit - spent, 0.0)),
                large_expenses=_money(large),
                status=status,
            )
            self._record(c, day, limit, spent, large, "today")
            return

        c.settled_regular += spent
        delta = base - spent
        if delta < 0:
            # Everyday overspending drains the buffer but never creates debt: only large expenses do.
            delta = max(delta, -c.buffer)
        self._move_balance(c, day, delta)
        over = spent - limit
        if over <= 0:
            c.days_under += 1
            self.swan.streak += 1
        else:
            c.days_over += 1
            self.swan.streak = 0
        # The swan judges the recent pace, not one day: quiet days make up for a big shop.
        self.pace_window.append((spent, limit))
        window_spent = sum(s for s, _ in self.pace_window)
        window_limit = sum(lim for _, lim in self.pace_window)
        pace_over = (window_spent - window_limit) / window_limit
        score = 1.0 if pace_over <= 0 else max(0.0, 1 - self.gcfg.overspend_steepness * pace_over)

        delta = self._set_health(day, self.swan.health + self.gcfg.health_alpha * (100.0 * score - self.swan.health))
        if over <= 0:
            self._event(day, "day_under", f"Within your limit with EUR {-over:.2f} to spare.", -over, delta)
        else:
            self._event(day, "day_over", f"EUR {over:.2f} over your limit.", over, delta)
        self._record(c, day, limit, spent, large, "under" if over <= 0 else "over")

    def _large_expense(self, c: _Cycle, day: date, tx: Transaction) -> None:
        amount = -tx.amount
        what = tx.merchant or "Large expense"
        covered = min(amount, c.buffer)
        self._move_balance(c, day, -amount)
        if covered == amount:
            self._event(day, "large_expense_absorbed", f"{what}: EUR {amount:.2f} covered by your buffer.", amount)
            return

        # Can the cycle's income still carry this, assuming normal spending for the rest of it?
        projected = c.expected_fixed + c.flex_spent + c.profile.target_daily * max((c.end - day).days, 0)
        if c.income > 0 and projected > c.income:
            # Escalates within a cycle: one slip hurts, a buying spree kills.
            c.unaffordable_buys += 1
            penalty = self.gcfg.unaffordable_large_expense_penalty * c.unaffordable_buys
            delta = self._set_health(day, self.swan.health - penalty)
            self._event(
                day,
                "large_expense_unaffordable",
                f"{what}: EUR {amount:.2f}. With this, you are on track to spend {projected / c.income:.0%} "
                f"of your income before next payday.",
                amount,
                delta,
            )
            return
        delta = self._set_health(day, self.swan.health - self.gcfg.uncovered_large_expense_penalty)
        self._event(
            day,
            "large_expense_uncovered",
            f"{what}: EUR {amount:.2f}, buffer could only cover EUR {covered:.2f}.",
            amount,
            delta,
        )

    def _record(self, c: _Cycle, day: date, limit: float, spent: float, large: float, status: str) -> None:
        record = DayRecord(
            date=day,
            limit=_money(limit),
            spent=_money(spent),
            large_expenses=_money(large),
            buffer=_money(c.buffer),
            health=round(self.swan.health, 1),
            status=status,
        )
        c.records.append(record)
        self.all_records.append(record)

    def _summarize(self, c: _Cycle, last: date, swept: float | None) -> None:
        self.cycles.append(
            CycleSummary(
                start=c.start,
                end=last,
                planned_end=c.end,
                cycle_type=c.kind,
                closed=swept is not None,
                days_under=c.days_under,
                days_over=c.days_over,
                large_expenses_total=_money(c.large_total),
                swept=_money(swept or 0.0),
                swan_generation=self.swan.generation,
                swan_died=not self.swan.alive,
            )
        )

    def _close_cycle(self, c: _Cycle, last: date, next_start: date) -> None:
        """Sweep the buffer into the fund. Leftover debt is forgiven: every cycle is a fresh start."""
        # Never invest money that is not there: cap by what is left of this cycle's income (when known).
        swept = c.buffer
        if c.income > 0:
            swept = min(swept, max(c.income - c.fixed_spent - c.flex_spent, 0.0))
        if swept > 0:
            self.sweeps.append(Sweep(month=c.label, amount=_money(swept), fund_id=self.enrollment.fund_id, cycle_start=c.start, cycle_end=last))
            what = "Payday!" if c.kind == "wage" else "New month!"
            self._event(last, "month_swept", f"{what} EUR {swept:.2f} saved this cycle is invested in your fund.", swept)
        self._summarize(c, last, swept)
        if not self.swan.alive:
            self.swan = _Swan(health=self.gcfg.rebirth_health, generation=self.swan.generation + 1)
            self.pace_window.clear()
            self._event(next_start, "swan_reborn", "A new cygnet hatched. Fresh start!")


def _tier(health: float, alive: bool, cfg: GameConfig) -> str:
    if not alive:
        return "dead"
    for lower, name in cfg.tiers:
        if health >= lower:
            return name
    return "rotting"


_MOOD = {"thriving": "happy", "healthy": "content", "tired": "worried", "sick": "sad", "rotting": "critical", "dead": "dead"}


def replay(
    user_id: str,
    enrollment: Enrollment,
    transactions: list[Transaction],
    as_of: date,
    mcfg: ModelConfig = MODEL,
    gcfg: GameConfig = GAME,
) -> tuple[GameState, Timeline]:
    if as_of < enrollment.enrolled_on:
        raise ValueError("as_of is before the enrollment date")
    txs = sorted(transactions, key=lambda t: (t.booking_date, t.transaction_id))
    r = _Replay(enrollment, txs, as_of, mcfg, gcfg)
    c = r.run()
    swan = r.swan
    assert c.today is not None

    tier = _tier(swan.health, swan.alive, gcfg)
    mood = _MOOD[tier]
    if c.today.status == "over" and mood in ("happy", "content"):
        mood = "worried"

    # Observed pace, blended with the daily goal until about a week of days has settled.
    settled = c.days_under + c.days_over
    prior = gcfg.pace_prior_days
    pace = (c.settled_regular + c.profile.target_daily * prior) / (settled + prior)
    projected_outflow = c.expected_fixed + c.flex_spent + pace * max((c.end - as_of).days, 0)

    fund = FUNDS[enrollment.fund_id]
    total_invested = sum(s.amount for s in r.sweeps)
    previous_start = r.cycles[-2].start if len(r.cycles) > 1 else c.start
    state = GameState(
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
        today=c.today,
        month=MonthState(
            month=c.label,
            cycle_type=c.kind,
            start=c.start,
            end=c.end,
            days_left=max((c.end - as_of).days, 0),
            buffer=_money(c.buffer),
            debt=_money(c.debt),
            limit_reduction_per_day=c.today.limit_reduction,
            days_under=c.days_under,
            days_over=c.days_over,
            large_expenses_total=_money(c.large_total),
            income=_money(c.income),
            spent_total=_money(c.fixed_spent + c.flex_spent),
            projected_end_balance=_money(c.income - projected_outflow),
        ),
        rewards=Rewards(
            fund=fund,
            total_invested=_money(total_invested),
            sweeps=r.sweeps,
            estimated_annual_passive_income=_money(total_invested * fund.expected_annual_return),
        ),
        history=c.records,
        events=_recent_events(r.events, previous_start, as_of),
        model=c.profile.to_schema(),
    )
    notable = [e for e in r.events if e.type not in ("day_under", "day_over")]
    return state, Timeline(user_id=user_id, as_of=as_of, cycles=r.cycles, days=r.all_records, events=notable)


def _recent_events(events: list[GameEvent], since: date, as_of: date) -> list[GameEvent]:
    daily_since = as_of - timedelta(days=DAILY_EVENT_DAYS)
    keep = [
        e
        for e in events
        if e.date >= since and (e.type not in ("day_under", "day_over") or e.date >= daily_since)
    ]
    return list(reversed(keep))


def simulate(
    user_id: str,
    enrollment: Enrollment,
    transactions: list[Transaction],
    as_of: date,
    mcfg: ModelConfig = MODEL,
    gcfg: GameConfig = GAME,
) -> GameState:
    return replay(user_id, enrollment, transactions, as_of, mcfg, gcfg)[0]


def enrollment_profile(enrollment: Enrollment, transactions: list[Transaction], mcfg: ModelConfig = MODEL) -> Profile:
    """The profile the game runs on: learned from history before the enrollment date."""
    savings_rate = mcfg.difficulty_savings_rate[enrollment.difficulty]
    return build_profile(transactions, before=enrollment.enrolled_on, savings_rate=savings_rate, cfg=mcfg)
