"""Tunable parameters for the spending model and the swan game.

Everything the team may want to tweak during the hackathon lives here, so the
model and engine code stay free of magic numbers.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ModelConfig:
    # How far back the model looks when learning spending behaviour.
    lookback_days: int = 90
    # Below this many days of history we fall back to a default limit.
    min_history_days: int = 14
    fallback_daily_target: float = 25.0

    # Categories that are never part of the daily limit (fixed / non-discretionary).
    fixed_categories: frozenset[str] = frozenset(
        {
            "rent",
            "mortgage",
            "utilities",
            "insurance",
            "loan",
            "taxes",
            "savings",
            "investment",
            "transfer",
            "internal_transfer",
            "healthcare",
            "childcare",
            "education",
        }
    )

    # Recurring detection (subscriptions, standing orders...).
    recurring_min_months: int = 2
    # A subscription shows up about once a month, not several times.
    recurring_max_per_month: float = 1.5
    recurring_max_amount_cv: float = 0.15
    recurring_gap_days: tuple[int, int] = (25, 35)

    # Wage = biggest income arriving about monthly. Game cycles run payday to payday.
    wage_max_amount_cv: float = 0.25
    wage_min_amount: float = 200.0
    # Two paydays are at least this far apart; a late wage still counts within the grace period.
    wage_min_gap_days: int = 20
    wage_grace_days: int = 5

    # Large one-off expense ("noise") detection.
    large_expense_floor: float = 100.0
    large_expense_p95_multiplier: float = 1.5
    large_expense_target_multiplier: float = 3.0

    # Weekday seasonality: shrink raw factors toward 1 and clip.
    weekday_shrinkage: float = 0.6
    weekday_factor_bounds: tuple[float, float] = (0.5, 1.8)
    weekday_min_history_days: int = 28

    # Daily history is winsorized at this quantile before averaging.
    daily_winsor_quantile: float = 0.98

    # Savings challenge per difficulty: target = baseline * (1 - savings_rate).
    difficulty_savings_rate: dict[str, float] = field(
        default_factory=lambda: {"easy": 0.05, "normal": 0.10, "hard": 0.20}
    )

    # Never ask more than this share of disposable income (income - fixed costs).
    affordability_share: float = 0.9
    min_daily_limit: float = 5.0


@dataclass(frozen=True)
class GameConfig:
    start_health: float = 70.0
    rebirth_health: float = 50.0
    # Health moves toward 100 * day_score with this smoothing factor (EWMA).
    health_alpha: float = 0.2
    # Each day is scored on the pace of the last N days: over = (spent - limits) / limits.
    pace_window_days: int = 7
    # The end-of-cycle projection trusts the goal as if it were this many observed days.
    pace_prior_days: int = 7
    # How fast the score drops once over pace: score = 1 - steepness * over.
    overspend_steepness: float = 2.0
    # One-off health hit when a large expense is NOT covered by the buffer.
    uncovered_large_expense_penalty: float = 15.0
    # ...and a bigger one if it puts the cycle's spending above the cycle's income.
    # Multiplied by the number of such buys in the cycle (30, 60, 90...).
    unaffordable_large_expense_penalty: float = 30.0
    # Below this the swan dies for the rest of the month.
    death_threshold: float = 10.0
    # Limit reductions never push the daily limit below this share of the base limit.
    min_limit_ratio: float = 0.6

    # Health tiers (lower bound inclusive), checked top-down.
    tiers: tuple[tuple[float, str], ...] = (
        (80.0, "thriving"),
        (60.0, "healthy"),
        (40.0, "tired"),
        (20.0, "sick"),
        (10.0, "rotting"),
    )


MODEL = ModelConfig()
GAME = GameConfig()
