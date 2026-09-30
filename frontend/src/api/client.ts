// One interface, two implementations: the live Black Swan API and an in-browser mock.
// The UI only talks to `SwanSource`, so switching between them is a toggle.

import { mockSource } from '../mock/simulate'
import type { Enrollment, EnrollmentRequest, GameState, Persona, SeedResult, Timeline, Transaction } from './types'

export interface SeedOptions {
  persona: string
  userId?: string
  asOf?: string
  enrolledDaysAgo?: number
  seed?: number
}

export interface SwanSource {
  kind: 'live' | 'mock'
  health(): Promise<boolean>
  personas(): Promise<Persona[]>
  seed(opts: SeedOptions): Promise<SeedResult>
  enroll(userId: string, body: EnrollmentRequest): Promise<Enrollment>
  gameState(userId: string, asOf?: string): Promise<GameState>
  timeline(userId: string, asOf?: string): Promise<Timeline>
  addTransactions(userId: string, txs: Transaction[], asOf?: string): Promise<GameState | null>
}

export const DEFAULT_API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
// Anything in VITE_* ships in the browser bundle: only ever put the local demo key here.
export const DEFAULT_API_KEY = import.meta.env.VITE_API_KEY ?? 'dev-key'

/** Only http(s) URLs, so a crafted `?api=` link can't point the key at a `javascript:` or `data:` URL. */
export function safeApiUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href.replace(/\/$/, '') : null
  } catch {
    return null
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function liveSource(baseUrl = DEFAULT_API_URL, apiKey = DEFAULT_API_KEY): SwanSource {
  const root = safeApiUrl(baseUrl) ?? DEFAULT_API_URL

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(root + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const json = await res.json()
        detail = typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail)
      } catch {
        /* keep statusText */
      }
      throw new ApiError(res.status, `${method} ${path} failed (${res.status}): ${detail}`)
    }
    return (await res.json()) as T
  }

  const q = (asOf?: string) => (asOf ? `?as_of=${asOf}` : '')

  return {
    kind: 'live',
    async health() {
      try {
        const res = await fetch(root + '/health')
        return res.ok
      } catch {
        return false
      }
    },
    personas: () => call<Persona[]>('GET', '/v1/demo/personas'),
    seed: (o) =>
      call<SeedResult>('POST', '/v1/demo/seed', {
        persona: o.persona,
        user_id: o.userId,
        as_of: o.asOf,
        enrolled_days_ago: o.enrolledDaysAgo ?? 20,
        seed: o.seed ?? 42,
      }),
    enroll: (userId, body) => call<Enrollment>('PUT', `/v1/users/${encodeURIComponent(userId)}/enrollment`, body),
    gameState: (userId, asOf) => call<GameState>('GET', `/v1/users/${encodeURIComponent(userId)}/game-state${q(asOf)}`),
    timeline: (userId, asOf) => call<Timeline>('GET', `/v1/users/${encodeURIComponent(userId)}/timeline${q(asOf)}`),
    async addTransactions(userId, txs, asOf) {
      const res = await call<{ game_state: GameState | null }>(
        'POST',
        `/v1/users/${encodeURIComponent(userId)}/transactions${q(asOf)}`,
        { transactions: txs },
      )
      return res.game_state
    },
  }
}

export { mockSource }
