// Renders the real demo-app React components to static HTML for the video.
// The video never re-implements the app UI: every phone screen is this markup,
// styled by the app's own index.css (see build/app-css.mjs).
//
//   npm run snippets   (bundles this file with esbuild, then runs it with node)

import { writeFileSync } from 'node:fs'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GameState, Tier } from '../../frontend/src/api/types'
import { Phone } from '../../frontend/src/components/Phone'
import { Egg } from '../../frontend/src/components/Egg'
import { Pond } from '../../frontend/src/components/Pond'
import { Swan } from '../../frontend/src/components/Swan'
import { money, weekdayKey, weekdayName } from '../../frontend/src/format'
import { OptInScreen } from '../../frontend/src/screens/OptInScreen'
import { PondScreen } from '../../frontend/src/screens/PondScreen'
import engine from '../data/engine.json'

const data = engine as unknown as {
  sofie_states: Record<string, GameState>
  cases: Record<string, { states: Record<string, GameState> }>
  laptop: { states: Record<string, GameState> }
}

const TIERS: Tier[] = ['thriving', 'healthy', 'tired', 'sick', 'rotting', 'dead']
const MOOD = { thriving: 'happy', healthy: 'content', tired: 'worried', sick: 'sad', rotting: 'critical', dead: 'dead' } as const

let n = 0
const out: Record<string, string> = {}
function put(key: string, el: ReactElement) {
  // A unique prefix per snippet keeps useId() gradient/clip ids from colliding once
  // several snippets live in the same assembled video page.
  out[key] = renderToStaticMarkup(el, { identifierPrefix: `s${n++}-` })
}

// PondScreen keeps "Why this limit?" collapsed in local state; this is its open
// state, same markup and classes as LimitExplainer in PondScreen.tsx.
function ExplainerOpen({ state }: { state: GameState }) {
  const m = state.model
  const factor = m.weekday_factors[weekdayKey(state.today.date)] ?? 1
  return (
    <section className="card explain">
      <button className="explain-toggle" aria-expanded>
        <span>Why {money(state.today.limit)} today?</span>
        <svg viewBox="0 0 24 24" width="18" height="18" style={{ transform: 'rotate(180deg)' }} aria-hidden>
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
      <dl className="explain-rows">
        <div>
          <dt>You usually spend</dt>
          <dd>{money(m.baseline_daily)} a day</dd>
        </div>
        <div>
          <dt>Savings goal</dt>
          <dd>−{Math.round(m.savings_rate * 100)}%</dd>
        </div>
        <div>
          <dt>{weekdayName(state.today.date)}s</dt>
          <dd>×{factor.toFixed(2)}</dd>
        </div>
        {state.today.limit_reduction > 0 && (
          <div>
            <dt>Earning back a big expense</dt>
            <dd>−{money(state.today.limit_reduction)}</dd>
          </div>
        )}
        <p className="explain-note">
          Rent, bills and subscriptions ({m.recurring_merchants.slice(0, 3).join(', ') || 'none found'}) never count. One-offs above{' '}
          {money(m.large_expense_threshold)} are paid from your buffer instead of today's limit. Learned from {m.history_days} days of your KBC
          transactions.
        </p>
      </dl>
    </section>
  )
}

const HERO_DAY = '2026-09-24'
const hero = data.sofie_states[HERO_DAY]
const noop = () => {}

// Device shell. The screen goes where the @@SLOT@@ marker is.
put('phone', <Phone>{'@@SLOT@@'}</Phone>)

put('optin', <OptInScreen busy={false} onStart={noop} />)
put('egg', <Egg />)

// The hero day: Sofie on Thursday 24 September, payday eve.
put('pond_hero', <PondScreen state={hero} />)
put('pond_hero_morning', <PondScreen state={{ ...hero, today: { ...hero.today, spent: 0, remaining: hero.today.limit } }} />)
put('pond_hatching', <PondScreen state={data.sofie_states['2026-08-25']} hatching />)
put('explainer_hero', <ExplainerOpen state={hero} />)

for (const t of TIERS) {
  put(`swan_${t}`, <Swan tier={t} mood={MOOD[t]} />)
  // A 960 x 540 landscape pond, scaled x2 in the video to fill the frame.
  put(`world_${t}`, <Pond tier={t} mood={MOOD[t]} totalInvested={hero.rewards.total_invested} />)
  put(`pond_tier_${t}`, <PondScreen state={hero} tierOverride={t} />)
}

// The laptop story (see export_data.py: laptop_story).
for (const day of ['2026-09-02', '2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24', '2026-09-25']) {
  put(`pond_laptop_${day}`, <PondScreen state={data.laptop.states[day]} />)
}

// Payday: the sweep has landed.
put('pond_payday', <PondScreen state={data.sofie_states['2026-09-25']} />)

// Four customers, four swans.
put('pond_case_sofie', <PondScreen state={hero} />)
put('pond_case_lucas', <PondScreen state={data.cases.lucas_freelancer.states['2026-09-30']} />)
put('pond_case_emma', <PondScreen state={data.cases.emma_gourmet.states['2026-09-30']} />)
put('pond_case_jonas', <PondScreen state={data.cases.jonas_impulse.states['2026-09-30']} />)

const file = 'data/snippets.js' // run from video/
writeFileSync(file, `// Generated by build/snippets.tsx. Do not edit.\nwindow.SNIPPETS = ${JSON.stringify(out)};\n`)
console.log(`wrote ${Object.keys(out).length} snippets, ${Math.round(JSON.stringify(out).length / 1024)} KB`)
