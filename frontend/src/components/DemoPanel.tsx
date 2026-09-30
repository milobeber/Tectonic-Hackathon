import type { GameEvent, GameState, Persona, Tier } from '../api/types'
import { money0, shortDate } from '../format'
import { addDays } from '../mock/simulate'

// Presenter controls for the demo video. Not part of the customer-facing product.

interface Props {
  hidden: boolean
  onToggleHidden: () => void
  sourceKind: 'mock' | 'live'
  onSourceKind: (k: 'mock' | 'live') => void
  apiUrl: string
  onApiUrl: (url: string) => void
  apiOk: boolean | null
  personas: Persona[]
  persona: string
  onPersona: (p: string) => void
  range: { start: string; end: string; cycleStart: string } | null
  asOf: string | null
  onAsOf: (d: string) => void
  playing: boolean
  onPlay: () => void
  tierOverride: Tier | null
  onTierOverride: (t: Tier | null) => void
  investedPreview: number | null
  onInvestedPreview: (v: number | null) => void
  onAddSpend: (amount: number, merchant: string, category: string) => void
  onShowOptIn: () => void
  screen: 'optin' | 'pond'
  busy: boolean
  error: string | null
  state: GameState | null
  moments: GameEvent[]
}

const TIERS: Tier[] = ['thriving', 'healthy', 'tired', 'sick', 'rotting', 'dead']
const SPENDS: [number, string, string, string][] = [
  [8.5, 'Panos', 'restaurants', 'Coffee & croissant'],
  [42, 'Cafe De Markt', 'restaurants', 'Dinner out'],
  [65, 'Zalando', 'shopping', 'Impulse buy'],
  [640, 'Brussels Airlines', 'travel', 'Flight (one-off)'],
]

// Key story moments from /timeline, shown as markers on the scrubber. One per day, most important wins.
const MOMENT_RANK: Partial<Record<GameEvent['type'], number>> = {
  swan_died: 7,
  large_expense_unaffordable: 6,
  large_expense_uncovered: 5,
  month_swept: 4,
  large_expense_absorbed: 3,
  swan_reborn: 2,
  limit_restored: 1,
}

function momentLabel(e: GameEvent): { text: string; tone: 'good' | 'bad' | 'info' } {
  const what = e.message.split(':')[0]
  const a = e.amount ? money0(e.amount) : ''
  switch (e.type) {
    case 'swan_died':
      return { text: 'Swan dies', tone: 'bad' }
    case 'large_expense_unaffordable':
      return { text: `${what} ${a}, can't afford`, tone: 'bad' }
    case 'large_expense_uncovered':
      return { text: `${what} ${a}, buffer short`, tone: 'bad' }
    case 'month_swept':
      return { text: `${a} invested`, tone: 'good' }
    case 'large_expense_absorbed':
      return { text: `${what} ${a}, buffer covers it`, tone: 'info' }
    case 'swan_reborn':
      return { text: 'New swan hatches', tone: 'good' }
    default:
      return { text: 'Full limit back', tone: 'good' }
  }
}

function keyMoments(events: GameEvent[]) {
  const best = new Map<string, GameEvent>()
  for (const e of events) {
    const rank = MOMENT_RANK[e.type]
    if (!rank) continue
    const cur = best.get(e.date)
    if (!cur || (MOMENT_RANK[cur.type] ?? 0) < rank) best.set(e.date, e)
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const titleCase = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const dayIndex = (start: string, d: string) => Math.round((Date.parse(d) - Date.parse(start)) / 86_400_000)

export function DemoPanel(p: Props) {
  if (p.hidden)
    return (
      <button className="director-reveal" onClick={p.onToggleHidden} aria-label="Show demo controls">
        Controls
      </button>
    )

  const total = p.range ? dayIndex(p.range.start, p.range.end) : 0
  const idx = p.range && p.asOf ? dayIndex(p.range.start, p.asOf) : 0
  const list = p.personas.length ? p.personas : [{ key: p.persona, description: '' }]
  const cases = list.filter((x) => x.kind === 'case')
  const others = list.filter((x) => x.kind !== 'case')
  const moments = p.range ? keyMoments(p.moments).filter((e) => e.date >= p.range!.start && e.date <= p.range!.end) : []
  const pos = (d: string) => `${(dayIndex(p.range!.start, d) / Math.max(total, 1)) * 100}%`

  return (
    <aside className="director" aria-label="Demo controls">
      <div className="director-head">
        <h3>Demo controls</h3>
        <button className="linkish" onClick={p.onToggleHidden} title="Shortcut: H">
          Hide
        </button>
      </div>

      <div className="dc-group">
        <span className="dc-label">Data</span>
        <div className="dc-seg">
          <button className={p.sourceKind === 'mock' ? 'on' : ''} onClick={() => p.onSourceKind('mock')}>
            In-browser mock
          </button>
          <button className={p.sourceKind === 'live' ? 'on' : ''} onClick={() => p.onSourceKind('live')}>
            Live API
          </button>
        </div>
        {p.sourceKind === 'live' && (
          <div className="dc-api">
            <span className={`dot ${p.apiOk === null ? '' : p.apiOk ? 'dot--ok' : 'dot--bad'}`} />
            <input value={p.apiUrl} onChange={(e) => p.onApiUrl(e.target.value)} spellCheck={false} aria-label="API URL" />
          </div>
        )}
      </div>

      <div className="dc-group">
        <span className="dc-label">Customer</span>
        <div className="dc-personas">
          {cases.map((x) => (
            <button
              key={x.key}
              className={`dc-persona ${p.persona === x.key ? 'on' : ''}`}
              onClick={() => p.onPersona(x.key)}
              disabled={p.busy}
              title={x.description}
            >
              <b>{x.name ?? titleCase(x.key)}</b>
              <em className="dc-tagline">
                {x.verdict && <i className={`dc-verdict dc-verdict--${x.verdict}`}>{x.verdict === 'good' ? 'Good' : 'Bad'}</i>}
                {x.tagline}
              </em>
              <span>{x.description}</span>
            </button>
          ))}
        </div>
        {others.length > 0 && (
          <details className="dc-more" open={cases.length === 0}>
            <summary>{cases.length ? 'More test personas' : 'Personas'}</summary>
            <div className="dc-personas">
              {others.map((x) => (
                <button
                  key={x.key}
                  className={`dc-persona ${p.persona === x.key ? 'on' : ''}`}
                  onClick={() => p.onPersona(x.key)}
                  disabled={p.busy}
                  title={x.description}
                >
                  <b>{x.name ?? titleCase(x.key)}</b>
                  <span>{x.description}</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="dc-group">
        <span className="dc-label">
          Timeline <em>{p.asOf ? shortDate(p.asOf) : '–'}</em>
        </span>
        <div className="dc-timeline">
          <button className="dc-play" onClick={p.onPlay} disabled={!p.range} aria-label={p.playing ? 'Pause' : 'Play'} title="Shortcut: space">
            {p.playing ? (
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path d="M7 4l13 8-13 8z" fill="currentColor" />
              </svg>
            )}
          </button>
          <div className="dc-range">
            <input
              type="range"
              min={0}
              max={total}
              value={idx}
              disabled={!p.range}
              onChange={(e) => p.range && p.onAsOf(addDays(p.range.start, Number(e.target.value)))}
              aria-label="Day"
            />
            {moments.map((e) => {
              const m = momentLabel(e)
              return (
                <button
                  key={e.date}
                  className={`dc-marker dc-marker--${m.tone}`}
                  style={{ left: pos(e.date) }}
                  onClick={() => p.onAsOf(e.date)}
                  title={`${shortDate(e.date)}: ${m.text}`}
                  aria-label={`${shortDate(e.date)}: ${m.text}`}
                />
              )
            })}
          </div>
        </div>
        {moments.length > 0 ? (
          <ul className="dc-moments">
            {moments.slice(0, 10).map((e) => {
              const m = momentLabel(e)
              return (
                <li key={e.date}>
                  <button className={`dc-moment dc-moment--${m.tone} ${p.asOf === e.date ? 'on' : ''}`} onClick={() => p.onAsOf(e.date)}>
                    <time>{shortDate(e.date)}</time>
                    <span>{m.text}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="dc-hint">Arrow keys step a day.</p>
        )}
      </div>

      <div className="dc-group">
        <span className="dc-label">Spend today</span>
        <div className="dc-spends">
          {SPENDS.map(([amount, merchant, category, label]) => (
            <button key={label} onClick={() => p.onAddSpend(amount, merchant, category)} disabled={!p.state || p.screen !== 'pond'}>
              <span>{label}</span>
              <b>€{amount}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="dc-group">
        <span className="dc-label">
          Preview lake <em>{p.investedPreview === null ? 'from data' : `€${p.investedPreview} invested`}</em>
        </span>
        <div className="dc-timeline">
          <button className={`dc-chip ${p.investedPreview === null ? 'on' : ''}`} onClick={() => p.onInvestedPreview(null)}>
            Data
          </button>
          <div className="dc-range">
            <input
              type="range"
              min={0}
              max={1500}
              step={10}
              value={p.investedPreview ?? p.state?.rewards.total_invested ?? 0}
              onChange={(e) => p.onInvestedPreview(Number(e.target.value))}
              aria-label="Preview invested amount"
            />
          </div>
        </div>
        <p className="dc-hint">Puddle → pond → reeds → forest → foxes (€300) → deer (€500) → heron, rainbow (€900+).</p>
      </div>

      <div className="dc-group">
        <span className="dc-label">Preview swan look</span>
        <div className="dc-tiers">
          <button className={p.tierOverride === null ? 'on' : ''} onClick={() => p.onTierOverride(null)}>
            From data
          </button>
          {TIERS.map((t) => (
            <button key={t} className={p.tierOverride === t ? 'on' : ''} onClick={() => p.onTierOverride(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="dc-group">
        <button className="dc-wide" onClick={p.onShowOptIn}>
          {p.screen === 'optin' ? 'Back to the pond' : 'Show opt-in screen'}
        </button>
      </div>

      {p.error && <p className="dc-error">{p.error}</p>}

      {p.state && (
        <details className="dc-raw">
          <summary>API response</summary>
          <pre>
            {JSON.stringify({ swan: p.state.swan, today: p.state.today, month: p.state.month, total_invested: p.state.rewards.total_invested }, null, 2)}
          </pre>
        </details>
      )}
    </aside>
  )
}
