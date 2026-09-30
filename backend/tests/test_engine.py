from datetime import date, timedelta

import pytest

from blackswan.engine import simulate
from conftest import ENROLLED

# Flat 20/day history -> target 18/day, large-expense threshold 100.


def day(n: int) -> date:
    return ENROLLED + timedelta(days=n - 1)


def run(tx, enrollment, game_txs, as_of):
    return simulate("u1", enrollment, tx.history() + game_txs, as_of)


def event_types(state):
    return [e.type for e in state.events]


def test_under_limit_day_fills_buffer_and_heals(tx, enrollment):
    s = run(tx, enrollment, [tx(day(1), -10)], as_of=day(2))
    assert s.month.buffer == pytest.approx(8)
    assert s.swan.health == pytest.approx(76)
    assert s.swan.streak_days == 1
    assert s.history[0].status == "under"
    assert s.today.limit == pytest.approx(18)


def test_over_limit_day_hurts_but_creates_no_debt(tx, enrollment):
    s = run(tx, enrollment, [tx(day(1), -27)], as_of=day(2))  # 50% over, no buffer
    assert s.swan.health == pytest.approx(56)
    assert s.month.buffer == 0 and s.month.debt == 0
    assert s.today.limit == pytest.approx(18)
    assert s.swan.streak_days == 0


def test_buffer_cushions_overspending(tx, enrollment):
    games = [tx(day(1), 0.0)] + [tx(day(2), -27)]  # day 1 saves 18, day 2 is 9 over, fully covered
    s = run(tx, enrollment, games, as_of=day(3))
    # effective overspend 4.5 -> score 0.5
    assert s.history[1].status == "over"
    assert s.month.buffer == pytest.approx(9)
    assert s.swan.health == pytest.approx(76 + 0.2 * (50 - 76))


def test_large_expense_absorbed_by_buffer_costs_no_health(tx, enrollment):
    games = [tx(day(n), -8) for n in range(1, 21)] + [tx(day(21), -150, "MediaMarkt", "electronics")]
    s = run(tx, enrollment, games, as_of=day(21))
    assert "large_expense_absorbed" in event_types(s)
    assert s.month.buffer == pytest.approx(20 * 10 - 150)
    assert s.month.debt == 0
    assert s.today.large_expenses == 150
    assert s.today.limit == pytest.approx(18)


def test_uncovered_large_expense_lowers_limit_and_hurts(tx, enrollment):
    s = run(tx, enrollment, [tx(day(1), -300, "MediaMarkt", "electronics")], as_of=day(1))
    assert s.month.debt == pytest.approx(300)
    assert s.swan.health == pytest.approx(70 - 15)
    assert s.today.limit == pytest.approx(18 * 0.6)  # reduction capped at 40%
    assert {"large_expense_uncovered", "limit_reduced"} <= set(event_types(s))


def test_debt_is_earned_back_and_limit_restored(tx, enrollment):
    games = [tx(day(1), -120, "MediaMarkt", "electronics")] + [tx(day(n), -5) for n in range(2, 12)]
    s = run(tx, enrollment, games, as_of=day(12))
    assert s.month.debt == 0
    assert "limit_restored" in event_types(s)
    assert s.today.limit == pytest.approx(18)


def test_regular_overspending_kills_swan_and_new_one_hatches(tx, enrollment):
    games = [tx(day(n), -60) for n in range(1, 31)]
    s = run(tx, enrollment, games, as_of=day(30))
    assert not s.swan.alive and s.swan.tier == "dead" and s.swan.health == 0
    assert "swan_died" in event_types(s)

    s = run(tx, enrollment, games, as_of=date(2026, 10, 1))
    assert s.swan.alive and s.swan.generation == 2 and s.swan.health == 50
    assert "swan_reborn" in event_types(s)


def test_month_end_sweeps_buffer_into_fund(tx, enrollment):
    games = [tx(day(n), -8) for n in range(1, 31)]
    s = run(tx, enrollment, games, as_of=date(2026, 10, 1))
    assert len(s.rewards.sweeps) == 1
    assert s.rewards.sweeps[0].month == "2026-09"
    assert s.rewards.total_invested == pytest.approx(300)
    assert s.rewards.estimated_annual_passive_income == pytest.approx(12)
    assert s.month.month == "2026-10" and s.month.buffer == 0


def test_profile_is_frozen_at_enrollment(tx, enrollment):
    games = [tx(day(n), -60) for n in range(1, 31)] + [tx(date(2026, 10, n), -60) for n in range(1, 31)]
    s = run(tx, enrollment, games, as_of=date(2026, 10, 30))
    assert s.model.target_daily == pytest.approx(18)


def test_mood_turns_worried_when_today_is_over(tx, enrollment):
    s = run(tx, enrollment, [tx(day(1), -40)], as_of=day(1))
    assert s.today.status == "over"
    assert s.swan.mood == "worried"


def test_transactions_before_enrollment_do_not_play(tx, enrollment):
    s = run(tx, enrollment, [], as_of=day(1))
    assert s.today.spent == 0
    assert s.history[-1].status == "today"


def test_as_of_before_enrollment_is_rejected(tx, enrollment):
    with pytest.raises(ValueError):
        run(tx, enrollment, [], as_of=ENROLLED - timedelta(days=1))
