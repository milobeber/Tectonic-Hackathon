// Mirror of backend/blackswan/schemas.py. Keep field names in sync with the API.

export type Difficulty = 'easy' | 'normal' | 'hard'
export type Tier = 'thriving' | 'healthy' | 'tired' | 'sick' | 'rotting' | 'dead'
export type Mood = 'happy' | 'content' | 'worried' | 'sad' | 'critical' | 'dead'
export type DayStatus = 'under' | 'over' | 'today'
export type TodayStatus = 'on_track' | 'at_risk' | 'over'
export type EventType =
  | 'day_under'
  | 'day_over'
  | 'large_expense_absorbed'
  | 'large_expense_uncovered'
  | 'large_expense_unaffordable'
  | 'limit_reduced'
  | 'limit_restored'
  | 'swan_died'
  | 'swan_reborn'
  | 'month_swept'

export interface Transaction {
  transaction_id: string
  booking_date: string
  amount: number
  currency?: string
  merchant?: string | null
  category?: string | null
  description?: string | null
}

export interface EnrollmentRequest {
  difficulty: Difficulty
  fund_id: string
  enrolled_on?: string | null
}

export interface Enrollment {
  user_id: string
  difficulty: Difficulty
  fund_id: string
  enrolled_on: string
}

export interface Fund {
  id: string
  name: string
  risk_class: number
  expected_annual_return: number
}

export interface SpendingProfile {
  version: string
  confidence: 'low' | 'medium' | 'high'
  history_days: number
  baseline_daily: number
  savings_rate: number
  target_daily: number
  weekday_factors: Record<string, number>
  large_expense_threshold: number
  recurring_merchants: string[]
  monthly_income: number
  monthly_fixed_costs: number
  wage?: { payer: string; amount: number; day_of_month: number } | null
  affordable_daily?: number | null
  spend_by_category?: Record<string, number>
  ignored_one_offs_total?: number
}

export interface SwanState {
  health: number
  tier: Tier
  mood: Mood
  alive: boolean
  generation: number
  streak_days: number
}

export interface TodayState {
  date: string
  base_limit: number
  limit_reduction: number
  limit: number
  spent: number
  remaining: number
  large_expenses: number
  status: TodayStatus
}

/** The current game cycle: payday to payday if a wage was detected, else the calendar month. */
export interface MonthState {
  month: string
  cycle_type?: 'wage' | 'calendar'
  start: string
  end: string
  days_left: number
  buffer: number
  limit_reduction_per_day: number
  debt: number
  days_under: number
  days_over: number
  large_expenses_total: number
  income?: number
  spent_total?: number
  projected_end_balance?: number
}

export interface DayRecord {
  date: string
  limit: number
  spent: number
  large_expenses: number
  buffer: number
  health: number
  status: DayStatus
}

export interface GameEvent {
  date: string
  type: EventType
  amount: number | null
  health_delta: number | null
  message: string
}

export interface Sweep {
  month: string
  amount: number
  fund_id: string
  cycle_start?: string | null
  cycle_end?: string | null
}

export interface Rewards {
  fund: Fund
  total_invested: number
  sweeps: Sweep[]
  estimated_annual_passive_income: number
  disclaimer: string
}

export interface GameState {
  user_id: string
  as_of: string
  swan: SwanState
  today: TodayState
  month: MonthState
  rewards: Rewards
  history: DayRecord[]
  events: GameEvent[]
  model: SpendingProfile
}

export interface Persona {
  key: string
  description: string
  kind?: 'case' | 'persona'
  name?: string
  tagline?: string
  verdict?: 'good' | 'bad'
  enrolled_on?: string
}

export interface CycleSummary {
  start: string
  end: string
  planned_end: string
  cycle_type: 'wage' | 'calendar'
  closed: boolean
  days_under: number
  days_over: number
  large_expenses_total: number
  swept: number
  swan_generation: number
  swan_died: boolean
}

/** Every day since enrollment, across cycles. Events are notable ones, oldest first. */
export interface Timeline {
  user_id: string
  as_of: string
  cycles: CycleSummary[]
  days: DayRecord[]
  events: GameEvent[]
}

export interface SeedResult {
  user_id: string
  persona: string
  enrollment: Enrollment
  transactions: number
  game_state: GameState
}
