import { useId, type CSSProperties, type ReactNode } from 'react'
import type { Mood, Tier } from '../api/types'
import { useTween } from './Animated'
import { World } from './World'

// Sky and weather follow the swan's health: clear skies when you're on track, clouds and
// rain as health drops, a night storm when the swan has died. The landscape (World) grows
// with the money invested so far.

interface Weather {
  skyTop: string
  skyBottom: string
  sun: number
  moon: number
  clouds: number[]
  cloud: string
  rain: number
  dark: boolean
}

const WEATHER: Record<Tier, Weather> = {
  thriving: { skyTop: '#2aaef0', skyBottom: '#cfeeff', sun: 1, moon: 0, clouds: [0], cloud: '#ffffff', rain: 0, dark: false },
  healthy: { skyTop: '#4fb1e6', skyBottom: '#d9eff9', sun: 0.9, moon: 0, clouds: [0, 1], cloud: '#ffffff', rain: 0, dark: false },
  tired: { skyTop: '#86a9c1', skyBottom: '#dbe5ec', sun: 0.5, moon: 0, clouds: [0, 1, 2, 3], cloud: '#eef2f5', rain: 0, dark: false },
  sick: { skyTop: '#6b7b8a', skyBottom: '#b7c2cb', sun: 0, moon: 0, clouds: [0, 1, 2, 3, 4], cloud: '#a3adb7', rain: 1, dark: false },
  rotting: { skyTop: '#424c59', skyBottom: '#7a8490', sun: 0, moon: 0, clouds: [0, 1, 2, 3, 4, 5], cloud: '#6c7580', rain: 2, dark: true },
  dead: { skyTop: '#101826', skyBottom: '#2c374a', sun: 0, moon: 1, clouds: [1, 3, 4], cloud: '#2c3645', rain: 2, dark: true },
}

/** Landscape colours per health state: lush green, then muted, yellowing, brown, night. */
const LAND: Record<Tier, Record<string, string>> = {
  thriving: { hillFar: '#8fcf7c', meadowTop: '#6dbb5a', meadowBottom: '#4b9a42', leaf: '#46a14e', leafDark: '#2c7b3b', pine: '#2f8048', pineDark: '#1f5f36', trunk: '#7a5230', grass: '#3a8a3a', shore: '#dcc78e', reed: '#4a8a3e', pad: '#4fa24a' },
  healthy: { hillFar: '#97c987', meadowTop: '#74b563', meadowBottom: '#53944a', leaf: '#4a984a', leafDark: '#317538', pine: '#357b49', pineDark: '#245b37', trunk: '#7a5230', grass: '#428a40', shore: '#d4c18e', reed: '#4d863f', pad: '#549d4c' },
  tired: { hillFar: '#a8bf98', meadowTop: '#8aa874', meadowBottom: '#6a8a5a', leaf: '#6b8f55', leafDark: '#506f42', pine: '#4f7453', pineDark: '#3a5941', trunk: '#735236', grass: '#66854f', shore: '#c8b78e', reed: '#62804f', pad: '#6a8b58' },
  sick: { hillFar: '#aaab86', meadowTop: '#98995f', meadowBottom: '#787a4a', leaf: '#9d9a48', leafDark: '#7a7738', pine: '#6a7045', pineDark: '#4f5535', trunk: '#6d5438', grass: '#8a8848', shore: '#bba77e', reed: '#7c7a46', pad: '#7f7f48' },
  rotting: { hillFar: '#8b8161', meadowTop: '#7c6f4a', meadowBottom: '#5d5234', leaf: '#8f6a38', leafDark: '#6a4f2a', pine: '#5d5a3c', pineDark: '#45432c', trunk: '#5a4630', grass: '#76673a', shore: '#91805a', reed: '#6b603a', pad: '#6e5f36' },
  dead: { hillFar: '#333e4c', meadowTop: '#2a3440', meadowBottom: '#1b232d', leaf: '#3a4450', leafDark: '#2a323c', pine: '#2b3540', pineDark: '#1e2630', trunk: '#2e333b', grass: '#34404a', shore: '#4a5260', reed: '#34403c', pad: '#3b4236' },
}

// Ordered by when they appear: the first ones stay clear of the hero number on the left.
const CLOUDS = [
  { top: 30, left: 66, scale: 0.8, dur: 70 },
  { top: 42, left: 72, scale: 0.55, dur: 90 },
  { top: 22, left: 68, scale: 1.05, dur: 80 },
  { top: 3, left: 22, scale: 1.1, dur: 100 },
  { top: 36, left: 30, scale: 0.9, dur: 110 },
  { top: 8, left: 52, scale: 1.3, dur: 95 },
]

const RAIN = Array.from({ length: 48 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 53) % 100) / 100,
  dur: 0.55 + ((i * 29) % 30) / 100,
  heavy: i % 2 === 0,
}))

function Cloud({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 120 56" width="120" height="56" aria-hidden>
      <path
        d="M 22 50 C 8 50, 2 40, 8 31 C 13 23, 23 23, 27 26 C 29 13, 42 5, 55 9 C 64 2, 82 3, 88 16 C 101 13, 114 22, 112 35 C 118 44, 110 51, 100 50 Z"
        style={{ fill: color, transition: 'fill 1.2s ease' }}
      />
    </svg>
  )
}

interface PondProps {
  tier: Tier
  mood: Mood
  totalInvested: number
  hatching?: boolean
  children?: ReactNode // sky overlay (hero number)
  lakeLabel?: ReactNode
}

export function Pond({ tier, mood, totalInvested, hatching, children, lakeLabel }: PondProps) {
  const w = WEATHER[tier]
  const land = LAND[tier]
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  // The lake grows over a couple of seconds after a payday sweep, so new life pops in one by one.
  const invested = useTween(totalInvested, 2600)
  const vars = {
    '--sky-top': w.skyTop,
    '--sky-bottom': w.skyBottom,
    '--hill-far': land.hillFar,
    '--meadow-top': land.meadowTop,
    '--meadow-bottom': land.meadowBottom,
    '--leaf': land.leaf,
    '--leaf-dark': land.leafDark,
    '--pine': land.pine,
    '--pine-dark': land.pineDark,
    '--trunk': land.trunk,
    '--grass': land.grass,
    '--shore': land.shore,
    '--reed': land.reed,
    '--pad': land.pad,
  } as CSSProperties

  return (
    <div className={`pond pond--${tier} ${w.dark ? 'pond--dark' : ''}`} style={vars}>
      <div className="pond-sky" />

      <div className="pond-sun" style={{ opacity: w.sun, transform: `translateY(${(1 - w.sun) * 26}px)` }} aria-hidden>
        <svg viewBox="-60 -60 120 120">
          <g className="sun-rays" stroke="#ffe27a" strokeWidth={5} strokeLinecap="round">
            {Array.from({ length: 12 }, (_, i) => (
              <line key={i} x1={0} y1={-34} x2={0} y2={-46} transform={`rotate(${i * 30})`} />
            ))}
          </g>
          <circle r={26} fill="#ffd23f" />
          <circle r={26} fill={`url(#${uid}-glow)`} />
          <defs>
            <radialGradient id={`${uid}-glow`} cx="0.35" cy="0.35" r="0.7">
              <stop offset="0" stopColor="#fff6c2" />
              <stop offset="1" stopColor="#ffd23f" stopOpacity={0} />
            </radialGradient>
          </defs>
        </svg>
      </div>

      <div className="pond-moon" style={{ opacity: w.moon }} aria-hidden>
        <svg viewBox="0 0 60 60">
          <path d="M 40 8 A 24 24 0 1 0 52 42 A 19 19 0 1 1 40 8 Z" fill="#e8ecf2" />
        </svg>
        <i className="star" style={{ left: -70, top: 20 }} />
        <i className="star" style={{ left: -140, top: 6 }} />
        <i className="star" style={{ left: 40, top: 60 }} />
      </div>

      <div className="pond-clouds" aria-hidden>
        {CLOUDS.map((c, i) => (
          <div
            key={i}
            className="cloud"
            style={{
              top: `${c.top}%`,
              left: `${c.left}%`,
              opacity: w.clouds.includes(i) ? 1 : 0,
              ['--s' as string]: c.scale,
              animationDuration: `${c.dur}s`,
            }}
          >
            <Cloud color={w.cloud} />
          </div>
        ))}
      </div>

      <World tier={tier} mood={mood} invested={invested} hatching={hatching} />

      <div className={`pond-rain rain-${w.rain}`} aria-hidden>
        {RAIN.map((d, i) => (
          <i key={i} className={d.heavy ? 'heavy' : ''} style={{ left: `${d.left}%`, animationDelay: `-${d.delay}s`, animationDuration: `${d.dur}s` }} />
        ))}
      </div>
      {tier === 'dead' && <div className="pond-lightning" aria-hidden />}

      <div className="pond-overlay">{children}</div>
      {lakeLabel && <div className="pond-lake-label">{lakeLabel}</div>}
    </div>
  )
}
