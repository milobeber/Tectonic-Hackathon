// Writes the scene windows from assets/lib/cues.js into index.html's slot attributes,
// and the root duration to the end of the last scene.
//
//   npm run cues

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const window = {}
new Function('window', readFileSync('assets/lib/cues.js', 'utf8'))(window)
const cues = window.CUES

let html = readFileSync('index.html', 'utf8')
let end = 0
for (const [id, c] of Object.entries(cues)) {
  const re = new RegExp(`(<div[^>]*data-composition-id="${id}"[^>]*?)data-start="[^"]*"([^>]*?)data-duration="[^"]*"`)
  if (!re.test(html)) throw new Error(`no slot for ${id} in index.html`)
  html = html.replace(re, `$1data-start="${c.start}"$2data-duration="${c.dur}"`)
  end = Math.max(end, c.start + c.dur)
}
html = html.replace(/(id="root"[^>]*?data-duration=")[^"]*"/, `$1${+end.toFixed(3)}"`)

// Sound effects between the sfx markers.
const len = {}
const clips = (window.SFX || []).map(([scene, beat, off, file, vol], i) => {
  const c = cues[scene]
  if (!(beat in c.b)) throw new Error(`sfx: no beat ${scene}.${beat}`)
  const at = +(c.start + c.b[beat] + off).toFixed(3)
  len[file] ??= +execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 assets/sfx/${file}.mp3`).toString().trim()
  const dur = +Math.min(len[file], end - at).toFixed(3)
  return `      <audio id="sfx-${i}" src="assets/sfx/${file}.mp3" data-start="${at}" data-duration="${dur}" data-track-index="${11 + (i % 3)}" data-volume="${vol}"></audio>`
})
html = html.replace(/(<!-- sfx:start -->)[\s\S]*?(\s*<!-- sfx:end -->)/, `$1\n${clips.join('\n')}$2`)
writeFileSync('index.html', html)
console.log(`index.html: ${Object.keys(cues).length} scenes, ${end.toFixed(2)}s`)
