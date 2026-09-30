// The cue sheet: when each scene starts and when each voiceover beat lands.
// Scene times are global seconds; beat times are seconds from the scene's start.
// Derived from the recorded voiceover (assets/vo/anchors.json, from build/vo.py):
// beats land ~0.1 s before the word so the picture leads the voice.
// After editing, run `npm run cues` to copy the scene windows into index.html.
window.CUES = {
  s01: { start: 0.0, dur: 10.1, b: { app: 1.54, coffee: 3.4, grocery: 4.14, late: 5.2, tells: 6.33, after: 7.9 } },
  s02: { start: 10.1, dur: 14.45, b: { what: 0.3, meet: 2.83, plume: 3.61, tab: 4.32, challenge: 7.57, fund: 8.65, optin: 11.44, hatch: 13.33, card: 4.06, tapCard: 6.57 } },
  s03: { start: 24.55, dur: 13.2, b: { crack: 0.25, world: 1.6, one: 2.9, today: 4.3, no: 6.82, learned: 9.86 } },
  s04: { start: 37.75, dur: 17.5, b: { thrive: 0.38, turns: 2.3, tired: 5.34, sick: 7.05, dies: 7.82, bad: 11.37, habit: 13.36, dead: 9.53 } },
  s05: { start: 55.25, dur: 18.0, b: { buffer: 0.62, life: 3.54, laptop: 5.37, catches: 7.34, not: 9.1, cant: 10.46, earn: 13.0 } },
  s06: { start: 73.25, dur: 10.4, b: { payday: 0.46, lake: 4.91, passive: 6.25, dive: 9.4 } },
  s07: { start: 83.65, dur: 40.6, b: { hood: 0.32, nobox: 1.74, history: 3.88, aside: 7.17, noise: 11.56, because: 14.1, baseline: 18.87, saturday: 22.39, save: 27.07, cap: 30.28, freeze: 34.22 } },
  s08: { start: 124.25, dur: 18.5, b: { explain: 0.71, api: 5.41, push: 8.63, pull: 10.09, optin: 11.62, det: 13.53, del: 14.62 } },
  s09: { start: 142.75, dur: 14.29, b: { sofie: 0.54, lucas: 2.12, works: 4.84, emma: 6.37, jonas: 8.76, four: 11.28 } },
  s10: { start: 157.04, dur: 9.41, b: { name: 1.02, kbc: 1.72, intent: 2.86, alive: 4.21 } },
}

// Sound effects: [scene, beat, offset seconds, file in assets/sfx, volume]. Written into
// index.html as <audio> clips by `npm run cues`.
window.SFX = []
