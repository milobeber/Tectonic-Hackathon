# Game rules and model

All numbers below are defaults from `backend/blackswan/config.py`.

## 1. The model: from transactions to a daily limit

The model is learned **once, at enrollment**, from the 90 days before it.

1. **Split transactions**
   - money in: income (used only for the affordability cap)
   - fixed-cost categories (rent, utilities, insurance, ...): never part of the limit
   - recurring payments (same merchant, about once a month, amount varies less than 15%, e.g. Netflix, gym, phone): never part of the limit
   - everything else is discretionary
2. **Remove noise.** A discretionary transaction above
   `max(EUR 100, 1.5 x p95 of transaction sizes, 3 x daily target)` counts as a **large one-off expense**.
3. **Baseline** = average daily discretionary spend (zero-spend days included,
   noise removed, daily totals winsorized at p98).
4. **Weekday pattern.** Per-weekday spend relative to the average, shrunk 60%
   toward 1 and clipped to [0.5, 1.8]. Someone who spends big on weekends gets
   higher weekend limits.
5. **Target** = baseline x (1 - savings rate): easy 5%, normal 10%, hard 20%.
   Capped at 90% of disposable income (income minus fixed costs) and never below EUR 5.
6. **Daily base limit** = target x weekday factor.

Why statistics and not a black-box ML model: the bank has to be able to explain
every limit to a customer. `GET /profile` shows exactly why a limit is what it is.

Why the profile is frozen at enrollment: re-learning from game months would
ratchet. Savers would get a tighter limit every month and overspenders a looser one.

## 2. Money: buffer and debt

One signed balance per month:

| Event | Effect |
|---|---|
| Day settles at or under the limit | balance += base limit - spent (goes into the **buffer**) |
| Day settles over the limit | the overspend is taken from the buffer, down to 0. **Everyday overspending never creates debt.** |
| Large one-off expense | paid from the buffer. What the buffer cannot cover becomes **debt**. |
| Debt > 0 | debt / days left in month is taken off every day's limit (limit stays at least 60% of base). Saving pays it back, and then the full limit returns. |
| Month end | buffer is **swept into the chosen KBC fund**. Leftover debt is forgiven: fresh start. |

## 3. The swan

- Health 0-100, starts at 70.
- Every settled day scores 1.0 if under the limit. Over the limit:
  `score = max(0, 1 - 2 x effective_overspend / limit)`. Half of an overspend that the buffer can cover is forgiven, so saving earlier earns slack.
- `health += 0.2 x (100 x score - health)` (exponential moving average): one bad
  day hurts a bit, a pattern hurts a lot.
- Large expense the buffer covers: no health effect (it is noise). Large expense it cannot cover: -15.
- Health below 10: the swan **dies** for the rest of the month. Next month a new
  cygnet hatches at 50 health (`generation` + 1).

| Health | Tier | Mood |
|---|---|---|
| 80+ | thriving | happy |
| 60-79 | healthy | content |
| 40-59 | tired | worried |
| 20-39 | sick | sad |
| 10-19 | rotting | critical |
| dead | dead | dead |

Mood turns `worried` while today's spend is already over the limit.

## 4. Demo personas (synthetic data)

| Persona | Story |
|---|---|
| `steady_saver` | Spends about 70% of normal after enrolling. Thriving swan, growing buffer. |
| `weekend_splurger` | Big weekends. The model gives higher weekend limits. Swan stays healthy. |
| `impulse_spender` | 1.5x normal plus impulse buys. Sick, then dead in about 2-3 weeks. |
| `big_purchase` | Buys an EUR 899 laptop. Buffer covers part of it, limits drop, spends less afterwards, swan survives. |

## 5. Open questions for the team

- Should the swan's health or the buffer reset when the customer changes difficulty mid-month?
- Recalibration: re-learn the profile every 3-6 months, or on life events (new job, moving)?
- Reward: pure buffer sweep, or does KBC add a bonus when the swan survives the month?
- Is a EUR 100 large-expense floor right, or should it scale with income?
