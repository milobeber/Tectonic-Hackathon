"""Export the four deck cases: model output, day-by-day game, app screens, transactions.

    cd backend && ../.venv/bin/python scripts/export_deck_cases.py

Writes docs/deck/cases.json, docs/deck/transactions_<case>.csv, docs/deck/CASES.md and the visual
report docs/deck/report.html (from scripts/deck_report_template.html).
"""

import csv
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from blackswan import engine  # noqa: E402
from blackswan.cases import CASES, generate_case  # noqa: E402
from blackswan.model import DAYS_PER_MONTH  # noqa: E402
from blackswan.schemas import Enrollment  # noqa: E402

AS_OF = date(2026, 9, 30)
OUT = Path(__file__).resolve().parents[2] / "docs" / "deck"
TEMPLATE = Path(__file__).resolve().parent / "deck_report_template.html"


def history_summary(profile, txs, enrolled_on):
    start = enrolled_on - timedelta(days=90)
    totals = {"income": 0.0, "fixed": 0.0, "recurring": 0.0, "discretionary": 0.0, "large": 0.0}
    for t in txs:
        if start <= t.booking_date < enrolled_on:
            totals[profile.classify(t)] += abs(t.amount)
    months = 90 / DAYS_PER_MONTH
    monthly = {k: round(v / months, 2) for k, v in totals.items()}
    monthly["income"] = round(profile.monthly_income, 2)  # wage counted once per month
    monthly["left_after_habits"] = round(
        monthly["income"] - monthly["fixed"] - monthly["recurring"] - monthly["discretionary"], 2
    )
    return monthly


def export_case(key):
    case = CASES[key]
    txs = generate_case(key, AS_OF)
    enrollment = Enrollment(user_id=key, difficulty="normal", fund_id="kbc-sustainable-balanced", enrolled_on=case.enrolled_on)
    state, timeline = engine.replay(key, enrollment, txs, AS_OF)
    profile = engine.enrollment_profile(enrollment, txs)

    highlights = []
    for day, caption in case.highlights:
        s = engine.simulate(key, enrollment, txs, day)
        highlights.append(
            {
                "date": day,
                "caption": caption,
                "today": s.today.model_dump(mode="json"),
                "swan": s.swan.model_dump(mode="json"),
                "month": s.month.model_dump(mode="json"),
                "events_today": [e.model_dump(mode="json") for e in s.events if e.date == day and e.type not in ("day_under", "day_over")],
            }
        )

    with open(OUT / f"transactions_{key}.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "phase", "merchant", "category", "amount_eur", "model_kind"])
        for t in txs:
            phase = "history" if t.booking_date < case.enrolled_on else "game"
            w.writerow([t.booking_date, phase, t.merchant, t.category, f"{t.amount:.2f}", profile.classify(t)])

    return {
        "key": key,
        "name": case.name,
        "tagline": case.tagline,
        "verdict": case.verdict,
        "story": case.story,
        "enrolled_on": case.enrolled_on,
        "transactions": len(txs),
        "model": state.model.model_dump(mode="json"),
        "history_monthly": history_summary(profile, txs, case.enrolled_on),
        "cycles": [c.model_dump(mode="json") for c in timeline.cycles],
        "days": [d.model_dump(mode="json") for d in timeline.days],
        "events": [e.model_dump(mode="json") for e in timeline.events],
        "highlights": highlights,
        "final": {
            "swan": state.swan.model_dump(mode="json"),
            "month": state.month.model_dump(mode="json"),
            "total_invested": state.rewards.total_invested,
            "swans_lost": sum(1 for c in timeline.cycles if c.swan_died),
        },
    }


def markdown(cases):
    lines = [f"# Deck cases (simulated up to {AS_OF})", ""]
    for c in cases:
        m, h, f = c["model"], c["history_monthly"], c["final"]
        wage = f"wage EUR {m['wage']['amount']:.0f} on the {m['wage']['day_of_month']}th" if m["wage"] else "no regular wage (calendar months)"
        lines += [
            f"## {c['name']}: {c['tagline']} ({c['verdict']})",
            "",
            c["story"],
            "",
            "**What the model learned (90 days before opting in)**",
            f"- Income: EUR {h['income']:.0f}/month, {wage}",
            f"- Fixed + recurring costs: EUR {h['fixed'] + h['recurring']:.0f}/month (recurring found: {', '.join(m['recurring_merchants'])})",
            f"- Day-to-day spending: EUR {m['baseline_daily']:.2f}/day (top: "
            + ", ".join(f"{k} {v:.2f}" for k, v in list(m["spend_by_category"].items())[:3])
            + ")",
            f"- Left each month after habits: EUR {h['left_after_habits']:.0f}",
            f"- One-offs ignored as noise: EUR {m['ignored_one_offs_total']:.0f}",
            f"- Affordable per day: EUR {m['affordable_daily']:.2f}" if m["affordable_daily"] else "- Affordable per day: unknown",
            f"- **Daily goal: EUR {m['target_daily']:.2f}** (weekday-adjusted)",
            "",
            "**How it played out**",
        ]
        for cy in c["cycles"]:
            status = "open" if not cy["closed"] else f"invested EUR {cy['swept']:.2f}"
            lines.append(
                f"- {cy['start']} to {cy['end']} ({cy['cycle_type']}): {cy['days_under']} days under, {cy['days_over']} over, "
                f"big buys EUR {cy['large_expenses_total']:.0f}, {status}{', swan died' if cy['swan_died'] else ''}"
            )
        lines += [
            f"- Now: swan {f['swan']['tier']} ({f['swan']['health']}), swans lost {f['swans_lost']}, total invested EUR {f['total_invested']:.2f}, "
            f"projected end of cycle balance EUR {f['month']['projected_end_balance']:.0f}",
            "",
            "**App screens**",
        ]
        for hl in c["highlights"]:
            t = hl["today"]
            lines.append(
                f"- {hl['date']}: {hl['caption']}. Limit EUR {t['limit']:.2f}, spent EUR {t['spent']:.2f}, swan {hl['swan']['tier']} ({hl['swan']['health']})"
            )
        lines.append("")
    return "\n".join(lines)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cases = [export_case(k) for k in CASES]
    payload = json.dumps({"as_of": AS_OF.isoformat(), "cases": cases}, indent=1, default=str)
    (OUT / "cases.json").write_text(payload)
    compact = json.dumps({"as_of": AS_OF.isoformat(), "cases": cases}, separators=(",", ":"), default=str)
    (OUT / "report.html").write_text(TEMPLATE.read_text().replace("/*__DATA__*/", compact.replace("</", "<\\/")))
    (OUT / "CASES.md").write_text(markdown(cases))
    for c in cases:
        f = c["final"]
        print(f"{c['key']:18} target {c['model']['target_daily']:6.2f}  swan {f['swan']['tier']:8}  lost {f['swans_lost']}  invested {f['total_invested']:8.2f}")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
