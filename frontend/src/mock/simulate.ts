// In-browser stand-in for the Black Swan API, so the demo works with no backend running.
// Ports the rules of backend/blackswan/{synthetic,model,engine}.py in simplified form:
// same personas, same buffer / limit-reduction / EWMA-health / monthly-sweep logic.

import type { SeedOptions, SwanSource } from '../api/client'
import type {
  DayRecord,
  Difficulty,
  Enrollment,
  Fund,
  GameEvent,
  GameState,
  Persona,
  Sweep,
  Tier,
  Transaction,
} from '../api/types'

// ------------------------------------------------------------------ config (mirrors config.py)

const SAVINGS_RATE: Record<Difficulty, number> = { easy: 0.05, normal: 0.1, hard: 0.2 }
const FIXED = new Set(['rent', 'utilities', 'insurance', 'loan', 'taxes', 'savings', 'transfer', 'salary'])
const GAME = {
  startHealth: 70,
  rebirthHealth: 50,
  alpha: 0.2,
  steepness: 2,
  uncoveredPenalty: 15,
  deathThreshold: 10,
  minLimitRatio: 0.6,
  bufferCushion: 0.5,
  minDailyLimit: 5,
}
const TIERS: [number, Tier][] = [
  [80, 'thriving'],
  [60, 'healthy'],
  [40, 'tired'],
  [20, 'sick'],
  [10, 'rotting'],
]
const MOOD = { thriving: 'happy', healthy: 'content', tired: 'worried', sick: 'sad', rotting: 'critical', dead: 'dead' } as const

export const FUNDS: Record<string, Fund> = {
  'kbc-sustainable-defensive': { id: 'kbc-sustainable-defensive', name: 'Sustainable Defensive (demo)', risk_class: 2, expected_annual_return: 0.025 },
  'kbc-sustainable-balanced': { id: 'kbc-sustainable-balanced', name: 'Sustainable Balanced (demo)', risk_class: 3, expected_annual_return: 0.04 },
  'kbc-sustainable-dynamic': { id: 'kbc-sustainable-dynamic', name: 'Sustainable Dynamic (demo)', risk_class: 4, expected_annual_return: 0.055 },
}

// ------------------------------------------------------------------ personas (mirrors synthetic.py)

interface PersonaSpec extends Persona {
  dailyMean: number
  gameMultiplier: number
  weekendBoost: number
  zeroDayProb: number
  spikeProb: number
  bigPurchase?: [number, number, string, string]
}

const PERSONAS: PersonaSpec[] = [
  { key: 'steady_saver', description: 'Spends a bit less than usual once the game starts. Healthy, happy swan.', dailyMean: 28, gameMultiplier: 0.8, weekendBoost: 1.3, zeroDayProb: 0.15, spikeProb: 0 },
  { key: 'weekend_splurger', description: 'Quiet weekdays, big weekends. The model learns weekend limits are higher.', dailyMean: 30, gameMultiplier: 0.95, weekendBoost: 2.2, zeroDayProb: 0.15, spikeProb: 0 },
  { key: 'impulse_spender', description: 'Regularly overspends after enrolling. Swan gets sick and eventually dies.', dailyMean: 32, gameMultiplier: 1.5, weekendBoost: 1.3, zeroDayProb: 0.15, spikeProb: 0.15 },
  { key: 'big_purchase', description: 'Disciplined, but buys a EUR 899 laptop mid-month. Buffer absorbs part, limits drop.', dailyMean: 28, gameMultiplier: 0.9, weekendBoost: 1.3, zeroDayProb: 0.15, spikeProb: 0, bigPurchase: [8, 899, 'MediaMarkt', 'electronics'] },
]

const SHOPS: [string, string[], number][] = [
  ['groceries', ['Delhaize', 'Colruyt', 'Aldi', 'Carrefour Express'], 0.45],
  ['restaurants', ['Exki', 'Panos', 'Quick', 'Cafe De Markt'], 0.25],
  ['transport', ['NMBS', 'De Lijn', 'Q8'], 0.15],
  ['shopping', ['Zara', 'Bol.com', 'Action', 'Kruidvat'], 0.15],
]
const MONTHLY: [number, number, string, string][] = [
  [1, 850, 'Landlord BV', 'rent'],
  [3, 29, 'Basic-Fit', 'sport'],
  [5, 95, 'Engie', 'utilities'],
  [8, 20, 'Proximus', 'telecom'],
  [12, 13.99, 'Netflix', 'entertainment'],
  [20, 11.99, 'Spotify', 'entertainment'],
]
const RECURRING = new Set(MONTHLY.map((m) => m[2]))

// ------------------------------------------------------------------ dates & randomness

const DAY = 86_400_000
export const toDate = (iso: string) => new Date(iso + 'T00:00:00Z')
export const iso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (isoDate: string, n: number) => iso(new Date(toDate(isoDate).getTime() + n * DAY))
const diffDays = (a: string, b: string) => Math.round((toDate(a).getTime() - toDate(b).getTime()) / DAY)
const weekday = (isoDate: string) => (toDate(isoDate).getUTCDay() + 6) % 7 // Monday = 0
const monthEnd = (isoDate: string) => {
  const d = toDate(isoDate)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
}
const dom = (isoDate: string) => toDate(isoDate).getUTCDate()
const money = (x: number) => Math.round(x * 100) / 100 + 0

function rngFrom(seed: string) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const gauss = () => Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next())
  return {
    next,
    lognorm: (sigma: number) => Math.exp(sigma * gauss()),
    pick: <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)],
    uniform: (lo: number, hi: number) => lo + (hi - lo) * next(),
  }
}

// ------------------------------------------------------------------ transaction generator

function generate(p: PersonaSpec, userId: string, end: string, enrolledOn: string, seed: number): Transaction[] {
  const r = rngFrom(`${seed}-${p.key}-${userId}`)
  const start = addDays(enrolledOn, -90)
  const oneOff = addDays(start, 45)
  const txs: Transaction[] = []
  let n = 0
  const add = (day: string, amount: number, merchant: string, category: string) =>
    txs.push({ transaction_id: `${userId}-${day}-${String(++n).padStart(4, '0')}`, booking_date: day, amount: money(amount), merchant, category })

  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (dom(day) === 25) add(day, 2600, 'Employer NV', 'salary')
    for (const [d, amount, merchant, category] of MONTHLY) if (dom(day) === d) add(day, -amount, merchant, category)
    const inGame = day >= enrolledOn
    if (r.next() > p.zeroDayProb) {
      const weekend = weekday(day) >= 5
      const factor = weekend ? p.weekendBoost : (7 - 2 * p.weekendBoost) / 5
      const mult = inGame ? p.gameMultiplier : 1
      const total = ((p.dailyMean * factor * mult) / (1 - p.zeroDayProb)) * r.lognorm(0.35)
      const splits = Array.from({ length: r.pick([1, 1, 2, 2, 3]) }, () => r.next() + 0.2)
      const sum = splits.reduce((a, b) => a + b, 0)
      for (const share of splits) {
        const roll = r.next()
        let acc = 0
        const shop = SHOPS.find((s) => (acc += s[2]) >= roll) ?? SHOPS[0]
        add(day, (-total * share) / sum, r.pick(shop[1]), shop[0])
      }
    }
    if (inGame && p.spikeProb && r.next() < p.spikeProb) add(day, -r.uniform(45, 90), r.pick(['Zalando', 'Fnac', 'Uber Eats']), 'shopping')
    if (day === oneOff) add(day, -349, 'IKEA', 'home')
    if (p.bigPurchase && day === addDays(enrolledOn, p.bigPurchase[0])) add(day, -p.bigPurchase[1], p.bigPurchase[2], p.bigPurchase[3])
  }
  return txs
}

// ------------------------------------------------------------------ spending model (mirrors model.py)

interface Profile {
  target: number
  baseline: number
  weekday: number[]
  largeThreshold: number
  historyDays: number
  savingsRate: number
}

const isDiscretionaryCandidate = (t: Transaction) =>
  t.amount < 0 && !FIXED.has(t.category ?? '') && !RECURRING.has(t.merchant ?? '')

function quantile(xs: number[], q: number) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo)
}

function buildProfile(txs: Transaction[], before: string, savingsRate: number): Profile {
  const from = addDays(before, -90)
  const window = txs.filter((t) => t.booking_date >= from && t.booking_date < before && isDiscretionaryCandidate(t))
  const amounts = window.map((t) => -t.amount)
  const histLarge = Math.max(100, quantile(amounts, 0.95) * 1.5)
  const daily = new Map<string, number>()
  for (let d = from; d < before; d = addDays(d, 1)) daily.set(d, 0)
  for (const t of window) if (-t.amount < histLarge) daily.set(t.booking_date, (daily.get(t.booking_date) ?? 0) - t.amount)
  const values = [...daily.values()]
  const cap = quantile(values, 0.95)
  const wins = values.map((v) => Math.min(v, cap))
  const baseline = wins.reduce((a, b) => a + b, 0) / Math.max(wins.length, 1)
  const perDay: number[][] = [[], [], [], [], [], [], []]
  ;[...daily.entries()].forEach(([d, v]) => perDay[weekday(d)].push(Math.min(v, cap)))
  const weekdayFactors = perDay.map((vs) => {
    const ratio = vs.length && baseline ? vs.reduce((a, b) => a + b, 0) / vs.length / baseline : 1
    return Math.min(1.8, Math.max(0.5, 1 + 0.6 * (ratio - 1)))
  })
  const target = Math.max(baseline * (1 - savingsRate), GAME.minDailyLimit)
  return { target, baseline, weekday: weekdayFactors, largeThreshold: Math.max(histLarge, 3 * target), historyDays: 90, savingsRate }
}

// ------------------------------------------------------------------ engine (mirrors engine.py)

function simulate(userId: string, e: Enrollment, txs: Transaction[], asOf: string): GameState {
  const swan = { health: GAME.startHealth, alive: true, generation: 1, streak: 0 }
  const events: GameEvent[] = []
  const sweeps: Sweep[] = []
  const byDay = new Map<string, Transaction[]>()
  for (const t of txs) if (t.booking_date >= e.enrolled_on) byDay.set(t.booking_date, [...(byDay.get(t.booking_date) ?? []), t])

  const ev = (date: string, type: GameEvent['type'], message: string, amount: number | null = null, delta: number | null = null) =>
    events.push({ date, type, message, amount: amount === null ? null : money(amount), health_delta: delta === null ? null : Math.round(delta * 10) / 10 })

  const setHealth = (day: string, h: number) => {
    if (!swan.alive) return 0
    const old = swan.health
    swan.health = Math.min(Math.max(h, 0), 100)
    if (swan.health < GAME.deathThreshold) {
      swan.health = 0
      swan.alive = false
      ev(day, 'swan_died', 'Your swan did not make it this month. A new egg hatches next month.')
    }
    return swan.health - old
  }

  // Learned once from pre-enrollment behaviour (re-learning each month would ratchet the limit).
  const profile = buildProfile(txs, e.enrolled_on, SAVINGS_RATE[e.difficulty])
  let start = e.enrolled_on
  for (;;) {
    const end = monthEnd(start)
    // One signed balance: >= 0 is the buffer, < 0 is debt (only large expenses create debt).
    const m = { balance: 0, daysUnder: 0, daysOver: 0, large: 0, records: [] as DayRecord[], today: null as GameState['today'] | null }
    const buffer = () => Math.max(m.balance, 0)
    const debt = () => Math.max(-m.balance, 0)

    const moveBalance = (day: string, delta: number) => {
      const wasInDebt = debt() > 0
      m.balance += delta
      if (debt() > 0 && !wasInDebt) {
        const after = diffDays(end, day)
        const perDay = after ? debt() / after : 0
        ev(day, 'limit_reduced', `Buffer empty: EUR ${debt().toFixed(2)} to earn back, daily limit about EUR ${perDay.toFixed(2)} lower.`, debt())
      } else if (wasInDebt && debt() === 0) ev(day, 'limit_restored', 'Debt earned back. Your full daily limit is back.')
    }

    const record = (day: string, limit: number, spent: number, large: number, status: DayRecord['status']) =>
      m.records.push({ date: day, limit: money(limit), spent: money(spent), large_expenses: money(large), buffer: money(buffer()), health: Math.round(swan.health * 10) / 10, status })

    for (let day = start; day <= end && day <= asOf; day = addDays(day, 1)) {
      let spent = 0
      let large = 0
      for (const t of byDay.get(day) ?? []) {
        if (!isDiscretionaryCandidate(t)) continue
        const amount = -t.amount
        if (amount >= profile.largeThreshold) {
          large += amount
          const what = t.merchant ?? 'Large expense'
          const covered = Math.min(amount, buffer())
          moveBalance(day, -amount)
          if (covered === amount) ev(day, 'large_expense_absorbed', `${what}: EUR ${amount.toFixed(2)} covered by your buffer.`, amount)
          else {
            const delta = setHealth(day, swan.health - GAME.uncoveredPenalty)
            ev(day, 'large_expense_uncovered', `${what}: EUR ${amount.toFixed(2)}, buffer could only cover EUR ${covered.toFixed(2)}.`, amount, delta)
          }
        } else spent += amount
      }
      const base = profile.target * profile.weekday[weekday(day)]
      const reduction = Math.min(debt() / (diffDays(end, day) + 1), base * (1 - GAME.minLimitRatio))
      const limit = Math.max(base - reduction, GAME.minDailyLimit)
      m.large += large

      if (day === asOf) {
        m.today = {
          date: day,
          base_limit: money(base),
          limit_reduction: money(Math.max(base - limit, 0)),
          limit: money(limit),
          spent: money(spent),
          remaining: money(Math.max(limit - spent, 0)),
          large_expenses: money(large),
          status: spent > limit ? 'over' : spent >= 0.8 * limit ? 'at_risk' : 'on_track',
        }
        record(day, limit, spent, large, 'today')
        break
      }

      const bufferBefore = buffer()
      let delta = base - spent
      if (delta < 0) delta = Math.max(delta, -buffer()) // everyday overspending never creates debt
      moveBalance(day, delta)
      const over = spent - limit
      let score = 1
      if (over <= 0) {
        m.daysUnder++
        swan.streak++
      } else {
        m.daysOver++
        swan.streak = 0
        const effective = over - GAME.bufferCushion * Math.min(over, bufferBefore)
        score = Math.max(0, 1 - (GAME.steepness * effective) / limit)
      }
      const hd = setHealth(day, swan.health + GAME.alpha * (100 * score - swan.health))
      if (over <= 0) ev(day, 'day_under', `Within your limit with EUR ${(-over).toFixed(2)} to spare.`, -over, hd)
      else ev(day, 'day_over', `EUR ${over.toFixed(2)} over your limit.`, over, hd)
      record(day, limit, spent, large, over <= 0 ? 'under' : 'over')
    }

    if (asOf <= end) {
      const tier: Tier = !swan.alive ? 'dead' : (TIERS.find(([lo]) => swan.health >= lo)?.[1] ?? 'rotting')
      let mood: GameState['swan']['mood'] = MOOD[tier]
      if (m.today!.status === 'over' && (mood === 'happy' || mood === 'content')) mood = 'worried'
      const fund = FUNDS[e.fund_id] ?? FUNDS['kbc-sustainable-balanced']
      const total = sweeps.reduce((a, s) => a + s.amount, 0)
      const cutoff = addDays(start.slice(0, 8) + '01', -1).slice(0, 8) + '01'
      return {
        user_id: userId,
        as_of: asOf,
        swan: { health: Math.round(swan.health * 10) / 10, tier, mood, alive: swan.alive, generation: swan.generation, streak_days: swan.streak },
        today: m.today!,
        month: {
          month: start.slice(0, 7),
          cycle_type: 'calendar',
          start,
          end,
          days_left: diffDays(end, asOf),
          buffer: money(buffer()),
          limit_reduction_per_day: money(m.today!.limit_reduction),
          debt: money(debt()),
          days_under: m.daysUnder,
          days_over: m.daysOver,
          large_expenses_total: money(m.large),
        },
        rewards: {
          fund,
          total_invested: money(total),
          sweeps,
          estimated_annual_passive_income: money(total * fund.expected_annual_return),
          disclaimer: 'Illustrative estimate based on an assumed return. Not investment advice.',
        },
        history: m.records,
        events: events.filter((x) => x.date >= cutoff).reverse().slice(0, 50),
        model: {
          version: 'mock-v1',
          confidence: 'high',
          history_days: profile.historyDays,
          baseline_daily: money(profile.baseline),
          savings_rate: profile.savingsRate,
          target_daily: money(profile.target),
          weekday_factors: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d, i) => [d, Math.round(profile.weekday[i] * 1000) / 1000])),
          large_expense_threshold: money(profile.largeThreshold),
          recurring_merchants: [...RECURRING].map((x) => x.toLowerCase()),
          monthly_income: 2600,
          monthly_fixed_costs: 1019.98,
        },
      }
    }

    // close month
    if (buffer() > 0) {
      sweeps.push({ month: end.slice(0, 7), amount: money(buffer()), fund_id: e.fund_id })
      ev(end, 'month_swept', `EUR ${buffer().toFixed(2)} invested in your fund.`, buffer())
    }
    if (!swan.alive) {
      Object.assign(swan, { health: GAME.rebirthHealth, alive: true, generation: swan.generation + 1, streak: 0 })
      ev(addDays(end, 1), 'swan_reborn', 'A new cygnet hatched. Fresh start!')
    }
    start = addDays(end, 1)
  }
}

// ------------------------------------------------------------------ SwanSource implementation

interface MockUser {
  enrollment: Enrollment
  txs: Transaction[]
  end: string
}

const users = new Map<string, MockUser>()

export const todayIso = () => iso(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000))

function mustGet(userId: string) {
  const u = users.get(userId)
  if (!u) throw new Error('User is not enrolled')
  return u
}

export const mockSource: SwanSource = {
  kind: 'mock',
  health: async () => true,
  personas: async () => PERSONAS.map(({ key, description }) => ({ key, description })),
  async seed(o: SeedOptions) {
    const p = PERSONAS.find((x) => x.key === o.persona) ?? PERSONAS[0]
    const userId = o.userId ?? `demo-${p.key}`
    const end = o.asOf ?? todayIso()
    const enrolledOn = addDays(end, -(o.enrolledDaysAgo ?? 20))
    const enrollment: Enrollment = { user_id: userId, difficulty: 'normal', fund_id: 'kbc-sustainable-balanced', enrolled_on: enrolledOn }
    const txs = generate(p, userId, end, enrolledOn, o.seed ?? 42)
    users.set(userId, { enrollment, txs, end })
    return { user_id: userId, persona: p.key, enrollment, transactions: txs.length, game_state: simulate(userId, enrollment, txs, end) }
  },
  async enroll(userId, body) {
    const u = mustGet(userId)
    u.enrollment = { ...u.enrollment, difficulty: body.difficulty, fund_id: body.fund_id, enrolled_on: body.enrolled_on ?? u.enrollment.enrolled_on }
    return u.enrollment
  },
  async gameState(userId, asOf) {
    const u = mustGet(userId)
    return simulate(userId, u.enrollment, u.txs, asOf ?? u.end)
  },
  async timeline(userId, asOf) {
    // Approximation of the API's /timeline: notable events from the end state, oldest first.
    const u = mustGet(userId)
    const s = simulate(userId, u.enrollment, u.txs, asOf ?? u.end)
    const daily = new Set(['day_under', 'day_over'])
    return { user_id: userId, as_of: s.as_of, cycles: [], days: s.history, events: s.events.filter((e) => !daily.has(e.type)).reverse() }
  },
  async addTransactions(userId, txs, asOf) {
    const u = mustGet(userId)
    const seen = new Set(u.txs.map((t) => t.transaction_id))
    u.txs.push(...txs.filter((t) => !seen.has(t.transaction_id)))
    return simulate(userId, u.enrollment, u.txs, asOf ?? u.end)
  },
}
