"""Synthetic KBC-like customers for demos and tests (no real bank data needed).

Each persona has ~3 months of "normal" history before enrolling, then behaves
according to `game_multiplier` once the game starts, so the swan visibly reacts.
"""

import random
from dataclasses import dataclass
from datetime import date, timedelta

from .schemas import Transaction


@dataclass(frozen=True)
class Persona:
    key: str
    description: str
    daily_mean: float
    game_multiplier: float
    weekend_boost: float = 1.3
    salary: float = 2600.0
    rent: float = 850.0
    zero_day_prob: float = 0.15
    big_purchase: tuple[int, float, str, str] | None = None  # (days after enrolling, amount, merchant, category)
    after_purchase_multiplier: float | None = None  # behaviour once the big purchase happened
    spike_prob: float = 0.0  # chance per game day of an impulse splurge on top


PERSONAS: dict[str, Persona] = {
    p.key: p
    for p in (
        Persona(
            "steady_saver",
            "Spends a bit less than usual once the game starts. Healthy, happy swan.",
            daily_mean=28,
            game_multiplier=0.7,
        ),
        Persona(
            "weekend_splurger",
            "Quiet weekdays, big weekends. The model learns weekend limits are higher.",
            daily_mean=30,
            game_multiplier=0.85,
            weekend_boost=2.2,
        ),
        Persona(
            "impulse_spender",
            "Regularly overspends after enrolling. Swan gets sick and eventually dies.",
            daily_mean=32,
            game_multiplier=1.5,
            spike_prob=0.15,
        ),
        Persona(
            "big_purchase",
            "Disciplined, then buys a EUR 899 laptop. Buffer covers part, limits drop, user tightens up and recovers.",
            daily_mean=28,
            game_multiplier=0.85,
            big_purchase=(12, 899.0, "MediaMarkt", "electronics"),
            after_purchase_multiplier=0.5,
        ),
    )
}

_SHOPS = {
    "groceries": (["Delhaize", "Colruyt", "Aldi", "Carrefour Express"], 0.45),
    "restaurants": (["Exki", "Panos", "Quick", "Cafe De Markt"], 0.25),
    "transport": (["NMBS", "De Lijn", "Q8"], 0.15),
    "shopping": (["Zara", "Bol.com", "Action", "Kruidvat"], 0.15),
}

_MONTHLY = [
    # (day of month, amount, merchant, category)
    (1, None, "Landlord BV", "rent"),
    (3, 29.0, "Basic-Fit", "sport"),
    (5, 95.0, "Engie", "utilities"),
    (8, 20.0, "Proximus", "telecom"),
    (12, 13.99, "Netflix", "entertainment"),
    (20, 11.99, "Spotify", "entertainment"),
]


def generate(persona_key: str, user_id: str, end: date, enrolled_on: date, history_days: int = 90, seed: int = 42) -> list[Transaction]:
    p = PERSONAS[persona_key]
    rng = random.Random(f"{seed}-{persona_key}-{user_id}")
    start = enrolled_on - timedelta(days=history_days)
    txs: list[Transaction] = []
    counter = 0

    def add(day: date, amount: float, merchant: str, category: str) -> None:
        nonlocal counter
        counter += 1
        txs.append(
            Transaction(
                transaction_id=f"{user_id}-{day.isoformat()}-{counter:04d}",
                booking_date=day,
                amount=round(amount, 2),
                merchant=merchant,
                category=category,
            )
        )

    shops = list(_SHOPS.items())
    weights = [w for _, (_, w) in shops]
    one_off_day = start + timedelta(days=history_days // 2)

    day = start
    while day <= end:
        if day.day == 25:
            add(day, p.salary, "Employer NV", "salary")
        for dom, amount, merchant, category in _MONTHLY:
            if day.day == dom:
                add(day, -(amount if amount is not None else p.rent), merchant, category)

        in_game = day >= enrolled_on
        if rng.random() > p.zero_day_prob:
            weekend = day.weekday() >= 5
            factor = p.weekend_boost if weekend else (7 - 2 * p.weekend_boost) / 5
            mult = p.game_multiplier if in_game else 1.0
            if p.big_purchase and p.after_purchase_multiplier and day > enrolled_on + timedelta(days=p.big_purchase[0]):
                mult = p.after_purchase_multiplier
            day_total = p.daily_mean * factor * mult / (1 - p.zero_day_prob) * rng.lognormvariate(0, 0.35)
            n = rng.choice([1, 1, 2, 2, 3])
            splits = [rng.random() + 0.2 for _ in range(n)]
            for share in splits:
                category, (names, _) = rng.choices(shops, weights)[0]
                add(day, -day_total * share / sum(splits), rng.choice(names), category)

        if in_game and p.spike_prob and rng.random() < p.spike_prob:
            add(day, -rng.uniform(45, 90), rng.choice(["Zalando", "Fnac", "Uber Eats"]), "shopping")
        if day == one_off_day:
            add(day, -349.0, "IKEA", "home")  # historical noise the model must ignore
        if p.big_purchase and day == enrolled_on + timedelta(days=p.big_purchase[0]):
            _, amount, merchant, category = p.big_purchase
            add(day, -amount, merchant, category)
        day += timedelta(days=1)
    return txs
