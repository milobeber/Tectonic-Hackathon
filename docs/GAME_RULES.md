# Game rules and model

All numbers below are defaults from `backend/blackswan/config.py`.
Worked examples with four customers: [deck/CASES.md](deck/CASES.md) and the visual report `deck/report.html`.

## 1. The model: from transactions to a daily goal

The model is learned **once, at enrollment**, from the 90 days before it.

1. **Split transactions**
   - money in: income. The **wage** is the biggest income that arrives about once a month (same payer, every gap 25-35 days, amount varies less than 25%, at least EUR 200). It sets the game's cycle.
   - fixed-cost categories (rent, utilities, insurance, loan, ...): never part of the goal
   - recurring payments (same merchant, about once a month, every gap 25-35 days, amount varies less than 15%, e.g. Netflix, gym, phone): never part of the goal
   - everything else is discretionary
2. **Remove noise.** A discretionary transaction above
   `max(EUR 100, 1.5 x p95 of transaction sizes, 3 x daily goal)` counts as a **large one-off expense**.
3. **Baseline** = average daily discretionary spend (zero-spend days included,
   noise removed, daily totals winsorized at p98).
4. **Weekday pattern.** Per-weekday spend relative to the average, shrunk 60%
   toward 1 and clipped to [0.5, 1.8]. Someone who spends big on weekends gets
   higher weekend limits.
5. **Target** = baseline x (1 - savings rate): easy 5%, normal 10%, hard 20%.
   Capped at 90% of disposable income (monthly income minus fixed costs, the wage counted
   once per month) and never below EUR 5. For someone whose habits cost more than they
   earn, the cap is what sets the goal.
6. **Daily base limit** = target x weekday factor.

Why statistics and not a black-box ML model: the bank has to be able to explain
every limit to a customer. `GET /profile` shows exactly why a limit is what it is.

Why the profile is frozen at enrollment: re-learning from game cycles would
ratchet. Savers would get a tighter limit every cycle and overspenders a looser one.

## 2. Cycles: payday to payday

- With a wage: a cycle starts the day the wage lands and runs until the day before the
  next one. Early or late wages (weekends, holidays) are fine: the next wage counts from
  20 days after the last one, and up to 5 days late. If no wage arrives by then, the
  cycle closes at the expected payday anyway.
- Without a wage (freelancers, students): calendar months.
- The first cycle runs from the enrollment date to the next payday.

## 3. Money: buffer and debt

One signed balance per cycle:

| Event | Effect |
|---|---|
| Day settles at or under the limit | balance += base limit - spent (goes into the **buffer**) |
| Day settles over the limit | the overspend is taken from the buffer, down to 0. **Everyday overspending never creates debt.** |
| Large one-off expense | paid from the buffer. What the buffer cannot cover becomes **debt**. |
| Debt > 0 | debt / days left in the cycle is taken off every day's limit (limit stays at least 60% of base). Saving pays it back, and then the full limit returns. |
| Cycle end (payday) | buffer is **swept into the chosen KBC fund**, capped by what is really left of the cycle's income: we never invest money the customer does not have. Leftover debt is forgiven: fresh start. |

`month.projected_end_balance` = cycle income minus projected spending at the current pace
(the pace is blended with the daily goal until about a week has settled). Negative means
the customer is heading for a shortfall before payday.

## 4. The swan

- Health 0-100, starts at 70.
- Every settled day is scored on the **pace of the last 7 days**:
  `over = (spent - limits) / limits` over that window; `score = 1` if under, else
  `max(0, 1 - 2 x over)`. One big shop balanced by quiet days is fine; a habit is not.
- `health += 0.2 x (100 x score - health)` (exponential moving average).
- Large expense the buffer covers: no health effect (it is noise).
  Large expense it cannot cover: -15. If it also pushes the cycle's projected
  spending above the cycle's income (**unaffordable**): -30, -60, -90... for the
  1st, 2nd, 3rd such buy in the same cycle.
- Health below 10: the swan **dies** for the rest of the cycle. At the next payday a new
  cygnet hatches at 50 health (`generation` + 1) with a clean pace window.

| Health | Tier | Mood |
|---|---|---|
| 80+ | thriving | happy |
| 60-79 | healthy | content |
| 40-59 | tired | worried |
| 20-39 | sick | sad |
| 10-19 | rotting | critical |
| dead | dead | dead |

Mood turns `worried` while today's spend is already over the limit.

## 5. Deck cases (synthetic, `backend/blackswan/cases.py`)

| Case | Story | Outcome by 30 Sep 2026 |
|---|---|---|
| `sofie_steady` | Nurse, wage on the 25th, trims spending by a fifth | healthy swan, EUR 308 invested over two paydays |
| `lucas_freelancer` | Freelancer, no wage (calendar months), EUR 135 bike repair absorbed by the buffer | thriving swan, EUR 174 invested |
| `emma_gourmet` | Premium groceries: habits EUR 41/day, can afford EUR 22/day, runs EUR 530/month short | swan dies every cycle, nothing invested |
| `jonas_impulse` | Designer bag, headphones, console right after payday, flagged unaffordable | swan dies within days every cycle, nothing invested |

Regenerate everything with `cd backend && ../.venv/bin/python scripts/export_deck_cases.py`.

Generic demo personas (`backend/blackswan/synthetic.py`): `steady_saver`, `weekend_splurger`,
`impulse_spender`, `big_purchase`, enrolled a chosen number of days before `as_of`.

## 6. Open questions for the team

- Should the swan's health or the buffer reset when the customer changes difficulty mid-cycle?
- Recalibration: re-learn the profile every 3-6 months, or on life events (new job, moving)?
- Reward: pure buffer sweep, or does KBC add a bonus when the swan survives the cycle?
- Is a EUR 100 large-expense floor right, or should it scale with income?
