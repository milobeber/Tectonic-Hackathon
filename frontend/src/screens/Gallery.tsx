import type { Mood, Tier } from '../api/types'
import { Pond } from '../components/Pond'
import { Swan } from '../components/Swan'
import { STAGES } from '../components/World'

// Open with ?gallery: every swan state and every stage of the lake, for slides and review.

const MOODS: { tier: Tier; mood: Mood; health: string; rule: string }[] = [
  { tier: 'thriving', mood: 'happy', health: '80–100', rule: 'Consistently under your limit' },
  { tier: 'healthy', mood: 'content', health: '60–79', rule: 'Mostly on track' },
  { tier: 'tired', mood: 'worried', health: '40–59', rule: 'Slipping over more often' },
  { tier: 'sick', mood: 'sad', health: '20–39', rule: 'Regularly over the limit' },
  { tier: 'rotting', mood: 'critical', health: '10–19', rule: 'One more bad week…' },
  { tier: 'dead', mood: 'dead', health: '0', rule: 'Gone until next cycle' },
]

const GROWTH: { invested: number; title: string; note: string }[] = [
  { invested: 0, title: 'A puddle', note: 'Day one: nothing invested yet' },
  { invested: STAGES.reeds, title: 'A pond', note: `€${STAGES.reeds}: reeds and lily pads` },
  { invested: STAGES.frog, title: 'Life arrives', note: `€${STAGES.frog}: bushes, saplings, a frog` },
  { invested: STAGES.foxes, title: 'A forest', note: `€${STAGES.foxes}: trees, birds, rabbits, foxes` },
  { invested: STAGES.deer + 100, title: 'A lake', note: `€${STAGES.deer}: deer at the forest edge` },
  { invested: 1500, title: 'An ecosystem', note: '€1,200+: heron, dragonflies, a rainbow' },
]

export function Gallery() {
  return (
    <main className="gallery">
      <h1>Six moods of a black swan</h1>
      <p>Health follows the 7-day spending pace. The wing folds, the neck drops and the colour drains as it falls.</p>
      <div className="gallery-swans">
        {MOODS.map((r) => (
          <figure key={r.tier}>
            <div className="gallery-swan">
              <Swan tier={r.tier} mood={r.mood} frame="0 -80 330 320" />
            </div>
            <figcaption>
              <b>{r.tier}</b>
              <span>Health {r.health}</span>
              <span>{r.rule}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <h1 className="gallery-h2">The lake grows with what you invest</h1>
      <p>Every payday your savings go into the fund, the water spreads, and life moves in around it.</p>
      <div className="gallery-grid">
        {GROWTH.map((g) => (
          <figure key={g.invested}>
            <div className="gallery-frame">
              <Pond tier="thriving" mood="happy" totalInvested={g.invested} />
            </div>
            <figcaption>
              <b>{g.title}</b>
              <span>{g.note}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <h1 className="gallery-h2">Same lake, different health</h1>
      <p>A big lake doesn't protect a sick swan: animals hide, flowers wilt, the forest browns.</p>
      <div className="gallery-grid">
        {MOODS.map((r) => (
          <figure key={r.tier}>
            <div className="gallery-frame">
              <Pond tier={r.tier} mood={r.mood} totalInvested={700} />
            </div>
            <figcaption>
              <b>{r.tier}</b>
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  )
}
