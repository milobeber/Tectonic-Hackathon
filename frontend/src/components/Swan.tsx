import { useId } from 'react'
import type { Mood, Tier } from '../api/types'
import dead from '../assets/swan/dead.webp'
import rotting from '../assets/swan/rotting.webp'
import thriving from '../assets/swan/thriving.webp'
import tired from '../assets/swan/tired.webp'

// The team's black swan, from the illustrated sprite set in src/assets/swan.
// Frame: viewBox 0 0 330 240, facing left, waterline at y = 196 (same frame as <Egg>).

const WATER = 196
const SCALE = 0.432 // sprite pixels -> frame units, shared so all states keep the same size

type SpriteKey = 'thriving' | 'tired' | 'rotting' | 'dead'

interface Sprite {
  src: string
  w: number
  h: number
  sink: number // how far the body sits below the waterline, in frame units
  head: [number, number] // head centre in sprite pixels, for extras like the sweat drop
  body: [number, number] // body centre in sprite pixels, for flies
}

const SPRITES: Record<SpriteKey, Sprite> = {
  thriving: { src: thriving, w: 579, h: 617, sink: 8, head: [175, 130], body: [330, 470] },
  tired: { src: tired, w: 534, h: 539, sink: 8, head: [95, 110], body: [320, 430] },
  rotting: { src: rotting, w: 554, h: 544, sink: 10, head: [100, 110], body: [330, 340] },
  dead: { src: dead, w: 638, h: 344, sink: 14, head: [160, 280], body: [380, 160] },
}

/** Which sprite each health state uses. Healthy and sick reuse the nearest drawing for now. */
const SPRITE_FOR: Record<Tier, SpriteKey> = {
  thriving: 'thriving',
  healthy: 'thriving',
  tired: 'tired',
  sick: 'tired',
  rotting: 'rotting',
  dead: 'dead',
}

function place(s: Sprite) {
  const w = s.w * SCALE
  const h = s.h * SCALE
  const x = 168 - w / 2
  const y = WATER + s.sink - h
  return { x, y, w, h, at: (p: [number, number]): [number, number] => [x + p[0] * SCALE, y + p[1] * SCALE] }
}

interface SwanProps {
  tier: Tier
  mood: Mood
  className?: string
  /** Override the viewBox, e.g. to show the raised wings in full outside the lake scene. */
  frame?: string
}

export function Swan({ tier, mood, className, frame = '0 0 330 240' }: SwanProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const id = (s: string) => `${uid}-${s}`
  const active = SPRITE_FOR[tier]
  const cur = place(SPRITES[active])
  const head = cur.at(SPRITES[active].head)
  const body = cur.at(SPRITES[active].body)
  const worried = mood === 'worried' && (tier === 'thriving' || tier === 'healthy' || tier === 'tired')

  const images = (Object.keys(SPRITES) as SpriteKey[]).map((key) => {
    const s = SPRITES[key]
    const p = place(s)
    return (
      <image
        key={key}
        href={s.src}
        x={p.x}
        y={p.y}
        width={p.w}
        height={p.h}
        className={`swan-sprite ${key === active ? 'on' : ''} ${tier === 'sick' && key === active ? 'swan-sprite--sick' : ''}`}
        preserveAspectRatio="xMidYMid meet"
      />
    )
  })

  return (
    <svg className={`swan swan--${tier} ${className ?? ''}`} viewBox={frame} overflow="visible" role="img" aria-label={`Your swan looks ${tier}`}>
      <defs>
        <clipPath id={id('above')}>
          <rect x={-80} y={-120} width={490} height={WATER + 121} />
        </clipPath>
        <clipPath id={id('below')}>
          <rect x={-80} y={WATER + 1} width={490} height={120} />
        </clipPath>
        <filter id={id('blur')}>
          <feGaussianBlur stdDeviation={2} />
        </filter>
      </defs>

      <g className="swan-bob">
        <g clipPath={`url(#${id('above')})`}>{images}</g>
        <g clipPath={`url(#${id('below')})`} opacity={0.22} filter={`url(#${id('blur')})`}>
          <g transform={`translate(0 ${2 * WATER + 2}) scale(1 -1)`}>{images}</g>
        </g>
      </g>

      <g className="swan-water" fill="#0c0c1e">
        <path d="M 36 197 C 110 192.5, 230 192.5, 306 198 C 230 197.5, 110 197.5, 36 197 Z" opacity={0.5} />
        <path d="M 70 204 C 140 201, 220 201, 284 205 C 220 204.4, 140 204.4, 70 204 Z" opacity={0.28} />
        <path d="M 110 211 C 160 209, 210 209, 250 211.5 C 210 211, 160 211, 110 211 Z" opacity={0.16} />
      </g>

      <g className="swan-ripples" fill="none" stroke="#ffffff" strokeLinecap="round">
        <ellipse className="ripple r1" cx={168} cy={198} rx={116} ry={7} />
        <ellipse className="ripple r2" cx={168} cy={198} rx={116} ry={7} />
      </g>

      {tier === 'thriving' && (
        <g className="swan-sparkles" fill="#fff6c9">
          {[
            [262, 0],
            [300, 70],
            [head[0] - 34, head[1] - 30],
          ].map(([x, y], i) => (
            <path
              key={i}
              className={`sparkle s${i}`}
              style={{ transformOrigin: `${x}px ${y}px` }}
              d={`M ${x} ${y - 7} C ${x + 1} ${y - 2}, ${x + 2} ${y - 1}, ${x + 7} ${y} C ${x + 2} ${y + 1}, ${x + 1} ${y + 2}, ${x} ${y + 7} C ${x - 1} ${y + 2}, ${x - 2} ${y + 1}, ${x - 7} ${y} C ${x - 2} ${y - 1}, ${x - 1} ${y - 2}, ${x} ${y - 7} Z`}
            />
          ))}
        </g>
      )}

      {worried && (
        <path
          className="swan-sweat"
          transform={`translate(${head[0] + 22} ${head[1] - 28})`}
          d="M 0 -7 C 3.5 -1, 6 2.4, 3 5.2 C 0 7.6, -3.6 5.2, -2.4 1.8 C -1.6 -1, -0.5 -3.6, 0 -7 Z"
          fill="#8fd3f7"
        />
      )}

      {(tier === 'rotting' || tier === 'dead') && (
        <g transform={`translate(${body[0] - 170} ${body[1] - 130})`}>
          <g className="swan-stink" fill="none" stroke="#a3b35c" strokeWidth={2} strokeLinecap="round" opacity={tier === 'dead' ? 0.55 : 0.85}>
            <path className="stink k0" d="M 150 118 c -6 -6, 6 -10, 0 -16 c -6 -6, 6 -10, 0 -16" />
            <path className="stink k1" d="M 180 112 c -6 -6, 6 -10, 0 -16 c -6 -6, 6 -10, 0 -16" />
            <path className="stink k2" d="M 210 108 c -6 -6, 6 -10, 0 -16 c -6 -6, 6 -10, 0 -16" />
          </g>
          <g className="swan-flies">
            {[0, 1, 2].map((i) => (
              <g key={i} className={`fly f${i}`}>
                <ellipse cx={0} cy={0} rx={2.8} ry={2} fill="#0d0e11" />
                <ellipse className="wing" cx={-1.4} cy={-2.8} rx={2.6} ry={1.5} fill="#e8f0f6" opacity={0.85} />
                <ellipse className="wing" cx={1.8} cy={-2.8} rx={2.6} ry={1.5} fill="#e8f0f6" opacity={0.85} />
              </g>
            ))}
          </g>
        </g>
      )}
    </svg>
  )
}
