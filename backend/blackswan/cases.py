"""Four story-driven customers for the pitch deck: two good spenders, two bad ones.

Each case is ~90 days of normal life before opting in, then two-plus game cycles.
Randomness is seeded per day, so the data is identical whatever end date you pick.
"""

import math
import random
from dataclasses import dataclass
from datetime import date, timedelta

from .schemas import Transaction


@dataclass(frozen=True)
class Habit:
    category: str
    merchants: tuple[str, ...]
    per_week: float
    ticket: tuple[float, float]  # min, max EUR
    weekend_weight: float = 1.0  # relative frequency on Sat/Sun


@dataclass(frozen=True)
class Case:
    key: str
    name: str
    tagline: str
    verdict: str  # "good" | "bad"
    story: str
    enrolled_on: date
    habits: tuple[Habit, ...]
    fixed: tuple[tuple[int, float, str, str], ...]  # (day of month, amount, merchant, category)
    wage: tuple[float, int, str] | None = None  # (amount, day of month, payer); paid the Friday before if weekend
    freelance: tuple[tuple[str, float, float], ...] = ()  # (client, min, max): irregular invoices
    game_ticket_multiplier: float = 1.0  # how their ticket sizes change once they play
    scripted: tuple[tuple[date, float, str, str], ...] = ()  # one-off purchases (date, amount, merchant, category)
    history_one_offs: tuple[tuple[int, float, str, str], ...] = ()  # (days before enrolling, amount, merchant, category)
    highlights: tuple[tuple[date, str], ...] = ()  # app screens worth showing in the deck


def _business_day(d: date) -> date:
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _poisson(rng: random.Random, lam: float) -> int:
    threshold, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= threshold:
            return k
        k += 1


CASES: dict[str, Case] = {
    c.key: c
    for c in (
        Case(
            key="sofie_steady",
            name="Sofie, 29, nurse",
            tagline="The steady saver",
            verdict="good",
            story=(
                "Cooks at home, bikes to work, one night out a week. Once she opts in she trims her "
                "spending by about a fifth. Her swan thrives and every payday her buffer is invested."
            ),
            enrolled_on=date(2026, 7, 24),
            wage=(2480.0, 25, "Zorggroep Aurora"),
            fixed=(
                (1, 780.0, "Immo De Vos", "rent"),
                (4, 95.0, "Engie", "utilities"),
                (6, 45.0, "AG Insurance", "insurance"),
                (8, 20.0, "Proximus", "telecom"),
                (10, 25.0, "Basic-Fit", "sport"),
                (15, 11.99, "Spotify", "entertainment"),
            ),
            habits=(
                Habit("groceries", ("Colruyt", "Aldi", "Lidl"), 2.2, (22, 55)),
                Habit("bakery", ("Bakkerij Mertens",), 3, (3, 8)),
                Habit("coffee", ("Coffee Lab",), 2, (3, 5)),
                Habit("restaurants", ("Pizzeria Da Mario", "Cafe De Markt"), 1, (18, 40), weekend_weight=3),
                Habit("transport", ("De Lijn", "NMBS"), 2, (2.5, 12)),
                Habit("shopping", ("Kruidvat", "Hema", "Bol.com"), 0.6, (12, 55)),
            ),
            game_ticket_multiplier=0.8,
            history_one_offs=((40, 329.0, "Ikea", "home"),),
            highlights=(
                (date(2026, 8, 12), "A normal Wednesday: limit met, buffer growing"),
                (date(2026, 8, 24), "Last day before payday: buffer about to be invested"),
                (date(2026, 9, 30), "Today: two cycles in, EUR 300+ invested"),
            ),
        ),
        Case(
            key="lucas_freelancer",
            name="Lucas, 34, freelance designer",
            tagline="Good spender, irregular income",
            verdict="good",
            story=(
                "Paid per project, so there is no single monthly wage: the game falls back to calendar "
                "months. Disciplined day to day. A EUR 135 bike repair at the end of August is paid from his "
                "buffer, which the game treats as noise: no harm to his swan."
            ),
            enrolled_on=date(2026, 8, 1),
            freelance=(
                ("Studio Noord", 500, 2400),
                ("Atelier Vos", 250, 1400),
                ("Brouwerij Het Anker", 200, 1100),
                ("Kunstencentrum Nova", 300, 1700),
            ),
            fixed=(
                (1, 950.0, "Immo Brugmann", "rent"),
                (3, 240.0, "Sociaal Verzekeringsfonds", "taxes"),
                (5, 110.0, "Luminus", "utilities"),
                (9, 55.0, "Telenet", "telecom"),
                (12, 59.99, "Adobe", "software"),
                (18, 13.99, "Netflix", "entertainment"),
            ),
            habits=(
                Habit("groceries", ("Delhaize", "Lidl"), 2.5, (25, 60)),
                Habit("lunch", ("Exki", "Balls & Glory", "Panos"), 3, (9, 16)),
                Habit("coffee", ("Mok Coffee",), 4, (3, 4.5)),
                Habit("bars", ("Cafe Het Hemelrijk", "Bar Nova"), 1, (20, 45), weekend_weight=3),
                Habit("transport", ("NMBS", "Cambio"), 1.5, (5, 22)),
                Habit("shopping", ("Standaard Boekhandel", "Bol.com"), 0.4, (15, 70)),
            ),
            game_ticket_multiplier=0.68,
            scripted=((date(2026, 8, 27), 135.0, "Fietsen Janssens", "transport"),),
            history_one_offs=((55, 420.0, "Coolblue", "electronics"),),
            highlights=(
                (date(2026, 8, 27), "Bike repair EUR 135: paid from the buffer, swan unharmed"),
                (date(2026, 8, 31), "Month end (no wage, so calendar cycle): buffer invested"),
                (date(2026, 9, 30), "Today: healthy swan, second sweep coming"),
            ),
        ),
        Case(
            key="emma_gourmet",
            name="Emma, 31, marketing coordinator",
            tagline="Premium groceries, runs short every month",
            verdict="bad",
            story=(
                "No big splurges, just an expensive daily routine: deli and organic shopping several times "
                "a week, specialty coffee, takeaway. Her habits cost more than her income leaves after fixed "
                "costs, so the model caps her limit at what she can afford. She keeps her routine, overspends "
                "almost daily, runs short before payday and her swan dies every cycle."
            ),
            enrolled_on=date(2026, 7, 24),
            wage=(2150.0, 25, "Brightside Media NV"),
            fixed=(
                (1, 890.0, "Immo Zuid", "rent"),
                (3, 180.0, "KBC Autolening", "loan"),
                (4, 120.0, "Engie", "utilities"),
                (6, 55.0, "Ethias", "insurance"),
                (8, 60.0, "Orange", "telecom"),
                (10, 39.0, "Jims", "sport"),
                (14, 17.99, "Netflix", "entertainment"),
                (20, 11.99, "Spotify", "entertainment"),
            ),
            habits=(
                Habit("groceries", ("Delhaize", "Rob The Gourmets' Market", "Carrefour Market"), 3, (40, 85)),
                Habit("bakery", ("Patisserie Elisa",), 2, (6, 12)),
                Habit("coffee", ("Normo Coffee",), 4, (4, 6)),
                Habit("takeaway", ("Deliveroo", "Uber Eats"), 1, (22, 38), weekend_weight=2),
                Habit("shopping", ("Zara", "Rituals", "Ici Paris XL"), 0.5, (25, 70)),
                Habit("transport", ("De Lijn",), 2, (2.5, 3.5)),
            ),
            game_ticket_multiplier=0.9,
            highlights=(
                (date(2026, 7, 27), "Day 4: one deli run costs almost four days of limit"),
                (date(2026, 8, 2), "Day 10: the weekly pace is far over, swan rotting"),
                (date(2026, 9, 30), "Today: third swan, running short before payday again"),
            ),
        ),
        Case(
            key="jonas_impulse",
            name="Jonas, 26, sales rep",
            tagline="Reckless big buys right after payday",
            verdict="bad",
            story=(
                "Day to day he is average, but the week after payday he buys what he wants: a designer "
                "bag, headphones, sneakers, a console. Within days of payday he has spent half his wage. "
                "The game flags each buy as unaffordable, his buffer cannot cover them, his limits drop "
                "to the floor and his swan dies."
            ),
            enrolled_on=date(2026, 7, 24),
            wage=(2300.0, 25, "Velocity Sales BV"),
            fixed=(
                (1, 720.0, "Immo Centrum", "rent"),
                (4, 85.0, "Mega", "utilities"),
                (6, 40.0, "Baloise", "insurance"),
                (8, 25.0, "Base", "telecom"),
                (11, 30.0, "Basic-Fit", "sport"),
                (16, 11.99, "Spotify", "entertainment"),
                (22, 14.99, "Disney+", "entertainment"),
            ),
            habits=(
                Habit("groceries", ("Aldi", "Carrefour Express"), 2.5, (15, 40)),
                Habit("fast_food", ("Quick", "McDonald's", "Pitta Palace"), 4, (8, 15)),
                Habit("bars", ("Cafe Den Engel", "Club Vaag"), 2, (15, 40), weekend_weight=4),
                Habit("transport", ("Q8", "Uber"), 1.5, (10, 35)),
                Habit("shopping", ("JD Sports", "Bol.com"), 0.5, (20, 70)),
            ),
            game_ticket_multiplier=1.1,
            scripted=(
                (date(2026, 7, 25), 790.0, "Inno (designer bag)", "shopping"),
                (date(2026, 7, 27), 379.0, "MediaMarkt (headphones)", "electronics"),
                (date(2026, 7, 30), 189.0, "Zalando (sneakers)", "shopping"),
                (date(2026, 8, 26), 349.0, "Coolblue (smartwatch)", "electronics"),
                (date(2026, 8, 28), 549.0, "Fnac (game console)", "electronics"),
                (date(2026, 9, 26), 420.0, "Tomorrowland resale (tickets)", "entertainment"),
                (date(2026, 9, 27), 259.0, "Zalando (jacket)", "shopping"),
            ),
            highlights=(
                (date(2026, 7, 25), "Day after payday: EUR 790 bag flagged as unaffordable"),
                (date(2026, 7, 27), "Headphones on top: swan dies on day 4"),
                (date(2026, 9, 30), "Today: new cycle, same pattern, third swan dead"),
            ),
            history_one_offs=((30, 260.0, "Fnac", "electronics"), (62, 180.0, "Zalando", "shopping")),
        ),
    )
}


def generate_case(key: str, end: date, user_id: str | None = None, seed: int = 7) -> list[Transaction]:
    c = CASES[key]
    user_id = user_id or f"case-{key}"
    start = c.enrolled_on - timedelta(days=90)
    txs: list[Transaction] = []

    def add(day: date, amount: float, merchant: str, category: str) -> None:
        txs.append(
            Transaction(
                transaction_id=f"{user_id}-{day.isoformat()}-{len(txs):05d}",
                booking_date=day,
                amount=round(amount, 2),
                merchant=merchant,
                category=category,
            )
        )

    one_offs = {c.enrolled_on - timedelta(days=d): (a, m, cat) for d, a, m, cat in c.history_one_offs}
    scripted = {}
    for d, a, m, cat in c.scripted:
        scripted.setdefault(d, []).append((a, m, cat))

    day = start
    while day <= end:
        rng = random.Random(f"{seed}-{key}-{day.isoformat()}")
        if c.wage:
            amount, dom, payer = c.wage
            if day == _business_day(day.replace(day=dom)):
                add(day, amount * rng.uniform(0.99, 1.01), payer, "salary")
        for client, lo, hi in c.freelance:
            if rng.random() < 0.9 / 30:  # each client pays roughly 0.9 times a month, on random days
                add(day, rng.uniform(lo, hi), client, "income")
        for dom, amount, merchant, category in c.fixed:
            if day.day == dom:
                jitter = rng.uniform(0.97, 1.03) if category == "utilities" else 1.0
                add(day, -amount * jitter, merchant, category)

        in_game = day >= c.enrolled_on
        weekend = day.weekday() >= 5
        for h in c.habits:
            weight = h.weekend_weight if weekend else 1.0
            norm = 7 / (5 + 2 * h.weekend_weight)
            for _ in range(_poisson(rng, h.per_week / 7 * weight * norm)):
                ticket = rng.uniform(*h.ticket) * (c.game_ticket_multiplier if in_game else 1.0)
                add(day, -ticket, rng.choice(h.merchants), h.category)

        if day in one_offs:
            amount, merchant, category = one_offs[day]
            add(day, -amount, merchant, category)
        for amount, merchant, category in scripted.get(day, []):
            add(day, -amount, merchant, category)
        day += timedelta(days=1)
    return txs
