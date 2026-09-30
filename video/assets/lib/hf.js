// Shared helpers for every scene. Loaded once in index.html, before the scenes mount.
// Everything here is deterministic: no clocks, no randomness without a seed.
;(function () {
  const eur = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' })
  let mounts = 0

  const HF = {
    /** Raw markup of a rendered app snippet (see build/snippets.tsx). */
    snip(key) {
      const s = window.SNIPPETS && window.SNIPPETS[key]
      if (!s) throw new Error('missing snippet ' + key)
      return s
    },

    /** Markup with every SVG id made unique for this mount (snippets reuse ids when mounted twice). */
    uniq(html) {
      const m = ++mounts
      return HF.brand(HF.oneSprite(html.replace(/_s(\d+)-/g, `_s$1m${m}-`)))
    },

    /** The app's Swan draws all four sprites and hides the inactive ones with CSS. In the film
        that CSS can lag or get overridden, so keep only the active sprite in the markup. */
    oneSprite: (html) => html.replace(/<image[^>]*class="swan-sprite (?!on)[^"]*"[^>]*><\/image>/g, ''),

    /**
     * Wrap the drawing of every .swan SVG under root in a <g> that scales it about the
     * waterline (168, 196 in the swan frame) and offsets it by dx/dy frame units.
     * The sprites are taller than the old SVG swan, so scenes shrink them to stay in frame.
     * Returns a setter (k, dx, dy) that scenes can drive per frame.
     */
    swanRig(root, k = 1, dx = 0, dy = 0) {
      const gs = [...root.querySelectorAll('svg.swan')].map((svg) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        g.setAttribute('class', 'hf-swan-rig')
        ;[...svg.childNodes].filter((n) => n.nodeName !== 'defs').forEach((n) => g.appendChild(n))
        svg.appendChild(g)
        return g
      })
      const set = (k2, dx2 = 0, dy2 = 0) => gs.forEach((g) => g.setAttribute('transform', `translate(${168 + dx2} ${196 + dy2}) scale(${k2}) translate(-168 -196)`))
      set(k, dx, dy)
      return set
    },

    /** The product is called Plume now (the swan's name, next to KBC's Kate). Until the app's
        own copy is renamed, relabel the swan screen's title here. */
    brand: (html) => html.replace(/(<span class="topbar-title">)Swan/g, '$1Plume'),

    /** Mount a snippet into el. Returns el. */
    mount(el, key) {
      el.innerHTML = HF.uniq(HF.snip(key))
      return el
    },

    /** Mount the app's Phone shell with a screen snippet inside. Returns the .device element. */
    phone(slot, screenKey) {
      slot.innerHTML = HF.uniq(HF.snip('phone').replace('@@SLOT@@', HF.snip(screenKey)))
      return slot.querySelector('.device')
    },

    /** Mount the app's Phone shell around raw screen markup. Returns the .device element. */
    phoneWith(slot, html) {
      slot.innerHTML = HF.uniq(HF.snip('phone')).replace('@@SLOT@@', HF.oneSprite(html))
      return slot.querySelector('.device')
    },

    /** Add another screen into an existing phone (stacked, for push transitions). Returns the wrapper. */
    addScreen(device, screenKey) {
      const content = device.querySelector('.device-content')
      const wrap = document.createElement('div')
      wrap.className = 'hf-screen'
      wrap.style.cssText = 'position:absolute;left:0;top:0;width:100%;'
      wrap.innerHTML = HF.uniq(HF.snip(screenKey))
      content.style.position = 'relative'
      content.appendChild(wrap)
      return wrap
    },

    /**
     * Scenes mount hidden, so their own nodes have no layout at build time. measure()
     * lays out a clone of `el` off-canvas (same global CSS), runs fn(clone) and throws
     * the clone away. Deterministic: layout depends only on the markup.
     */
    measure(el, fn) {
      const box = document.createElement('div')
      box.className = 'hf'
      box.style.cssText = 'position:absolute;left:-10000px;top:0;width:1920px;height:1080px;visibility:hidden;pointer-events:none;'
      const clone = el.cloneNode(true)
      clone.style.transform = 'none'
      box.appendChild(clone)
      document.body.appendChild(box)
      try {
        return fn(clone)
      } finally {
        box.remove()
      }
    },

    /** Layout box of el relative to an ancestor. Only for measure() clones, never at tween time. */
    pos(el, ancestor) {
      const a = ancestor.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const x = r.left - a.left
      const y = r.top - a.top
      return { x, y, w: r.width, h: r.height, cx: x + r.width / 2, cy: y + r.height / 2 }
    },

    /** Resolves once every video font is loaded, so measured text wraps as it will render. */
    fontsReady() {
      const faces = [
        '400 16px Onest',
        '600 16px Onest',
        '700 16px "Bricolage Grotesque"',
        '800 16px "Bricolage Grotesque"',
        '400 16px "Nunito Sans"',
        '700 16px "Nunito Sans"',
        '800 16px "Nunito Sans"',
        '500 16px "JetBrains Mono"',
      ]
      return Promise.all(faces.map((f) => document.fonts.load(f))).then(() => document.fonts.ready)
    },

    /** Plume's mark from the demo app (circle + swan stroke). */
    logo: (size = 40) =>
      `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><circle cx="20" cy="20" r="20" fill="#00aeef"/><path d="M12 27c3 3 13 3 16-2 2-3 1-7-2-8-3-1-4 1-4 3 0 3-4 4-6 2m8-10c0-4-1-6-3-7" fill="none" stroke="#0b1b33" stroke-width="3" stroke-linecap="round"/></svg>`,

    money: (x) => eur.format(x),

    /** KBC Mobile style amount parts: "3 214,56 EUR". */
    kbc(x) {
      const [w, c] = Math.abs(x).toFixed(2).split('.')
      const whole = w.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
      return { sign: x < 0 ? '-' : '', whole, cents: c }
    },

    /**
     * Procedural state that GSAP can't tween (text, classes, checkbox state, path morphs)
     * is recomputed from the timeline's own time on every render: seek-safe by construction.
     * Usage: const drv = HF.driver(tl); drv.add((t) => ...)
     */
    driver(tl) {
      const fns = []
      const run = () => {
        const t = tl.time()
        for (const f of fns) f(t)
      }
      tl.eventCallback('onUpdate', run)
      return { add: (f) => (fns.push(f), f), run }
    },

    /** 0..1 progress of the window [at, at + dur] at time t, eased. */
    prog(t, at, dur, ease = 'none') {
      const p = Math.min(1, Math.max(0, (t - at) / dur))
      return gsap.parseEase(ease)(p)
    },

    /** A number shown as text, counting from `from` to `to`. fmt(value) -> string. */
    count(drv, el, from, to, at, dur, fmt, ease = 'power2.out') {
      drv.add((t) => (el.textContent = fmt(from + (to - from) * HF.prog(t, at, dur, ease))))
    },

    /** Class on from `at` until `until`. */
    classAt(drv, el, cls, at, until = Infinity) {
      drv.add((t) => el.classList.toggle(cls, t >= at && t < until))
    },

    /** Seeded PRNG (mulberry32). */
    rng(seed) {
      let a = seed >>> 0
      return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    },

    /** A tap: the touch dot lands at (x, y), presses, lifts. */
    tap(tl, dot, x, y, at, hold = 0.18) {
      tl.set(dot, { left: x, top: y }, at - 0.3)
      tl.fromTo(dot, { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 1, duration: 0.25, ease: 'power2.out', immediateRender: false }, at - 0.3)
      tl.to(dot, { scale: 0.78, duration: 0.09, ease: 'power1.in' }, at - 0.05)
      tl.to(dot, { scale: 1.25, opacity: 0, duration: 0.35, ease: 'power2.out' }, at + hold)
      return at
    },

    /**
     * Morph one rendered Swan SVG into another (the app does this with CSS transitions).
     * Posture, neck, colours and the belly-up flip interpolate; the eyes and extras
     * (sparkles, thermometer, flies...) cross-fade near the end, when both swans overlap.
     */
    swanMorph(tl, drv, from, to, at, dur = 1.1) {
      const read = (svg) => {
        const q = (s) => svg.querySelector(s)
        return {
          neck: q('.swan-neck').style.d,
          body: q('.swan-neck').style.stroke,
          head: q('.swan-head').style.transform,
          figure: q('.swan-figure').style.transform,
          flip: q('.swan-torso').style.transform.includes('scaleY') ? 1 : 0,
          wing: q('.swan-wing').style.fill,
          curl: q('.swan-curls').style.stroke,
          beak: q('.swan-head > path').style.fill,
          stops: [...svg.querySelectorAll('defs radialGradient stop')].map((s) => s.style.stopColor),
        }
      }
      const nums = (s) => (s.match(/-?\d*\.?\d+/g) || []).map(Number)
      const crossfade = () => {
        tl.to(to, { opacity: 1, duration: dur * 0.6, ease: 'sine.inOut' }, at + dur * 0.2)
        tl.to(from, { opacity: 0, duration: dur * 0.6, ease: 'sine.inOut' }, at + dur * 0.2)
      }
      // The swan is being redesigned in the app: if its SVG no longer has the parts this
      // morph drives (or the neck paths stop matching), fall back to a plain cross-fade.
      let A
      let B
      try {
        A = read(from)
        B = read(to)
      } catch (e) {
        return crossfade()
      }
      if (!A.neck || !B.neck || nums(A.neck).length !== nums(B.neck).length || nums(A.head).length < 3 || nums(B.head).length < 3 || nums(A.figure).length < 2 || nums(B.figure).length < 2) return crossfade()
      const neckA = nums(A.neck)
      const neckB = nums(B.neck)
      const headA = nums(A.head)
      const headB = nums(B.head)
      const figA = nums(A.figure)
      const figB = nums(B.figure)
      const lerp = (a, b, t) => a + (b - a) * t
      const color = (a, b, t) => gsap.utils.interpolate(a, b, t)
      const all = (s) => [...from.querySelectorAll(s)]
      const necks = all('.swan-neck')
      const heads = all('.swan-head')
      const figures = all('.swan-figure')
      const torsos = all('.swan-torso')
      const wings = all('.swan-wing')
      const curls = all('.swan-curls')
      const skulls = all('.swan-head > ellipse:first-child')
      const beaks = all('.swan-head > path')
      const stops = all('defs radialGradient stop')
      const apply = (t) => {
        let i = 0
        const neck = A.neck.replace(/-?\d*\.?\d+/g, () => {
          const v = lerp(neckA[i], neckB[i], t)
          i++
          return v.toFixed(2)
        })
        const stroke = color(A.body, B.body, t)
        necks.forEach((e) => ((e.style.d = neck), (e.style.stroke = stroke)))
        const head = `translate(${lerp(headA[0], headB[0], t)}px, ${lerp(headA[1], headB[1], t)}px) rotate(${lerp(headA[2], headB[2], t)}deg)`
        heads.forEach((e) => (e.style.transform = head))
        const fig = `translateY(${lerp(figA[0], figB[0], t)}px) rotate(${lerp(figA[1], figB[1], t)}deg)`
        figures.forEach((e) => (e.style.transform = fig))
        const k = lerp(A.flip, B.flip, t)
        torsos.forEach((e) => (e.style.transform = `translate(0px, ${262 * k}px) scaleY(${1 - 2 * k})`))
        wings.forEach((e) => (e.style.fill = color(A.wing, B.wing, t)))
        curls.forEach((e) => (e.style.stroke = color(A.curl, B.curl, t)))
        skulls.forEach((e) => (e.style.fill = stroke))
        beaks.forEach((e) => (e.style.fill = color(A.beak, B.beak, t)))
        stops.forEach((e, j) => (e.style.stopColor = color(A.stops[j % A.stops.length], B.stops[j % B.stops.length], t)))
      }
      // Always applied (progress 0 before `at`), so seeking backwards restores the start pose.
      drv.add((t) => apply(HF.prog(t, at, dur, 'power2.inOut')))
      tl.to(to, { opacity: 1, duration: dur * 0.4, ease: 'sine.inOut' }, at + dur * 0.6)
      tl.to(from, { opacity: 0, duration: dur * 0.4, ease: 'sine.inOut' }, at + dur * 0.6)
    },
  }

  window.HF = HF
})()
