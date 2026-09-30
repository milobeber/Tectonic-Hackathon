"""Spending model: learns a user's discretionary spending and derives a daily limit.

Deliberately statistical (no black box): a bank has to be able to explain to a
customer why their limit is what it is. Pipeline:

1. Split history into income, fixed costs (by category), recurring payments
   (detected: same merchant, stable amount, ~monthly) and discretionary spend.
2. Flag large one-off expenses as noise (robust threshold on transaction size).
3. Baseline = mean daily discretionary spend (winsorized, noise removed).
4. Weekday factors = how much more/less the user spends on each weekday (shrunk).
5. Target = baseline * (1 - savings_rate), capped by what income allows.
"""

import re
import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from .config import MODEL, ModelConfig
from .schemas import SpendingProfile, Transaction, TxKind

MODEL_VERSION = "stat-v1"
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAYS_PER_MONTH = 30.44


def normalize_merchant(merchant: str | None) -> str:
    if not merchant:
        return ""
    cleaned = re.sub(r"[^a-z ]", " ", merchant.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def quantile(values: list[float], q: float) -> float:
    """Linear-interpolated quantile, no numpy needed."""
    if not values:
        return 0.0
    ordered = sorted(values)
    pos = (len(ordered) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


@dataclass(frozen=True)
class Profile:
    history_days: int
    baseline_daily: float
    savings_rate: float
    target_daily: float
    weekday_factors: tuple[float, ...]
    large_expense_threshold: float
    recurring_merchants: frozenset[str]
    monthly_income: float
    monthly_fixed_costs: float
    confidence: str

    def base_limit(self, day: date) -> float:
        return self.target_daily * self.weekday_factors[day.weekday()]

    def classify(self, tx: Transaction, cfg: ModelConfig = MODEL) -> TxKind:
        if tx.amount > 0:
            return "income"
        if (tx.category or "").lower() in cfg.fixed_categories:
            return "fixed"
        if normalize_merchant(tx.merchant) in self.recurring_merchants:
            return "recurring"
        if -tx.amount > self.large_expense_threshold:
            return "large"
        return "discretionary"

    def to_schema(self) -> SpendingProfile:
        return SpendingProfile(
            version=MODEL_VERSION,
            confidence=self.confidence,
            history_days=self.history_days,
            baseline_daily=round(self.baseline_daily, 2),
            savings_rate=self.savings_rate,
            target_daily=round(self.target_daily, 2),
            weekday_factors={d: round(f, 3) for d, f in zip(WEEKDAYS, self.weekday_factors)},
            large_expense_threshold=round(self.large_expense_threshold, 2),
            recurring_merchants=sorted(self.recurring_merchants),
            monthly_income=round(self.monthly_income, 2),
            monthly_fixed_costs=round(self.monthly_fixed_costs, 2),
        )


def detect_recurring(debits: list[Transaction], cfg: ModelConfig = MODEL) -> set[str]:
    """Merchants charged roughly monthly with a stable amount (subscriptions, phone, gym...)."""
    by_merchant: dict[str, list[Transaction]] = defaultdict(list)
    for tx in debits:
        key = normalize_merchant(tx.merchant)
        if key:
            by_merchant[key].append(tx)

    recurring = set()
    lo_gap, hi_gap = cfg.recurring_gap_days
    for merchant, txs in by_merchant.items():
        months = {(t.booking_date.year, t.booking_date.month) for t in txs}
        if len(months) < cfg.recurring_min_months or len(txs) > cfg.recurring_max_per_month * len(months):
            continue
        amounts = [-t.amount for t in txs]
        mean = statistics.fmean(amounts)
        if mean <= 0 or statistics.pstdev(amounts) / mean > cfg.recurring_max_amount_cv:
            continue
        dates = sorted(t.booking_date for t in txs)
        gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
        if lo_gap <= statistics.median(gaps) <= hi_gap:
            recurring.add(merchant)
    return recurring


def _weekday_factors(daily: dict[date, float], cfg: ModelConfig) -> tuple[float, ...]:
    overall = statistics.fmean(daily.values())
    if overall <= 0:
        return (1.0,) * 7
    per_day: dict[int, list[float]] = defaultdict(list)
    for day, amount in daily.items():
        per_day[day.weekday()].append(amount)
    lo, hi = cfg.weekday_factor_bounds
    raw = []
    for wd in range(7):
        ratio = statistics.fmean(per_day[wd]) / overall if per_day[wd] else 1.0
        shrunk = 1 + cfg.weekday_shrinkage * (ratio - 1)
        raw.append(min(max(shrunk, lo), hi))
    norm = statistics.fmean(raw)
    return tuple(f / norm for f in raw)


def build_profile(
    transactions: list[Transaction],
    before: date,
    savings_rate: float,
    cfg: ModelConfig = MODEL,
) -> Profile:
    """Learn a profile from transactions strictly before `before`."""
    window_start = before - timedelta(days=cfg.lookback_days)
    history = [t for t in transactions if window_start <= t.booking_date < before]
    history_days = (before - min(t.booking_date for t in history)).days if history else 0

    credits = [t for t in history if t.amount > 0]
    debits = [t for t in history if t.amount < 0]
    recurring = detect_recurring(debits, cfg)
    fixed = [
        t
        for t in debits
        if (t.category or "").lower() in cfg.fixed_categories or normalize_merchant(t.merchant) in recurring
    ]
    fixed_ids = {t.transaction_id for t in fixed}
    discretionary = [t for t in debits if t.transaction_id not in fixed_ids]

    months = max(history_days, 30) / DAYS_PER_MONTH
    monthly_income = sum(t.amount for t in credits) / months
    monthly_fixed = sum(-t.amount for t in fixed) / months

    tx_sizes = [-t.amount for t in discretionary]
    history_large = max(cfg.large_expense_floor, cfg.large_expense_p95_multiplier * quantile(tx_sizes, 0.95))

    if history_days < cfg.min_history_days:
        baseline = cfg.fallback_daily_target
        weekday = (1.0,) * 7
    else:
        first_day = before - timedelta(days=history_days)
        daily = {first_day + timedelta(days=i): 0.0 for i in range(history_days)}
        for t in discretionary:
            if -t.amount <= history_large:
                daily[t.booking_date] += -t.amount
        cap = quantile(list(daily.values()), cfg.daily_winsor_quantile)
        winsorized = {d: min(v, cap) for d, v in daily.items()}
        baseline = statistics.fmean(winsorized.values())
        weekday = _weekday_factors(winsorized, cfg) if history_days >= cfg.weekday_min_history_days else (1.0,) * 7

    target = baseline * (1 - savings_rate)
    if monthly_income > 0:
        disposable_daily = (monthly_income - monthly_fixed) / DAYS_PER_MONTH
        target = min(target, max(disposable_daily * cfg.affordability_share, cfg.min_daily_limit))
    target = max(target, cfg.min_daily_limit)

    confidence = "high" if history_days >= 60 else "medium" if history_days >= 28 else "low"
    return Profile(
        history_days=history_days,
        baseline_daily=baseline,
        savings_rate=savings_rate,
        target_daily=target,
        weekday_factors=weekday,
        large_expense_threshold=max(history_large, cfg.large_expense_target_multiplier * target),
        recurring_merchants=frozenset(recurring),
        monthly_income=monthly_income,
        monthly_fixed_costs=monthly_fixed,
        confidence=confidence,
    )
