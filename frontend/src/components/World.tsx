import { useId, type CSSProperties, type ReactNode } from 'react'
import type { Mood, Tier } from '../api/types'
import { catmullRom, clamp01, lerp, mixColor, smooth, type Pt } from './geometry'
import { Egg } from './Egg'
import { Swan } from './Swan'

// The world around the swan. Two drivers:
//  - money invested so far (the long-term track record) grows the lake and brings life:
//    a muddy puddle becomes a pond, reeds and lily pads appear, then a forest with animals;
//  - swan health (this cycle) sets the vitality: flowers wilt and animals hide when it drops.
// Scene coordinates: viewBox 0 0 390 540, lake centre at (195, 432).

const CX = 195
const CY = 432

/** Euros invested needed before each part of the ecosystem shows up. */
export const STAGES = {
  flowers: 20,
  reeds: 60,
  lilies: 60,
  bushes: 120,
  saplings: 120,
  butterflies: 120,
  frog: 150,
  forest: 200,
  birds: 200,
  rabbits: 260,
  foxes: 300,
  deer: 500,
  dragonflies: 700,
  heron: 900,
  rainbow: 1200,
} as const

const VITALITY: Record<Tier, number> = { thriving: 1, healthy: 0.9, tired: 0.7, sick: 0.4, rotting: 0.15, dead: 0 }

const WATER: Record<Tier, [string, string]> = {
  thriving: ['#2bb3ec', '#0a64a6'],
  healthy: ['#36a6dd', '#0d5f98'],
  tired: ['#5591b5', '#215b80'],
  sick: ['#5b8b89', '#2d5657'],
  rotting: ['#63704a', '#36402a'],
  dead: ['#2e3c4b', '#151e28'],
}
const MUD: [string, string] = ['#a38f64', '#6e5f44']

/** 0 = puddle, 1 = full lake (€1,500). Half log, half square root: the first paydays show, and it keeps growing. */
export function lakeSize(invested: number) {
  const x = Math.max(0, invested)
  return clamp01(0.5 * (Math.log10(1 + x) / Math.log10(1 + 1500)) + 0.5 * Math.sqrt(x / 1500))
}

function shape(s: number) {
  const rx = lerp(70, 214, s)
  const ry = lerp(20, 82, s)
  const wobble = lerp(1.7, 1, smooth(0, 0.5, s))
  const r = (t: number) => 1 + wobble * (0.06 * Math.sin(2 * t + 0.5) + 0.045 * Math.sin(3 * t + 1.7) + 0.03 * Math.sin(5 * t + 0.3))
  const at = (deg: number, k = 1): Pt => {
    const t = (deg * Math.PI) / 180
    return [CX + rx * k * r(t) * Math.cos(t), CY + ry * k * r(t) * Math.sin(t)]
  }
  const outline = (k: number, dy = 0) =>
    catmullRom(Array.from({ length: 20 }, (_, i) => at(i * 18, k)).map(([x, y]) => [x, y + dy] as Pt))
  return { rx, ry, at, outline }
}

const farHillY = (x: number) => 290 + 9 * Math.sin(x / 55 + 1) + 5 * Math.sin(x / 23)
const meadowY = (x: number) => 318 + 6 * Math.sin(x / 70 + 2)
const bandPath = (fn: (x: number) => number, bottom: number) =>
  `${catmullRom(Array.from({ length: 14 }, (_, i) => [i * 30, fn(i * 30)] as Pt), false)} L 390 ${bottom} L 0 ${bottom} Z`

type TreeKind = 'pine' | 'round'
interface TreeSpec {
  x: number
  h: number
  kind: TreeKind
  at: number
  full: number
  back?: boolean
}
const TREES: TreeSpec[] = [
  // saplings first, they grow into the forest
  { x: 44, h: 44, kind: 'round', at: STAGES.saplings, full: STAGES.forest },
  { x: 334, h: 48, kind: 'pine', at: STAGES.saplings, full: STAGES.forest },
  { x: 250, h: 40, kind: 'round', at: STAGES.saplings, full: STAGES.forest },
  ...[8, 26, 70, 98, 128, 158, 190, 218, 276, 300, 356, 378].map((x, i) => ({
    x,
    h: 34 + ((i * 7) % 14),
    kind: (i % 3 === 1 ? 'round' : 'pine') as TreeKind,
    at: STAGES.forest,
    full: STAGES.forest + 60,
  })),
  ...[16, 48, 84, 114, 144, 174, 206, 236, 264, 290, 318, 346, 370].map((x, i) => ({
    x,
    h: 24 + ((i * 5) % 9),
    kind: (i % 2 ? 'round' : 'pine') as TreeKind,
    at: 400,
    full: 600,
    back: true,
  })),
]

function Appear({ on, delay = 0, children, className = '' }: { on: boolean; delay?: number; children: ReactNode; className?: string }) {
  return (
    <g className={`appear ${on ? 'on' : ''} ${className}`} style={{ transitionDelay: on ? `${delay}ms` : '0ms' }}>
      {children}
    </g>
  )
}

function Tree({ kind, h }: { kind: TreeKind; h: number }) {
  if (kind === 'pine') {
    const w = h * 0.42
    return (
      <g>
        <rect x={-1.6} y={-h * 0.18} width={3.2} height={h * 0.2} className="w-trunk" />
        {[0, 1, 2].map((i) => {
          const top = -h + i * h * 0.24
          const bot = -h * 0.14 - (2 - i) * h * 0.14
          const ww = w * (0.55 + i * 0.22)
          return (
            <g key={i}>
              <path d={`M 0 ${top} L ${-ww} ${bot} L 0 ${bot} Z`} className="w-pine" />
              <path d={`M 0 ${top} L ${ww} ${bot} L 0 ${bot} Z`} className="w-pine-dark" />
            </g>
          )
        })}
      </g>
    )
  }
  const r = h * 0.3
  return (
    <g>
      <rect x={-1.8} y={-h * 0.42} width={3.6} height={h * 0.44} className="w-trunk" />
      <circle cx={-r * 0.5} cy={-h * 0.55} r={r * 0.85} className="w-leaf" />
      <circle cx={r * 0.55} cy={-h * 0.52} r={r * 0.8} className="w-leaf-dark" />
      <circle cx={0} cy={-h * 0.75} r={r} className="w-leaf" />
      <circle cx={r * 0.35} cy={-h * 0.72} r={r * 0.62} className="w-leaf-dark" opacity={0.55} />
    </g>
  )
}

function Tuft() {
  return <path d="M -4 0 Q -5 -5 -8 -8 M 0 0 Q 0 -7 1.5 -11 M 4 0 Q 5 -5 8 -7" className="w-tuft" />
}

function Reeds({ scale }: { scale: number }) {
  return (
    <g transform={`scale(${scale.toFixed(2)})`}>
      <path d="M -6 0 C -6 -14, -8 -26, -5 -40 M 0 0 C 0 -16, 2 -30, 0 -46 M 6 0 C 6 -12, 7 -22, 10 -34" className="w-reed" />
      <path d="M -2 0 C -8 -10, -14 -14, -18 -16 M 3 0 C 9 -8, 15 -11, 20 -12" className="w-reed" />
      <rect x={-7.2} y={-40} width={4.4} height={12} rx={2.2} className="w-cattail" />
      <rect x={-2.2} y={-46} width={4.4} height={13} rx={2.2} className="w-cattail" />
      <rect x={8} y={-34} width={4} height={10} rx={2} className="w-cattail" />
    </g>
  )
}

function Bush({ r }: { r: number }) {
  return (
    <g>
      <circle cx={-r * 0.7} cy={-r * 0.55} r={r * 0.7} className="w-leaf-dark" />
      <circle cx={r * 0.7} cy={-r * 0.5} r={r * 0.65} className="w-leaf-dark" />
      <circle cx={0} cy={-r * 0.8} r={r * 0.85} className="w-leaf" />
    </g>
  )
}

const FLOWER_COLORS = ['#ffffff', '#ffd24a', '#ff9ec4', '#c7b3ff']
function Flower({ c }: { c: string }) {
  return (
    <g>
      <path d="M 0 0 L 0 -5" stroke="currentColor" className="w-stem" />
      {[0, 72, 144, 216, 288].map((a) => (
        <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 2} cy={-6 + Math.sin((a * Math.PI) / 180) * 2} r={1.6} fill={c} />
      ))}
      <circle cx={0} cy={-6} r={1.2} fill="#f5a524" />
    </g>
  )
}

function LilyPad({ flower }: { flower: boolean }) {
  return (
    <g>
      <path d="M 0 0 L 11 -3 C 13 3, 7 7, 0 7 C -9 7, -13 3, -12 -1 C -10 -6, 6 -7, 11 -3 Z" className="w-pad" />
      <path d="M 0 0 L -8 2 M 0 0 L -3 5 M 0 0 L 5 4" stroke="rgba(255,255,255,.25)" strokeWidth={0.8} />
      {flower && (
        <g transform="translate(-2 -1)">
          <path d="M 0 0 C -3 -6, 0 -8, 1 -4 C 2 -8, 6 -6, 3 0 C 6 -2, 8 1, 3 2 L -2 2 C -7 1, -5 -2, 0 0 Z" fill="#ffb3c7" />
          <circle cx={1} cy={0} r={1.3} fill="#ffd766" />
        </g>
      )}
    </g>
  )
}

function Frog() {
  return (
    <g>
      <ellipse cx={0} cy={-3} rx={5} ry={3.4} fill="#6fbf4a" />
      <circle cx={-2.4} cy={-6} r={1.8} fill="#6fbf4a" />
      <circle cx={2.4} cy={-6} r={1.8} fill="#6fbf4a" />
      <circle cx={-2.4} cy={-6.3} r={0.8} fill="#111" />
      <circle cx={2.4} cy={-6.3} r={0.8} fill="#111" />
      <path d="M -2 -2 Q 0 -0.8 2 -2" stroke="#2e6b22" strokeWidth={0.7} fill="none" />
    </g>
  )
}

function Fox({ flip = false }: { flip?: boolean }) {
  return (
    <g transform={flip ? 'scale(-1 1)' : undefined}>
      <path d="M -10 -9 C -22 -17, -31 -5, -21 -1 C -16 0.5, -12 -3, -10 -6 Z" fill="#e27a33" />
      <path d="M -25 -7.5 C -28 -5, -26 -1.6, -21 -1.2 C -23.5 -3, -24 -5.2, -25 -7.5 Z" fill="#fff5ea" />
      <path d="M -7 -5 L -7.5 0 M -3 -5 L -3 0 M 4 -5 L 4.5 0 M 7.5 -6 L 8 0" stroke="#3a2518" strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={0} cy={-9} rx={11} ry={5.5} fill="#e27a33" />
      <path d="M 3 -5 C 6 -4, 9 -6, 10 -9 L 6 -9 Z" fill="#fff5ea" />
      <circle cx={9} cy={-12} r={4.6} fill="#e27a33" />
      <path d="M 7 -14 L 19.5 -10.8 L 9 -7.6 Z" fill="#e27a33" />
      <path d="M 10.5 -9.6 L 18.6 -10.6 L 11 -7.8 Z" fill="#fff5ea" />
      <path d="M 6 -15 L 6.5 -21 L 10 -16 Z M 9.5 -16 L 12 -21.5 L 13 -15 Z" fill="#c55f22" />
      <circle cx={19.6} cy={-10.8} r={1.1} fill="#1a1a1a" />
      <circle cx={10.8} cy={-12.6} r={0.95} fill="#1a1a1a" />
    </g>
  )
}

function Rabbit() {
  return (
    <g>
      <ellipse cx={0} cy={-4.5} rx={6} ry={4.4} fill="#c9b196" />
      <circle cx={5} cy={-8.5} r={3.2} fill="#c9b196" />
      <ellipse cx={3.6} cy={-13.5} rx={1.2} ry={4} fill="#c9b196" transform="rotate(-12 3.6 -13.5)" />
      <ellipse cx={6.2} cy={-13.4} rx={1.2} ry={4} fill="#b89f84" transform="rotate(10 6.2 -13.4)" />
      <circle cx={-6} cy={-5} r={1.8} fill="#fff" />
      <circle cx={6.3} cy={-9} r={0.7} fill="#1a1a1a" />
    </g>
  )
}

function Deer() {
  return (
    <g>
      <path d="M -9 -14 L -10 0 M -5 -13 L -5.5 0 M 6 -13 L 6.5 0 M 10 -14 L 11 0" stroke="#7a4a28" strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={0} cy={-18} rx={13} ry={6.5} fill="#b0703e" />
      <circle cx={-3} cy={-20} r={1} fill="#f3e3cf" />
      <circle cx={2} cy={-21} r={1} fill="#f3e3cf" />
      <circle cx={-7} cy={-19} r={0.9} fill="#f3e3cf" />
      <path d="M -13 -20 C -16 -22, -16 -18, -13 -17 Z" fill="#f3e3cf" />
      <g className="deer-head">
        <path d="M 8 -21 C 10 -26, 12 -30, 14 -32 L 18 -30 C 15 -27, 13 -23, 12 -18 Z" fill="#b0703e" />
        <ellipse cx={17.5} cy={-32} rx={5} ry={3.2} fill="#b0703e" />
        <path d="M 13 -34 L 12 -38.5 L 15.5 -35 Z" fill="#8e5530" />
        <circle cx={22} cy={-31.6} r={1} fill="#1a1a1a" />
        <circle cx={17.6} cy={-33} r={0.8} fill="#1a1a1a" />
      </g>
    </g>
  )
}

function Heron() {
  return (
    <g>
      <path d="M -2 0 L -1 -16 M 3 0 L 2 -16" stroke="#556070" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M -8 -24 C -8 -30, 2 -32, 6 -26 C 8 -22, 4 -16, -2 -16 C -6 -16, -9 -19, -8 -24 Z" fill="#8a9bb0" />
      <path d="M 4 -27 C 8 -32, 4 -36, 6 -40" stroke="#8a9bb0" strokeWidth={3} fill="none" strokeLinecap="round" />
      <circle cx={6.5} cy={-41} r={2.6} fill="#9aabbf" />
      <path d="M 8.5 -41.5 L 17 -40 L 8.5 -39.6 Z" fill="#e8b73a" />
      <path d="M 4 -42 L -2 -44" stroke="#2b3440" strokeWidth={1} strokeLinecap="round" />
    </g>
  )
}

function Butterfly({ c }: { c: string }) {
  return (
    <g>
      <g className="bfly-wings">
        <ellipse cx={-2.6} cy={-1.6} rx={2.8} ry={2.2} fill={c} />
        <ellipse cx={2.6} cy={-1.6} rx={2.8} ry={2.2} fill={c} />
        <ellipse cx={-2} cy={1.4} rx={1.8} ry={1.5} fill={c} opacity={0.85} />
        <ellipse cx={2} cy={1.4} rx={1.8} ry={1.5} fill={c} opacity={0.85} />
      </g>
      <rect x={-0.5} y={-3} width={1} height={5.4} rx={0.5} fill="#2b2b2b" />
    </g>
  )
}

function Dragonfly() {
  return (
    <g>
      <g className="dfly-wings" fill="rgba(220,240,255,.7)">
        <ellipse cx={-4} cy={-2} rx={4} ry={1.2} transform="rotate(-15 -4 -2)" />
        <ellipse cx={4} cy={-2} rx={4} ry={1.2} transform="rotate(15 4 -2)" />
        <ellipse cx={-3.5} cy={0.5} rx={3.5} ry={1} transform="rotate(10 -3.5 .5)" />
        <ellipse cx={3.5} cy={0.5} rx={3.5} ry={1} transform="rotate(-10 3.5 .5)" />
      </g>
      <rect x={-0.7} y={-4} width={1.4} height={10} rx={0.7} fill="#1f8a9a" />
    </g>
  )
}

function Bird() {
  return (
    <path className="bird-wings" d="M -6 0 Q -3 -4 0 0 Q 3 -4 6 0" stroke="#2a3a4e" strokeWidth={1.6} fill="none" strokeLinecap="round" />
  )
}

interface WorldProps {
  tier: Tier
  mood: Mood
  invested: number
  hatching?: boolean
}

export function World({ tier, mood, invested, hatching }: WorldProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const s = lakeSize(invested)
  const lake = shape(s)
  const vitality = VITALITY[tier]
  const alive = vitality >= 0.7
  const lush = vitality >= 0.9
  const has = (min: number) => invested >= min
  const clarity = smooth(0, 0.32, s)
  const [wTop, wBottom] = WATER[tier]
  const waterVars = {
    '--water-top': mixColor(MUD[0], wTop, clarity),
    '--water-bottom': mixColor(MUD[1], wBottom, clarity),
  } as CSSProperties

  const swanW = lerp(168, 204, s)
  const k = swanW / 330
  const reedScale = lerp(0.55, 1.1, smooth(STAGES.reeds, 400, invested))

  const rim = (deg: number, kk: number) => lake.at(deg, kk)
  const place = (p: Pt) => `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`

  const backRim = [200, 222, 318, 338]
  const frontRim = [160, 22]

  return (
    <svg className="world" viewBox="0 0 390 540" preserveAspectRatio="xMidYMax slice" style={waterVars} aria-hidden>
      <defs>
        <linearGradient id={`${uid}-meadow`} x1="0" y1="300" x2="0" y2="540" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--meadow-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--meadow-bottom)' }} />
        </linearGradient>
        <linearGradient id={`${uid}-water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--water-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--water-bottom)' }} />
        </linearGradient>
      </defs>

      {/* rainbow: the capstone of a long track record, only in good weather */}
      <Appear on={has(STAGES.rainbow) && tier === 'thriving'}>
        <g fill="none" strokeWidth={6} opacity={0.4}>
          {['#ff6b6b', '#ffb35c', '#ffe66b', '#7de38a', '#6bc6ff', '#9d8bff'].map((c, i) => (
            <path key={c} d={`M ${40 + i * 6} 300 A ${155 - i * 6} ${150 - i * 6} 0 0 1 ${350 - i * 6} 300`} stroke={c} />
          ))}
        </g>
      </Appear>

      {/* birds */}
      {[0, 1, 2].map((i) => (
        <Appear key={`b${i}`} on={has(STAGES.birds) && alive}>
          <g className={`bird bird${i}`}>
            <Bird />
          </g>
        </Appear>
      ))}

      <path d={bandPath(farHillY, 360)} className="w-hill-far" />

      {TREES.filter((t) => t.back).map((t, i) => (
        <g key={`tb${i}`} transform={`translate(${t.x} ${farHillY(t.x) + 4})`}>
          <Appear on={has(t.at)} delay={i * 40}>
            <g style={{ transform: `scale(${has(t.full) ? 1 : 0.6})`, transition: 'transform 1.2s ease' }}>
              <Tree kind={t.kind} h={t.h} />
            </g>
          </Appear>
        </g>
      ))}
      {TREES.filter((t) => !t.back).map((t, i) => (
        <g key={`t${i}`} transform={`translate(${t.x} ${farHillY(t.x) + 12})`}>
          <Appear on={has(t.at)} delay={i * 50}>
            <g style={{ transform: `scale(${has(t.full) ? 1 : 0.5})`, transition: 'transform 1.2s ease' }}>
              <Tree kind={t.kind} h={t.h} />
            </g>
          </Appear>
        </g>
      ))}

      {/* deer at the forest edge */}
      <g transform="translate(66 330)">
        <Appear on={has(STAGES.deer) && alive}>
          <Deer />
        </Appear>
      </g>

      <path d={bandPath(meadowY, 540)} fill={`url(#${uid}-meadow)`} />

      {/* foxes playing and rabbits hopping on the meadow */}
      <g transform="translate(300 346)">
        <Appear on={has(STAGES.foxes) && alive}>
          <g className="fox-pounce">
            <Fox />
          </g>
        </Appear>
      </g>
      <g transform="translate(344 348)">
        <Appear on={has(STAGES.foxes) && alive} delay={200}>
          <g className="fox-bow">
            <Fox flip />
          </g>
        </Appear>
      </g>
      {[
        [34, 356],
        [64, 364],
      ].map(([x, y], i) => (
        <g key={`r${i}`} transform={`translate(${x} ${y})`}>
          <Appear on={has(STAGES.rabbits) && alive} delay={i * 150}>
            <g className={`rabbit rabbit${i}`}>
              <Rabbit />
            </g>
          </Appear>
        </g>
      ))}

      {/* dry cracked earth around a small puddle */}
      <g style={{ opacity: 1 - smooth(0.04, 0.3, s), transition: 'opacity .6s' }}>
        <path d={lake.outline(1.9, 2)} fill="#b89a68" opacity={0.55} />
        <path
          d={`M ${CX - 120} ${CY + 6} l 14 -4 l 8 5 M ${CX + 96} ${CY - 2} l 12 5 l 10 -3 M ${CX - 60} ${CY + 30} l 10 4 l 6 -6 M ${CX + 40} ${CY + 32} l 9 -4 l 9 5`}
          stroke="#8a6d45"
          strokeWidth={1.2}
          fill="none"
          strokeLinecap="round"
        />
      </g>

      {/* bushes behind the lake */}
      {[
        [rim(252, 1.12), 11],
        [rim(292, 1.1), 9],
        [[18, 392] as Pt, 13],
        [[372, 400] as Pt, 14],
      ].map(([p, r], i) => (
        <g key={`bu${i}`} transform={place(p as Pt)}>
          <Appear on={has(STAGES.bushes)} delay={i * 120}>
            <Bush r={r as number} />
          </Appear>
        </g>
      ))}

      {/* the lake itself */}
      <path d={lake.outline(1.07, 2.5)} className="w-shore" />
      <path d={lake.outline(1)} fill={`url(#${uid}-water)`} />
      <path d={lake.outline(0.93, -2)} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth={1.5} />
      <g className="shimmer" stroke="rgba(255,255,255,.45)" strokeWidth={2} strokeLinecap="round">
        <line x1={CX - lake.rx * 0.6} y1={CY - lake.ry * 0.3} x2={CX - lake.rx * 0.38} y2={CY - lake.ry * 0.3} />
        <line x1={CX + lake.rx * 0.45} y1={CY + lake.ry * 0.25} x2={CX + lake.rx * 0.68} y2={CY + lake.ry * 0.25} />
        <line x1={CX - lake.rx * 0.3} y1={CY + lake.ry * 0.6} x2={CX - lake.rx * 0.12} y2={CY + lake.ry * 0.6} />
      </g>

      {/* rocks and grass along the shore */}
      {[25, 150, 262].map((a, i) => (
        <g key={`rk${i}`} transform={place(rim(a, 1.04))}>
          <ellipse cx={0} cy={-2} rx={6 - i} ry={3.6 - i * 0.4} fill="#8c8a84" />
          <ellipse cx={-1.5} cy={-3} rx={3} ry={1.5} fill="#a9a7a0" />
        </g>
      ))}
      {Array.from({ length: 16 }, (_, i) => i * 22.5 + 6)
        .filter((a) => a > 180)
        .map((a) => (
          <g key={`tf${a}`} transform={place(rim(a, 1.03))}>
            <Tuft />
          </g>
        ))}

      {/* back reeds and lily pads */}
      {backRim.map((a, i) => (
        <g key={`rb${a}`} transform={place(rim(a, 1.0))}>
          <Appear on={has(STAGES.reeds)} delay={i * 90}>
            <Reeds scale={reedScale * (i % 2 ? 0.85 : 1)} />
          </Appear>
        </g>
      ))}
      {[
        [140, 0.62],
        [40, 0.68],
        [100, 0.45],
        [300, 0.6],
      ].map(([a, kk], i) => (
        <g key={`lp${i}`} transform={place(rim(a, kk))}>
          <Appear on={has(STAGES.lilies)} delay={i * 110}>
            <g className="lilypad">
              <LilyPad flower={lush && i % 2 === 0} />
              {i === 0 && (
                <Appear on={has(STAGES.frog) && alive}>
                  <g transform="translate(-2 -1)">
                    <Frog />
                  </g>
                </Appear>
              )}
            </g>
          </Appear>
        </g>
      ))}

      {/* the swan (or its egg) */}
      <svg x={CX - 168 * k} y={CY - 196 * k - 1} width={swanW} height={240 * k} viewBox="0 0 330 240" overflow="visible" className="world-swan">
        {hatching ? <Egg /> : <Swan tier={tier} mood={mood} />}
      </svg>

      {/* heron wading at the edge */}
      <g transform={place(rim(348, 0.9))}>
        <Appear on={has(STAGES.heron) && alive}>
          <Heron />
        </Appear>
      </g>

      {/* front shore: grass, reeds, flowers */}
      {Array.from({ length: 16 }, (_, i) => i * 22.5 + 6)
        .filter((a) => a <= 180)
        .map((a) => (
          <g key={`tff${a}`} transform={place(rim(a, 1.04))}>
            <Tuft />
          </g>
        ))}
      {frontRim.map((a, i) => (
        <g key={`rf${a}`} transform={place(rim(a, 1.02))}>
          <Appear on={has(STAGES.reeds)} delay={300 + i * 90}>
            <Reeds scale={reedScale * 0.9} />
          </Appear>
        </g>
      ))}
      {[12, 38, 66, 118, 146, 172, 196, 236, 304, 332].map((a, i) => (
        <g key={`fl${a}`} transform={place(rim(a, 1.16 + (i % 3) * 0.06))}>
          <Appear on={has(STAGES.flowers) && alive} delay={i * 60}>
            <Flower c={FLOWER_COLORS[i % FLOWER_COLORS.length]} />
          </Appear>
        </g>
      ))}
      {[
        [30, 470],
        [360, 480],
        [110, 522],
        [300, 526],
        [16, 520],
      ].map(([x, y], i) => (
        <g key={`fm${i}`} transform={`translate(${x} ${y})`}>
          <Appear on={has(STAGES.flowers + 40) && alive} delay={i * 80}>
            <Flower c={FLOWER_COLORS[(i + 1) % FLOWER_COLORS.length]} />
          </Appear>
        </g>
      ))}

      {/* insects */}
      {['#ffd24a', '#ff9ec4'].map((c, i) => (
        <g key={`bf${i}`} transform={`translate(${i ? 330 : 58} ${i ? 440 : 420})`}>
          <Appear on={has(STAGES.butterflies) && lush}>
            <g className={`bfly bfly${i}`}>
              <Butterfly c={c} />
            </g>
          </Appear>
        </g>
      ))}
      {[0, 1].map((i) => (
        <g key={`df${i}`} transform={`translate(${CX + (i ? 70 : -80)} ${CY - 30})`}>
          <Appear on={has(STAGES.dragonflies) && lush}>
            <g className={`dfly dfly${i}`}>
              <Dragonfly />
            </g>
          </Appear>
        </g>
      ))}
    </svg>
  )
}
