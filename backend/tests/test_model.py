from datetime import date, timedelta

import pytest

from blackswan.model import build_profile, detect_recurring
from conftest import ENROLLED


def test_baseline_and_target_from_flat_history(tx):
    p = build_profile(tx.history(daily=20), before=ENROLLED, savings_rate=0.10)
    assert p.baseline_daily == pytest.approx(20)
    assert p.target_daily == pytest.approx(18)
    assert p.confidence == "high"
    assert all(f == pytest.approx(1) for f in p.weekday_factors)
    assert p.large_expense_threshold == pytest.approx(100)  # floor wins


def test_large_one_off_in_history_is_ignored(tx):
    history = tx.history(daily=20) + [tx(ENROLLED - timedelta(days=30), -600, "IKEA", "home")]
    p = build_profile(history, before=ENROLLED, savings_rate=0.10)
    assert p.baseline_daily == pytest.approx(20)


def test_fixed_categories_do_not_count(tx):
    history = tx.history(daily=20) + [tx(ENROLLED - timedelta(days=d), -900, "Landlord", "rent") for d in (5, 35, 65)]
    p = build_profile(history, before=ENROLLED, savings_rate=0.10)
    assert p.baseline_daily == pytest.approx(20)
    assert p.monthly_fixed_costs > 0


def test_detects_subscriptions_but_not_supermarkets(tx):
    subs = [tx(date(2026, m, 12), -13.99, "NETFLIX.COM 123", "entertainment") for m in (6, 7, 8)]
    groceries = tx.history(daily=20)
    recurring = detect_recurring(subs + groceries)
    assert recurring == {"netflix com"}


def test_weekday_pattern_is_learned(tx):
    history = []
    for i in range(1, 91):
        day = ENROLLED - timedelta(days=i)
        history.append(tx(day, -45 if day.weekday() >= 5 else -15))
    p = build_profile(history, before=ENROLLED, savings_rate=0.0)
    assert p.weekday_factors[5] > 1.3 and p.weekday_factors[0] < 0.9
    assert sum(p.weekday_factors) / 7 == pytest.approx(1)


def test_short_history_falls_back(tx):
    p = build_profile(tx.history(days=5), before=ENROLLED, savings_rate=0.10)
    assert p.confidence == "low"
    assert p.baseline_daily == 25.0


def test_limit_capped_by_income(tx):
    history = tx.history(daily=40)
    history += [tx(date(2026, m, 25), 1500, "Employer", "salary") for m in (6, 7, 8)]
    history += [tx(date(2026, m, 1), -1200, "Landlord", "rent") for m in (6, 7, 8)]
    p = build_profile(history, before=ENROLLED, savings_rate=0.10)
    disposable_daily = (p.monthly_income - p.monthly_fixed_costs) / 30.44
    assert p.target_daily == pytest.approx(disposable_daily * 0.9)
    assert p.target_daily < 36
