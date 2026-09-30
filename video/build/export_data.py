"""Run the real Black Swan engine (no API, no DB) and dump the states the video needs.

    ../.venv/bin/python video/build/export_data.py   (from the repo root)
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from blackswan import cases, engine, synthetic  # noqa: E402
from blackswan.model import build_profile, normalize_merchant, WEEKDAYS  # noqa: E402
from blackswan.config import MODEL  # noqa: E402
from blackswan.schemas import Enrollment  # noqa: E402

OUT = ROOT / "video" / "data"
AS_OF = date(2026, 9, 30)


def dump(obj):
    return json.loads(obj.model_dump_json())


def case_states(key, days):
    c = cases.CASES[key]
    uid = f"case-{key}"
    txs = cases.generate_case(key, end=AS_OF, user_id=uid)
    e = Enrollment(user_id=uid, difficulty="normal", fund_id="kbc-sustainable-balanced", enrolled_on=c.enrolled_on)
    out = {}
    for d in days:
        state, _ = engine.replay(uid, e, [t for t in txs if t.booking_date <= d], d)
        out[d.isoformat()] = dump(state)
    return c, txs, e, out


def persona_states(key, enrolled_days_ago, days):
    uid = f"demo-{key}"
    enrolled_on = AS_OF - timedelta(days=enrolled_days_ago)
    txs = synthetic.generate(key, uid, end=AS_OF, enrolled_on=enrolled_on)
    e = Enrollment(user_id=uid, difficulty="normal", fund_id="kbc-sustainable-balanced", enrolled_on=enrolled_on)
    out = {}
    for d in days:
        state, _ = engine.replay(uid, e, [t for t in txs if t.booking_date <= d], d)
        out[d.isoformat()] = dump(state)
    return txs, e, out


def every_day(start, end):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    data = {"as_of": AS_OF.isoformat(), "cases": {}, "personas": {}}

    for key in cases.CASES:
        c, txs, e, states = case_states(key, [AS_OF, date(2026, 9, 24), date(2026, 9, 25), date(2026, 9, 26), date(2026, 9, 12)])
        data["cases"][key] = {
            "name": c.name,
            "tagline": c.tagline,
            "verdict": c.verdict,
            "story": c.story,
            "enrolled_on": c.enrolled_on.isoformat(),
            "states": states,
        }

    # Sofie is the hero: full per-day state for September, plus her raw history for the model scene.
    sofie = cases.CASES["sofie_steady"]
    uid = "case-sofie_steady"
    txs = cases.generate_case("sofie_steady", end=AS_OF, user_id=uid)
    e = Enrollment(user_id=uid, difficulty="normal", fund_id="kbc-sustainable-balanced", enrolled_on=sofie.enrolled_on)
    daily = {}
    for d in every_day(sofie.enrolled_on, AS_OF):
        s, _ = engine.replay(uid, e, [t for t in txs if t.booking_date <= d], d)
        daily[d.isoformat()] = {
            "tier": s.swan.tier, "health": s.swan.health, "buffer": s.month.buffer, "limit": s.today.limit,
            "invested": s.rewards.total_invested,
        }
    data["sofie_daily"] = daily

    history = [t for t in txs if t.booking_date < sofie.enrolled_on]
    p = build_profile(txs, before=sofie.enrolled_on, savings_rate=0.10)
    kinds = {}
    for t in history:
        k = p.classify(t)
        if k == "discretionary" and -t.amount > 0 and t.booking_date in {d for d, _, _ in p.ignored_one_offs}:
            k = "large"
        kinds.setdefault(k, []).append(t)
    # History-time noise uses the history threshold (ignored_one_offs), mark those explicitly.
    one_off_keys = {(d.isoformat(), m, round(a, 2)) for d, m, a in p.ignored_one_offs}
    classified = []
    for t in sorted(history, key=lambda t: (t.booking_date, t.transaction_id)):
        k = p.classify(t)
        if (t.booking_date.isoformat(), t.merchant or "", round(-t.amount, 2)) in one_off_keys:
            k = "large"
        classified.append({"date": t.booking_date.isoformat(), "amount": t.amount, "merchant": t.merchant, "category": t.category, "kind": k})
    first = min(t.booking_date for t in history)
    per_day = {d.isoformat(): 0.0 for d in every_day(first, sofie.enrolled_on - timedelta(days=1))}
    for c in classified:
        if c["kind"] == "discretionary":
            per_day[c["date"]] += -c["amount"]
    # Raw weekday ratios (before shrinkage) so the video can show the shrink step.
    vals = list(per_day.values())
    overall = sum(vals) / len(vals)
    wd = {w: [] for w in range(7)}
    for d, v in per_day.items():
        wd[date.fromisoformat(d).weekday()].append(v)
    raw = {WEEKDAYS[w]: (sum(v) / len(v)) / overall for w, v in wd.items()}
    data["sofie_model"] = {
        "profile": dump(p.to_schema()),
        "raw_weekday": raw,
        "history_per_day": per_day,
        "transactions": classified,
        "counts": {k: sum(1 for c in classified if c["kind"] == k) for k in ["income", "fixed", "recurring", "discretionary", "large"]},
        "totals": {k: round(sum(-c["amount"] for c in classified if c["kind"] == k), 2) for k in ["fixed", "recurring", "discretionary", "large"]},
        "income_total": round(sum(c["amount"] for c in classified if c["kind"] == "income"), 2),
        "config": {"floor": MODEL.large_expense_floor, "p95_mult": MODEL.large_expense_p95_multiplier, "target_mult": MODEL.large_expense_target_multiplier, "shrink": MODEL.weekday_shrinkage, "bounds": MODEL.weekday_factor_bounds},
    }
    data["sofie_game_txs"] = [
        {"date": t.booking_date.isoformat(), "amount": t.amount, "merchant": t.merchant, "category": t.category}
        for t in txs if date(2026, 9, 1) <= t.booking_date <= AS_OF
    ]

    # The laptop story: generic big_purchase persona, enrolled 29 days before as_of (purchase on day 12).
    ptx, pe, pstates = persona_states("big_purchase", 29, list(every_day(AS_OF - timedelta(days=29), AS_OF)))
    data["personas"]["big_purchase"] = {"enrolled_on": pe.enrolled_on.isoformat(), "states": pstates}

    data["sofie_states"] = {}
    for d in every_day(date(2026, 8, 25), AS_OF):
        s, _ = engine.replay(uid, e, [t for t in txs if t.booking_date <= d], d)
        data["sofie_states"][d.isoformat()] = dump(s)
    data["laptop"] = laptop_story()

    (OUT / "engine.json").write_text(json.dumps(data, indent=1, ensure_ascii=False))
    print("wrote", OUT / "engine.json", round((OUT / "engine.json").stat().st_size / 1024), "KB")


def laptop_story():
    """Sofie buys a EUR 449 laptop on 3 Sep, then spends 40% less on everyday things. Real engine output."""
    from blackswan.schemas import Transaction

    c = cases.CASES["sofie_steady"]
    uid = "case-sofie_steady"
    buy_day, amount, mult = date(2026, 9, 3), 449.0, 0.6
    txs = []
    for t in cases.generate_case("sofie_steady", end=AS_OF, user_id=uid):
        everyday = t.amount < 0 and (t.category or "") not in MODEL.fixed_categories and t.category not in ("telecom", "sport", "entertainment")
        if everyday and buy_day < t.booking_date <= date(2026, 9, 24):
            t = t.model_copy(update={"amount": round(t.amount * mult, 2)})
        txs.append(t)
    txs.append(Transaction(transaction_id="laptop", booking_date=buy_day, amount=-amount, merchant="MediaMarkt", category="electronics"))
    e = Enrollment(user_id=uid, difficulty="normal", fund_id="kbc-sustainable-balanced", enrolled_on=c.enrolled_on)
    days = {}
    for d in every_day(date(2026, 8, 25), date(2026, 9, 25)):
        s, _ = engine.replay(uid, e, [t for t in txs if t.booking_date <= d], d)
        days[d.isoformat()] = dump(s)
    return {"buy_day": buy_day.isoformat(), "amount": amount, "states": days}


if __name__ == "__main__":
    main()
