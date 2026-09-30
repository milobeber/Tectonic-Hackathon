import { useEffect, useRef, useState } from 'react'
import type { DayRecord, GameEvent, GameState, Tier } from '../api/types'
import { useTween } from '../components/Animated'
import { Pond } from '../components/Pond'
import { addDays } from '../mock/simulate'
import { dayAfter, dayLabel, money, money0, moneyParts, monthName, shortDate, weekdayKey, weekdayName } from '../format'

interface Props {
  state: GameState
  tierOverride?: Tier | null
  /** Demo only: pretend this much has been invested, to show how the lake grows. */
  investedOverride?: number | null
  hatching?: boolean
}

const TIER_WORD: Record<Tier, string> = {
  thriving: 'Thriving',
  healthy: 'Healthy',
  tired: 'Tired',
  sick: 'Sick',
  rotting: 'Rotting',
  dead: 'Gone',
}

export function PondScreen({ state, tierOverride, investedOverride, hatching }: Props) {
  const tier = tierOverride ?? state.swan.tier
  const mood = tierOverride ? (tierOverride === 'dead' ? 'dead' : 'content') : state.swan.mood
  const { today, month, rewards, swan } = state
  const over = today.status === 'over'
  const shown = over ? today.spent - today.limit : today.remaining
  const parts = moneyParts(useTween(shown))
  const totalInvested = investedOverride ?? rewards.total_invested
  const invested = useTween(totalInvested, 1400)
  const passive = useTween(totalInvested * rewards.fund.expected_annual_return, 1400)
  const health = tierOverride ? healthFor(tierOverride) : swan.health
  const sweep = useSweepToast(state)

  return (
    <div className="screen pond-screen">
      <Pond
        tier={tier}
        mood={mood}
        totalInvested={totalInvested}
        hatching={hatching}
        lakeLabel={
          <>
            {sweep !== null && (
              <span className="sweep-toast" key={sweep}>
                +{money(sweep)} moved into your fund
              </span>
            )}
            <span className="lake-num">{money(invested)}</span>
            <span className="lake-cap">in your fund · ≈ {money(passive)} a year</span>
          </>
        }
      >
        <header className="topbar">
          <button className="icon-btn" aria-label="Back">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="topbar-title">Swan{swan.generation > 1 ? ` no. ${swan.generation}` : ''}</span>
          <span className="health-pill" title="Swan health">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.2 0 3.6 1.2 4.3 2.4.7-1.2 2.1-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z" fill="currentColor" />
            </svg>
            <span className="health-bar"><i style={{ width: `${health}%` }} /></span>
            <span className="health-word">{TIER_WORD[tier]}</span>
          </span>
        </header>

        <section className={`hero hero--${today.status}`}>
          <span className="sr-only" aria-live="polite">
            {over ? `${money(shown)} over today's limit` : `${money(shown)} left to spend today`}
          </span>
          <p className="hero-label">
            {over ? "Over today's limit" : 'Left to spend today'}
            {today.status === 'at_risk' && <span className="hero-chip">Nearly there</span>}
            {over && <span className="hero-chip hero-chip--over">Fresh start tomorrow</span>}
          </p>
          <p className="hero-num" aria-hidden>
            <span className="hero-cur">{over ? '−€' : '€'}</span>
            <span className="hero-whole">{parts.whole}</span>
            <span className="hero-cents">,{parts.cents}</span>
          </p>
          <p className="hero-sub">
            {money(today.spent)} of {money(today.limit)} spent · {dayLabel(today.date)}
          </p>
        </section>
      </Pond>

      <div className="sheet">
        {!swan.alive && !tierOverride && (
          <div className="card card--dead">
            <strong>Your swan didn't make it this month.</strong>
            <span>A new egg hatches on {dayAfter(month.end)}. Your savings so far still go into your fund.</span>
          </div>
        )}

        <BufferCard state={state} />
        <MonthBars history={state.history} month={month} />
        <LimitExplainer state={state} />
        <Activity events={state.events} />

        <p className="fineprint">
          Fund: {rewards.fund.name}, risk class {rewards.fund.risk_class}/7. {rewards.disclaimer}
        </p>
      </div>
    </div>
  )
}

/** Shows "+€X moved into your fund" for a moment whenever the invested total grows (month sweep). */
function useSweepToast(state: GameState) {
  const prev = useRef({ user: state.user_id, total: state.rewards.total_invested })
  const [amount, setAmount] = useState<number | null>(null)
  useEffect(() => {
    const p = prev.current
    const total = state.rewards.total_invested
    prev.current = { user: state.user_id, total }
    if (p.user !== state.user_id || total <= p.total + 0.005) return
    setAmount(total - p.total)
    const t = setTimeout(() => setAmount(null), 3200)
    return () => clearTimeout(t)
  }, [state.user_id, state.rewards.total_invested])
  return amount
}

function healthFor(t: Tier) {
  return { thriving: 92, healthy: 70, tired: 50, sick: 30, rotting: 14, dead: 0 }[t]
}

function BufferCard({ state }: { state: GameState }) {
  const { month, today } = state
  const buffer = useTween(month.buffer)
  const inDebt = month.debt > 0 || today.limit_reduction > 0
  const wage = month.cycle_type === 'wage'
  const projected = month.projected_end_balance
  return (
    <section className={`card buffer ${inDebt ? 'buffer--debt' : ''}`}>
      <div className="buffer-main">
        <span className="eyebrow">{wage ? 'Saved since payday' : 'Saved this month'}</span>
        <span className="buffer-num">{money(buffer)}</span>
        <span className="buffer-cap">
          {month.days_left > 0
            ? `Goes into your fund on ${dayAfter(month.end)}${wage ? ' (payday)' : ''}`
            : `Goes into your fund tonight`}
        </span>
      </div>
      {projected !== undefined ? (
        <div className={`buffer-proj ${projected < 0 ? 'buffer-proj--short' : ''}`}>
          <span className="eyebrow">{projected < 0 ? 'Short by' : 'Left by'} {wage ? 'payday' : 'month end'}</span>
          <span className="buffer-proj-num">
            {projected < 0 ? '−' : '+'}
            {money0(Math.abs(projected))}
          </span>
          <span className="buffer-cap">at this pace</span>
        </div>
      ) : (
        <svg className="buffer-drop" viewBox="0 0 40 52" aria-hidden>
          <defs>
            <clipPath id="drop-clip">
              <path d="M20 2C20 2 4 22 4 33a16 16 0 0 0 32 0C36 22 20 2 20 2z" />
            </clipPath>
          </defs>
          <path d="M20 2C20 2 4 22 4 33a16 16 0 0 0 32 0C36 22 20 2 20 2z" fill="var(--mist)" />
          <rect
            clipPath="url(#drop-clip)"
            x={0}
            width={40}
            y={52 - Math.min(1, month.buffer / Math.max(today.base_limit * 10, 1)) * 50}
            height={52}
            fill="var(--kbc-sky)"
            style={{ transition: 'y .8s ease' }}
          />
        </svg>
      )}
      {inDebt && (
        <p className="buffer-debt">
          A big expense emptied your buffer
          {month.debt > 0 ? <> · {money(month.debt)} left to earn back</> : null}. Your limit is{' '}
          {money(today.limit_reduction)} lower per day until then.
        </p>
      )}
      {!inDebt && projected !== undefined && projected < 0 && (
        <p className="buffer-debt">At today's pace you'll run out of money before {wage ? 'payday' : 'the month ends'}.</p>
      )}
      {month.large_expenses_total > 0 && !inDebt && (projected === undefined || projected >= 0) && (
        <p className="buffer-note">Your buffer caught {money(month.large_expenses_total)} in one-off expenses this cycle.</p>
      )}
    </section>
  )
}

function MonthBars({ history, month }: { history: DayRecord[]; month: GameState['month'] }) {
  const byDate = new Map(history.map((r) => [r.date, r]))
  const days: string[] = []
  for (let d = month.start; d <= month.end && days.length < 40; d = addDays(d, 1)) days.push(d)
  const { days_under: daysUnder, days_over: daysOver } = month
  const title =
    month.cycle_type === 'wage' ? `${shortDate(month.start)} – ${shortDate(month.end)}` : monthName(month.end)
  const dayNo = history.length
  return (
    <section className="card month">
      <div className="card-head">
        <span className="eyebrow">
          {title} <span className="cycle-day">· Day {dayNo} of {days.length}</span>
        </span>
        <span className="month-tally">
          <b className="t-under">{daysUnder}</b> under · <b className="t-over">{daysOver}</b> over
        </span>
      </div>
      <div className="bars" role="img" aria-label={`${daysUnder} days under your limit, ${daysOver} over`}>
        {days.map((day) => {
          const r = byDate.get(day)
          if (!r) return <span key={day} className="bar bar--empty" title={shortDate(day)} />
          const ratio = r.limit > 0 ? r.spent / r.limit : 0
          const h = Math.max(6, Math.min(ratio, 1.6) * 62.5)
          return (
            <span key={day} className={`bar bar--${r.status}`} title={`${shortDate(day)}: ${money(r.spent)} of ${money(r.limit)}`}>
              <i style={{ height: `${h}%` }} />
              {r.large_expenses > 0 && <em className="bar-large" />}
            </span>
          )
        })}
        <span className="bars-limit" aria-hidden />
      </div>
      <div className="bars-legend">
        <span>
          <i className="lg lg-under" /> Under limit
        </span>
        <span>
          <i className="lg lg-over" /> Over
        </span>
        <span>
          <i className="lg lg-large" /> One-off, paid by buffer
        </span>
      </div>
    </section>
  )
}

function LimitExplainer({ state }: { state: GameState }) {
  const [open, setOpen] = useState(false)
  const m = state.model
  const key = weekdayKey(state.today.date)
  const factor = m.weekday_factors[key] ?? 1
  return (
    <section className="card explain">
      <button className="explain-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Why {money(state.today.limit)} today?</span>
        <svg viewBox="0 0 24 24" width="18" height="18" style={{ transform: open ? 'rotate(180deg)' : undefined }} aria-hidden>
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
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
            {money(m.large_expense_threshold)} are paid from your buffer instead of today's limit. Learned from {m.history_days} days of
            your KBC transactions.
          </p>
        </dl>
      )}
    </section>
  )
}

const EVENT_ICON: Record<GameEvent['type'], string> = {
  day_under: '✓',
  day_over: '!',
  large_expense_absorbed: '◆',
  large_expense_uncovered: '◆',
  large_expense_unaffordable: '!',
  limit_reduced: '↓',
  limit_restored: '↑',
  swan_died: '✕',
  swan_reborn: '◯',
  month_swept: '€',
}

function eventText(e: GameEvent): { title: string; amount?: string; tone: 'good' | 'bad' | 'info' } {
  const merchant = e.message.split(':')[0]
  const a = e.amount ?? 0
  switch (e.type) {
    case 'day_under':
      return { title: 'Stayed under your limit', amount: `+${money(a)}`, tone: 'good' }
    case 'day_over':
      return { title: `Went over your limit`, amount: `−${money(a)}`, tone: 'bad' }
    case 'large_expense_absorbed':
      return { title: `${merchant} paid from your buffer`, amount: money(a), tone: 'info' }
    case 'large_expense_uncovered':
      return { title: `${merchant} was bigger than your buffer`, amount: money(a), tone: 'bad' }
    case 'large_expense_unaffordable':
      return { title: `${merchant} puts payday at risk`, amount: money(a), tone: 'bad' }
    case 'limit_reduced':
      return { title: 'Daily limit lowered to earn it back', tone: 'bad' }
    case 'limit_restored':
      return { title: 'Earned it back. Full limit restored', tone: 'good' }
    case 'swan_died':
      return { title: "Your swan didn't make it", tone: 'bad' }
    case 'swan_reborn':
      return { title: 'A new cygnet hatched', tone: 'good' }
    case 'month_swept':
      return { title: 'Invested in your fund', amount: `+${money(a)}`, tone: 'good' }
  }
}

function Activity({ events }: { events: GameEvent[] }) {
  if (!events.length) return null
  return (
    <section className="card activity">
      <div className="card-head">
        <span className="eyebrow">Recent</span>
      </div>
      <ul>
        {events.slice(0, 6).map((e, i) => {
          const t = eventText(e)
          return (
            <li key={`${e.date}-${e.type}-${i}`} className={`ev ev--${t.tone}`}>
              <span className="ev-icon" aria-hidden>
                {EVENT_ICON[e.type]}
              </span>
              <span className="ev-text">
                <span className="ev-title">{t.title}</span>
                <span className="ev-date">{dayLabel(e.date)}</span>
              </span>
              {t.amount && <span className="ev-amount">{t.amount}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
