import { useEffect, useRef, useState } from 'react'

/** Tweens a number toward its new value, so daily changes read as motion rather than a jump. */
export function useTween(value: number, ms = 650) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const shownRef = useRef(value)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      shownRef.current = value
      setShown(value)
      return
    }
    from.current = shownRef.current
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - t, 3)
      const v = from.current + (value - from.current) * eased
      shownRef.current = v
      setShown(v)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])

  return shown
}

/** Tweens every number in an array (used to morph the swan's pose between health states). */
export function useTweenArray(target: number[], ms = 1100) {
  const [shown, setShown] = useState(target)
  const current = useRef(target)
  const key = target.join(',')

  useEffect(() => {
    const to = key.split(',').map(Number)
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || current.current.length !== to.length) {
      current.current = to
      setShown(to)
      return
    }
    const from = current.current
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const v = from.map((x, i) => x + (to[i] - x) * e)
      current.current = v
      setShown(v)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [key, ms])

  return shown
}
