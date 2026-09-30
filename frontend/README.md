# Black Swan: demo frontend

The swan screen as it would appear inside KBC Mobile, plus demo controls for recording the video.
It renders the `GameState` returned by the Black Swan API (`backend/blackswan/schemas.py`) and nothing else,
so KBC could rebuild this screen natively from the same JSON.

## Run

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

By default it uses an **in-browser mock** that mirrors the backend rules, so it works without the API.
To use the real model, start the backend and click **Live API** in the demo controls:

```bash
cd backend
../.venv/bin/uvicorn blackswan.api:app --reload --port 8000
```

Config (optional, `frontend/.env.local`):

```
VITE_API_URL=http://localhost:8000
VITE_API_KEY=dev-key
```

URL shortcuts: `/?live` opens straight on the API, `/?api=http://192.168.1.20:8000` points it at another machine.

Other views:

- `/?gallery`: all six swan states side by side (for slides).

## What's on screen

| Element | Driven by |
| --- | --- |
| Big number in the sky | `today.remaining`, or `today.spent - today.limit` when `today.status == "over"` |
| Swan pose, colour, extras | `swan.tier` (thriving → dead), sweat drop when `swan.mood == "worried"` |
| Weather (sun, clouds, rain, night storm) | `swan.tier` |
| Lake size + number on the lake | `rewards.total_invested` (log scale), `rewards.estimated_annual_passive_income` |
| "Saved since payday" | `month.buffer`, sweep date = day after `month.end` (payday), debt banner from `month.debt` / `today.limit_reduction` |
| "Left / short by payday" | `month.projected_end_balance` |
| Cycle bars, "Day 6 of 30" | `history[]` over `month.start..month.end` (spent / limit per day, one-off expenses marked) |
| "Why €X today?" | `model` (baseline, savings rate, weekday factor, large-expense threshold) |
| Recent | `events[]` |

## Demo controls

Hidden with **H** (for clean recordings). **Space** plays the timeline, **←/→** step a day.

- **Data**: in-browser mock or live API (URL editable, green dot = `/health` OK).
- **Customer**: the four deck cases (Sofie, Lucas, Emma, Jonas, with good/bad verdict) come first, generic test personas under "More test personas". Seeds via `POST /v1/demo/seed`; cases have fixed story dates from 24 Jul, so two full payday cycles are scrubbable.
- **Timeline**: replays the game day by day with `GET /v1/users/{id}/game-state?as_of=`. Coloured dots and the list below the slider are the key moments from `GET /v1/users/{id}/timeline` (unaffordable buys, swan deaths, paydays invested); click one to jump there.
- **Spend today**: posts a transaction for the current day via `POST /v1/users/{id}/transactions`. The €640 flight is a one-off the buffer absorbs.
- **Preview swan look**: overrides the tier to show any state.
- **Show opt-in screen**: the enrollment flow (difficulty + fund + consent → `PUT /enrollment`), ending in the egg hatching.

## Suggested video flow (about 90 s)

Open `/?live` with the backend running.

1. **Show opt-in screen**: pick Normal, a fund, consent, **Hatch my swan**. The egg hatches.
2. **Sofie** (good): press **Space**. Sunny cycle, payday on 24 Aug sweeps €175 into the fund (toast + lake grows), "Left by payday" stays positive.
3. Tap **Why €X today?**: the model explains the limit (habits, −10%, weekday factor, noise ignored).
4. **Lucas** (good, no wage): jump to 27 Aug, the €135 bike repair is paid from the buffer, swan unharmed.
5. **Jonas** (bad): jump to 25 Jul (designer bag, can't afford), then 27 Jul (swan dies, night storm, belly-up swan). New swan hatches on payday.
6. **Emma** (bad): 2 Aug, overspending daily, "Short by payday" in red, sick swan.
7. End on `/?gallery`.

## Swan images

`src/assets/swan/` holds one transparent image per look, all facing left, same scale.
Healthy reuses `thriving`, sick reuses `tired` (tinted) until they have their own drawing.
To add one: drop the `.webp` in that folder, import it in `components/Swan.tsx`, add it to
`SPRITES` (pixel size, how far it sinks into the water, head position) and point the tier to it in `SPRITE_FOR`.

## Structure

```
src/
  api/types.ts        GameState types (mirror of schemas.py)
  api/client.ts       SwanSource interface: live API + mock
  mock/simulate.ts    in-browser port of synthetic.py + model.py + engine.py
  assets/swan/*.webp  swan illustrations (transparent, facing left)
  components/Swan.tsx picks a sprite per health state, adds reflection, ripples, flies
  components/Pond.tsx sky and weather
  components/World.tsx lake that grows with invested money, plants, forest, animals
  screens/            PondScreen, OptInScreen, Gallery
  components/DemoPanel.tsx  presenter controls
```
