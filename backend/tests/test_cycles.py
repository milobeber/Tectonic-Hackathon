from datetime import date, timedelta

import pytest

from blackswan.engine import next_payday, replay
from blackswan.model import build_profile, detect_wage
from blackswan.schemas import Enrollment
from conftest import ENROLLED


def wage_history(tx, paydays, amount=2500.0, payer="Employer NV"):
    return [tx(d, amount, payer, "salary") for d in paydays]


def enroll(on: date) -> Enrollment:
    return Enrollment(user_id="u1", difficulty="normal", fund_id="kbc-sustainable-balanced", enrolled_on=on)


def test_next_payday_clips_short_months():
    assert next_payday(date(2026, 1, 31), 31) == date(2026, 2, 28)
    assert next_payday(date(2026, 9, 25), 25) == date(2026, 10, 25)
    assert next_payday(date(2026, 9, 10), 25) == date(2026, 9, 25)


def test_wage_is_biggest_monthly_income(tx):
    credits = wage_history(tx, [date(2026, m, 25) for m in (6, 7, 8)])
    credits += [tx(date(2026, m, 3), 150, "Kinderbijslag", "benefits") for m in (6, 7, 8)]
    credits += [tx(date(2026, 7, 14), 900, "Tante Marie", "gift")]
    wage = detect_wage(credits)
    assert wage.payer == "employer nv" and wage.day_of_month == 25 and wage.amount == pytest.approx(2500)


def test_irregular_income_is_not_a_wage(tx):
    credits = [tx(date(2026, 6, 4), 1800, "Client A"), tx(date(2026, 6, 20), 400, "Client A"), tx(date(2026, 8, 2), 1100, "Client A")]
    assert detect_wage(credits) is None


def test_income_counts_the_wage_once_per_month(tx):
    # Enrolling on payday: the 90-day window holds only 2 wages but spans ~3 months.
    history = tx.history(end=date(2026, 7, 24)) + wage_history(tx, [date(2026, 5, 25), date(2026, 6, 25)])
    p = build_profile(history, before=date(2026, 7, 24), savings_rate=0.1)
    assert p.monthly_income == pytest.approx(2500)


def _wage_customer(tx, extra_paydays):
    paydays = [date(2026, 5, 25), date(2026, 6, 25), date(2026, 7, 24)] + extra_paydays
    txs = tx.history(end=date(2026, 7, 24)) + wage_history(tx, paydays)
    return txs


def test_cycles_run_payday_to_payday(tx):
    txs = _wage_customer(tx, [date(2026, 8, 25), date(2026, 9, 25)])
    txs += [tx(date(2026, 7, 24) + timedelta(days=i), -10) for i in range(0, 68)]
    state, timeline = replay("u1", enroll(date(2026, 7, 24)), txs, as_of=date(2026, 9, 30))
    spans = [(c.start, c.end, c.closed) for c in timeline.cycles]
    assert spans == [
        (date(2026, 7, 24), date(2026, 8, 24), True),
        (date(2026, 8, 25), date(2026, 9, 24), True),
        (date(2026, 9, 25), date(2026, 9, 30), False),
    ]
    assert state.month.cycle_type == "wage"
    assert state.month.end == date(2026, 10, 24)
    assert len(state.rewards.sweeps) == 2


def test_early_wage_closes_cycle_early(tx):
    txs = _wage_customer(tx, [date(2026, 8, 21)])  # paid 4 days early
    _, timeline = replay("u1", enroll(date(2026, 7, 24)), txs, as_of=date(2026, 8, 22))
    assert timeline.cycles[0].end == date(2026, 8, 20)
    assert timeline.cycles[1].start == date(2026, 8, 21)


def test_missing_wage_closes_cycle_after_grace(tx):
    txs = _wage_customer(tx, [])
    _, waiting = replay("u1", enroll(date(2026, 7, 24)), txs, as_of=date(2026, 8, 28))
    assert len(waiting.cycles) == 1  # still waiting for the wage
    _, timeline = replay("u1", enroll(date(2026, 7, 24)), txs, as_of=date(2026, 9, 2))
    assert timeline.cycles[1].start == date(2026, 8, 25)


def test_no_wage_means_calendar_months(tx, enrollment):
    state, timeline = replay("u1", enrollment, tx.history(), as_of=date(2026, 10, 3))
    assert state.month.cycle_type == "calendar"
    assert [c.start for c in timeline.cycles] == [date(2026, 9, 1), date(2026, 10, 1)]


def test_sweep_never_exceeds_what_is_left_of_income(tx):
    # Lumpy spender: quiet days build a buffer, but the cycle as a whole is deep in the red.
    txs = _wage_customer(tx, [date(2026, 8, 25)])
    txs += [tx(date(2026, 7, 24), -2700, "Landlord", "rent")]
    txs += [tx(date(2026, 8, 24), 0.0)]
    state, _ = replay("u1", enroll(date(2026, 7, 24)), txs, as_of=date(2026, 8, 26))
    assert state.rewards.total_invested == 0


def test_unaffordable_buys_escalate(tx):
    txs = _wage_customer(tx, []) + [tx(date(2026, 7, 24), -1500, "Landlord", "rent")]
    txs += [tx(date(2026, 7, 25), -600, "Inno", "shopping"), tx(date(2026, 7, 26), -300, "Fnac", "electronics")]
    state, _ = replay("u1", enroll(date(2026, 7, 24)), txs, as_of=date(2026, 7, 26))
    hits = [e.health_delta for e in reversed(state.events) if e.type == "large_expense_unaffordable"]
    assert len(hits) == 2
    assert hits[1] < hits[0] or not state.swan.alive
