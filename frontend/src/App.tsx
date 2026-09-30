import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_API_URL, liveSource, mockSource, safeApiUrl, type SwanSource } from './api/client'
import type { Difficulty, GameEvent, GameState, Persona, Tier } from './api/types'
import { DemoPanel } from './components/DemoPanel'
import { Phone } from './components/Phone'
import { addDays, todayIso } from './mock/simulate'
import { OptInScreen } from './screens/OptInScreen'
import { PondScreen } from './screens/PondScreen'

// Two months of play by default: August gets swept into the fund, September is scrubbable.
const ENROLLED_DAYS_AGO = 59
const PARAMS = new URLSearchParams(location.search)

export default function App() {
  // ?live starts on the real API, ?api=<url> points it elsewhere (e.g. a teammate's laptop).
  const [sourceKind, setSourceKind] = useState<'mock' | 'live'>(() => (PARAMS.has('live') || PARAMS.has('api') ? 'live' : 'mock'))
  const [apiUrl, setApiUrl] = useState(() => safeApiUrl(PARAMS.get('api')) ?? DEFAULT_API_URL)
  const source: SwanSource = useMemo(() => (sourceKind === 'live' ? liveSource(apiUrl) : mockSource), [sourceKind, apiUrl])

  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [persona, setPersona] = useState('steady_saver')
  const [userId, setUserId] = useState<string | null>(null)
  const [range, setRange] = useState<{ start: string; end: string; cycleStart: string } | null>(null)
  const [asOf, setAsOf] = useState<string | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [tierOverride, setTierOverride] = useState<Tier | null>(null)
  const [investedPreview, setInvestedPreview] = useState<number | null>(null)
  const [screen, setScreen] = useState<'optin' | 'pond'>('pond')
  const [hatching, setHatching] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moments, setMoments] = useState<GameEvent[]>([])
  const [panelHidden, setPanelHidden] = useState(() => window.innerWidth < 800)

  const cache = useRef(new Map<string, GameState>())
  const loadToken = useRef(0)
  const wanted = useRef<string | null>(null)

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  // ---------------------------------------------------------------- loading

  const fetchState = useCallback(
    async (uid: string, day: string) => {
      const key = `${source.kind}|${uid}|${day}`
      const hit = cache.current.get(key)
      if (hit) return hit
      const s = await source.gameState(uid, day)
      cache.current.set(key, s)
      return s
    },
    [source],
  )

  const prefetch = useCallback(
    async (uid: string, start: string, end: string, token: number) => {
      for (let d = start; d <= end; d = addDays(d, 1)) {
        if (loadToken.current !== token) return
        try {
          await fetchState(uid, d)
        } catch {
          return
        }
      }
    },
    [fetchState],
  )

  const seed = useCallback(
    async (personaKey: string, opts?: { difficulty?: Difficulty; fundId?: string; startAtBeginning?: boolean }) => {
      const token = ++loadToken.current
      setBusy(true)
      setError(null)
      setPlaying(false)
      try {
        const end = todayIso()
        const res = await source.seed({ persona: personaKey, asOf: end, enrolledDaysAgo: ENROLLED_DAYS_AGO })
        if (opts?.difficulty || opts?.fundId) {
          await source.enroll(res.user_id, {
            difficulty: opts.difficulty ?? 'normal',
            fund_id: opts.fundId ?? 'kbc-sustainable-balanced',
            enrolled_on: res.enrollment.enrolled_on,
          })
        }
        for (const k of [...cache.current.keys()]) if (k.includes(`|${res.user_id}|`)) cache.current.delete(k)
        // The seed response is only valid as-is when the enrollment wasn't changed afterwards.
        if (!opts?.difficulty && !opts?.fundId) cache.current.set(`${source.kind}|${res.user_id}|${end}`, res.game_state)
        const start = res.enrollment.enrolled_on
        const day = opts?.startAtBeginning ? start : end
        const s = await fetchState(res.user_id, day)
        if (loadToken.current !== token) return
        setUserId(res.user_id)
        setRange({ start, end, cycleStart: res.game_state.month.start })
        setAsOf(day)
        setState(s)
        void prefetch(res.user_id, start, end, token)
        source.timeline(res.user_id, end).then(
          (t) => loadToken.current === token && setMoments(t.events),
          () => setMoments([]),
        )
      } catch (e) {
        fail(e)
      } finally {
        setBusy(false)
      }
    },
    [source, fetchState, prefetch],
  )

  // Initial load + whenever the data source changes.
  useEffect(() => {
    let alive = true
    setApiOk(null)
    source.health().then((ok) => {
      if (!alive) return
      setApiOk(ok)
      if (!ok) {
        setError(`Can't reach the API at ${apiUrl}. Start the backend or switch to mock data.`)
        return
      }
      source.personas().then((list) => {
        if (!alive) return
        setPersonas(list)
        const first = list[0]?.key ?? persona
        setPersona(first)
        void seed(first)
      }, fail)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  const goTo = useCallback(
    async (day: string) => {
      if (!userId) return
      wanted.current = day
      setAsOf(day)
      try {
        const s = await fetchState(userId, day)
        if (wanted.current !== day) return // a newer day was requested meanwhile
        setState(s)
        setError(null)
      } catch (e) {
        fail(e)
      }
    },
    [userId, fetchState],
  )

  // ---------------------------------------------------------------- playback

  useEffect(() => {
    if (!playing || !asOf || !range) return
    if (asOf >= range.end) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => void goTo(addDays(asOf, 1)), 520)
    return () => clearTimeout(t)
  }, [playing, asOf, range, goTo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return
      if (e.key === 'h' || e.key === 'H') setPanelHidden((v) => !v)
      if (!asOf || !range) return
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => (asOf >= range.end ? (void goTo(range.start), true) : !p))
      }
      if (e.key === 'ArrowRight' && asOf < range.end) void goTo(addDays(asOf, 1))
      if (e.key === 'ArrowLeft' && asOf > range.start) void goTo(addDays(asOf, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [asOf, range, goTo])

  // ---------------------------------------------------------------- actions

  const addSpend = async (amount: number, merchant: string, category: string) => {
    if (!userId || !asOf) return
    try {
      const tx = { transaction_id: `manual-${Date.now()}`, booking_date: asOf, amount: -amount, merchant, category, currency: 'EUR' }
      const s = await source.addTransactions(userId, [tx], asOf)
      for (const k of [...cache.current.keys()]) {
        const [, uid, day] = k.split('|')
        if (uid === userId && day >= asOf) cache.current.delete(k)
      }
      source.timeline(userId, range?.end).then((t) => setMoments(t.events), () => {})
      if (s) {
        cache.current.set(`${source.kind}|${userId}|${asOf}`, s)
        setState(s)
      }
    } catch (e) {
      fail(e)
    }
  }

  const startFromOptIn = async (difficulty: Difficulty, fundId: string) => {
    await seed(persona, { difficulty, fundId, startAtBeginning: true })
    setScreen('pond')
    setTierOverride(null)
    setHatching(true)
    setTimeout(() => setHatching(false), 1900)
  }

  return (
    <main className={`stage ${panelHidden ? 'stage--clean' : ''}`}>
      <aside className="intro">
        <p className="intro-mark">
          <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden>
            <circle cx="20" cy="20" r="20" fill="#00aeef" />
            <path d="M12 27c3 3 13 3 16-2 2-3 1-7-2-8-3-1-4 1-4 3 0 3-4 4-6 2m8-10c0-4-1-6-3-7" fill="none" stroke="#0b1b33" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Black Swan
        </p>
        <h2>Spend with intent. Keep your swan alive.</h2>
        <p>
          A daily spending limit learned from your own KBC transactions, shown as one number and one swan. What you don't spend grows
          into an investment.
        </p>
        <p className="intro-team">Tectonic Hackathon · KBC case · team Black Swans</p>
      </aside>

      <Phone screenKey={screen} solidStatusAfter={screen === 'optin' ? 230 : 500}>
        {screen === 'optin' ? (
          <OptInScreen busy={busy} onStart={startFromOptIn} />
        ) : state ? (
          <PondScreen state={state} tierOverride={tierOverride} investedOverride={investedPreview} hatching={hatching} />
        ) : (
          <div className="screen screen--loading">
            <p>{error ? 'No data yet' : 'Loading your swan…'}</p>
          </div>
        )}
      </Phone>

      <DemoPanel
        hidden={panelHidden}
        onToggleHidden={() => setPanelHidden((v) => !v)}
        sourceKind={sourceKind}
        onSourceKind={(k) => {
          cache.current.clear()
          setState(null)
          setSourceKind(k)
        }}
        apiUrl={apiUrl}
        onApiUrl={setApiUrl}
        apiOk={apiOk}
        personas={personas}
        persona={persona}
        onPersona={(p) => {
          setPersona(p)
          setTierOverride(null)
          void seed(p)
        }}
        range={range}
        asOf={asOf}
        onAsOf={(d) => {
          setPlaying(false)
          void goTo(d)
        }}
        playing={playing}
        onPlay={() => {
          if (!range || !asOf) return
          if (asOf >= range.end) void goTo(range.start)
          setPlaying((p) => !p)
        }}
        tierOverride={tierOverride}
        onTierOverride={setTierOverride}
        investedPreview={investedPreview}
        onInvestedPreview={setInvestedPreview}
        onAddSpend={addSpend}
        onShowOptIn={() => setScreen(screen === 'optin' ? 'pond' : 'optin')}
        screen={screen}
        busy={busy}
        error={error}
        state={state}
        moments={moments}
      />
    </main>
  )
}
