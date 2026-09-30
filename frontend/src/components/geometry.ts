// Small vector helpers for the procedural swan and lake.

export type Pt = [number, number]
export type Cubic = [Pt, Pt, Pt, Pt]

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
export const smooth = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a))
  return x * x * (3 - 2 * x)
}

const f = (n: number) => Math.round(n * 10) / 10

/** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
export function catmullRom(points: Pt[], closed = true, tension = 1): string {
  const n = points.length
  if (n < 2) return ''
  const at = (i: number) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))])
  let d = `M ${f(points[0][0])} ${f(points[0][1])}`
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1: Pt = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension]
    const c2: Pt = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension]
    d += ` C ${f(c1[0])} ${f(c1[1])}, ${f(c2[0])} ${f(c2[1])}, ${f(p2[0])} ${f(p2[1])}`
  }
  return closed ? d + ' Z' : d
}

export function cubicAt([p0, p1, p2, p3]: Cubic, t: number): { p: Pt; d: Pt } {
  const u = 1 - t
  const p: Pt = [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ]
  const d: Pt = [
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]),
  ]
  return { p, d }
}

/** Outline of a variable-width stroke along a chain of cubics, as a closed smooth path. */
export function taperedStroke(chain: Cubic[], width: (t: number) => number, samplesPerSegment = 10) {
  const left: Pt[] = []
  const right: Pt[] = []
  const total = chain.length * samplesPerSegment
  let end = { p: [0, 0] as Pt, d: [1, 0] as Pt }
  for (let s = 0; s <= total; s++) {
    const seg = Math.min(chain.length - 1, Math.floor(s / samplesPerSegment))
    const t = s / samplesPerSegment - seg
    const { p, d } = cubicAt(chain[seg], t)
    const len = Math.hypot(d[0], d[1]) || 1
    const nx = -d[1] / len
    const ny = d[0] / len
    const w = width(s / total) / 2
    left.push([p[0] + nx * w, p[1] + ny * w])
    right.push([p[0] - nx * w, p[1] - ny * w])
    end = { p, d: [d[0] / len, d[1] / len] }
  }
  return { path: catmullRom([...left, ...right.reverse()], true, 0.9), end }
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function mixColor(a: string, b: string, t: number) {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  const c = x.map((v, i) => Math.round(lerp(v, y[i], clamp01(t))))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
