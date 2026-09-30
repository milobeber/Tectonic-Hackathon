# Black Swan API: KBC integration guide

Base URL (local): `http://localhost:8000`. Auth: header `X-API-Key`.
Full OpenAPI spec: `/docs` (Swagger UI) or `/openapi.json`.

## Integration flow

1. **Opt-in.** The customer enables the swan in the KBC app, and KBC calls
   `PUT /v1/users/{user_id}/enrollment`.
2. **History.** KBC pushes about 90 days of booked transactions with
   `POST /v1/users/{user_id}/transactions`. The model learns from everything
   before the enrollment date.
3. **Ongoing.** KBC pushes new transactions as they book (single or batch).
   Each push returns the updated `GameState`, so no second call is needed.
4. **Render.** Whenever the swan screen opens, call `GET /v1/users/{user_id}/game-state`.
5. **Payday.** Game cycles run from payday to payday (the wage is detected
   automatically; calendar months if there is none). `game_state.rewards.sweeps`
   lists `{month, amount, fund_id, cycle_start, cycle_end}`: the amount KBC
   should invest for each closed cycle.
6. **Opt-out.** `DELETE /v1/users/{user_id}/enrollment` deletes the enrollment
   and all transactions.

Data is accepted only for enrolled users (privacy by design). The service
stores raw inputs only. Game state is recomputed deterministically, so late or
duplicate deliveries are safe: `transaction_id` is the idempotency key.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness (no auth) |
| GET | `/v1/funds` | Funds a customer can pick for their buffer |
| PUT | `/v1/users/{id}/enrollment` | Opt in, or change difficulty/fund |
| GET | `/v1/users/{id}/enrollment` | Read enrollment |
| DELETE | `/v1/users/{id}/enrollment` | Opt out and delete all data |
| POST | `/v1/users/{id}/transactions` | Push transactions and get `GameState` back (`?include_state=false` to skip) |
| GET | `/v1/users/{id}/game-state` | `GameState` for rendering (`?as_of=YYYY-MM-DD` to time-travel) |
| GET | `/v1/users/{id}/timeline` | Every day since enrollment across all cycles, per-cycle summaries, notable events (for charts) |
| GET | `/v1/users/{id}/profile` | What the model learned (explains the limit) |
| POST | `/v1/evaluate` | Stateless: send enrollment and transactions, get `GameState`, nothing stored |
| GET | `/v1/demo/personas` | Deck cases first (`kind: "case"`), then generic personas |
| POST | `/v1/demo/seed` | Create an enrolled demo user with synthetic history. Deck cases keep their own story dates (enrolled 2026-07-24 / 2026-08-01) |

## Transaction (input)

Signed amounts, PSD2 style: negative means money out.

```json
{
  "transaction_id": "tx_2026_09_14_0001",
  "booking_date": "2026-09-14",
  "amount": -23.5,
  "currency": "EUR",
  "merchant": "Delhaize",
  "category": "groceries"
}
```

`category` is optional but helps. These categories are treated as fixed costs
and never count toward the daily limit: `rent, mortgage, utilities, insurance,
loan, taxes, savings, investment, transfer, internal_transfer, healthcare,
childcare, education`. Subscriptions and standing orders are detected
automatically.

## GameState (output, abridged)

Real output from the `big_purchase` demo persona:

```json
{
  "user_id": "demo-big_purchase",
  "as_of": "2026-09-30",
  "swan":   { "health": 63.7, "tier": "healthy", "mood": "content", "alive": true, "generation": 1, "streak_days": 0 },
  "today":  { "date": "2026-09-30", "base_limit": 24.7, "limit_reduction": 9.88, "limit": 14.82,
              "spent": 0.0, "remaining": 14.82, "large_expenses": 0.0, "status": "on_track" },
  "month":  { "month": "2026-09", "buffer": 0.0, "debt": 771.12, "limit_reduction_per_day": 9.88,
              "days_under": 9, "days_over": 20, "large_expenses_total": 899.0, "days_left": 0 },
  "rewards":{ "fund": { "id": "kbc-sustainable-balanced", "...": "..." }, "total_invested": 0.0,
              "sweeps": [], "estimated_annual_passive_income": 0.0 },
  "history":[ { "date": "2026-09-01", "limit": 19.42, "spent": 34.57, "large_expenses": 0.0, "buffer": 0.0, "health": 56.0, "status": "over" } ],
  "events": [ { "date": "2026-09-13", "type": "large_expense_uncovered", "amount": 899.0, "health_delta": -15.0,
                "message": "MediaMarkt: EUR 899.00, buffer could only cover EUR 7.96." } ],
  "model":  { "baseline_daily": 25.73, "target_daily": 23.16, "weekday_factors": { "mon": 1.03, "...": "..." },
              "large_expense_threshold": 100.0, "recurring_merchants": ["basic fit", "engie", "netflix", "..."], "confidence": "high" }
}
```

Render hints:
- `swan.tier`: `thriving | healthy | tired | sick | rotting | dead`. Drives the swan sprite.
- `swan.mood`: `happy | content | worried | sad | critical | dead`. Turns `worried` when today is over the limit.
- `today.status`: `on_track | at_risk` (at least 80% of the limit spent) `| over`.
- `events[]`: newest first; notable events from the current and previous cycle, daily ones from the last 14 days.
  Types: `day_under, day_over, large_expense_absorbed, large_expense_uncovered, large_expense_unaffordable, limit_reduced, limit_restored, swan_died, swan_reborn, month_swept` (fires at the end of every cycle).
- `month` is the current **cycle**: `cycle_type` (`wage | calendar`), `start`, planned `end`, `income`,
  `spent_total` and `projected_end_balance` (negative = heading for a shortfall before payday).
- `model.wage`, `model.affordable_daily`, `model.spend_by_category` explain the goal.

## Next integration steps

- Real KBC auth (mTLS / OAuth2 client credentials) instead of API keys.
- Webhook from us to KBC when the swan changes tier (push notifications).
- Map the KBC PSD2 transaction feed (`transactionAmount`, `bookingDate`, `remittanceInformation`, MCC) onto `Transaction`.
