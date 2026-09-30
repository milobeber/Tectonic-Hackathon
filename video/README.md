# Plume: demo film (HyperFrames)

Plume is the swan (and the product name, next to KBC's Kate). Black Swans is the team.

A 2:46 walkthrough ad for the jury. Every phone screen in it is the real demo app: the React
components in `frontend/src` rendered to static HTML and styled by the app's own `index.css`.
Every number comes from the real engine in `backend/blackswan`, run offline.

## Build pipeline

```bash
npm run build     # data + snippets + app-css + story (run after any frontend or backend change)
npm run vo        # re-edit the voiceover, remap anchors, regenerate the cue sheet and index.html
npm run cues      # only copy scene windows + sound effects from assets/lib/cues.js into index.html
npx hyperframes preview --background   # Studio preview
npx hyperframes render --quality draft -o renders/black-swan-draft.mp4
```

| Step | File | What it does |
|---|---|---|
| data | `build/export_data.py` | Runs the engine (no API, no DB) for Sofie, the 4 deck cases and the laptop scenario, writes `data/engine.json` |
| snippets | `build/snippets.tsx` | Renders `Phone`, `PondScreen`, `OptInScreen`, `Swan`, `Pond`, `Egg` to HTML, writes `data/snippets.js` |
| app-css | `build/app-css.mjs` | Copies `frontend/src/index.css` to `assets/app.css`, minus the desktop demo chrome |
| story | `build/story.mjs` | Condenses `engine.json` into the numbers the scenes quote (`data/story.js`) |
| vo | `build/vo.py`, `build/sync-cues.py` | Joins the two takes (raw + Plume fix), cuts the retake, inserts breathing pauses, cleans the voice; maps anchors and writes the cue sheet |
| cues | `build/cues.mjs` | Scene start/duration and SFX clips into `index.html` |

## Scenes (`compositions/`)

| | Scene | Real material |
|---|---|---|
| s01 | KBC Mobile home, transactions | KBC home rebuilt with KBC's design tokens (`assets/kbc.css`, `assets/lib/kbc.js`), app `Phone` shell |
| s02 | Opt-in: new card, new Swan tab, challenge, fund, consent | app `OptInScreen` |
| s03 | Egg hatches, the pond world breaks out of the screen, one number a day | app `Pond` (landscape), `PondScreen` |
| s04 | Swan through every tier, 7-day pace vs a habit | app `Swan` x6 + `Pond` x6, engine health rule |
| s05 | Buffer, EUR 449 laptop, earn-back | `PondScreen` from the laptop scenario |
| s06 | Payday sweep into the fund, lake grows | Sofie's real sweep EUR 132,25 |
| s07 | Under the hood: 90 days, sort, noise, baseline, rhythm, goal, freeze | Sofie's real profile |
| s08 | "Why EUR 23,73 today?", one API | `PondScreen` with the limit explainer open |
| s09 | Four customers | `PondScreen` for the 4 deck cases |
| s10 | Lockup | |

## When the frontend or the swan changes

1. `npm run build`, then snapshot a few frames (`npx hyperframes snapshot --at 30,45,60,150`).
2. The swan morph in s04 (`HF.swanMorph` in `assets/lib/hf.js`) drives the app's swan parts
   (`.swan-neck`, `.swan-head`, ...). If a redesigned swan no longer has them, it falls back
   to a cross-fade by itself; tweak `swanMorph` for a real morph.
3. The swan in s04 is placed from the app's `.pond-swan` box, so a resized swan still sits on the lake.

## Retiming to a new recording

Put the take in `assets/vo/` (`raw.m4a` full read, `fix.m4a` re-read lines), transcribe it
(whisper-cli with DTW), update `EDIT`, `GAPS` and `ANCHORS` in `build/vo.py`, then `npm run vo`.
That rewrites `vo.wav`, `anchors.json`, the cue sheet and `index.html` in one go.

Fonts: Bricolage Grotesque, Onest, JetBrains Mono, and Nunito Sans as an open stand-in for KBC's
licensed Museo Sans. SFX: Pixabay (see `assets/sfx/CREDITS.md`).
