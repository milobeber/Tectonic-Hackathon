import { useState } from 'react'
import type { Difficulty } from '../api/types'
import { Pond } from '../components/Pond'
import { FUNDS } from '../mock/simulate'

interface Props {
  busy: boolean
  onStart: (difficulty: Difficulty, fundId: string) => void
}

const LEVELS: { key: Difficulty; label: string; save: string }[] = [
  { key: 'easy', label: 'Easy', save: 'Save 5%' },
  { key: 'normal', label: 'Normal', save: 'Save 10%' },
  { key: 'hard', label: 'Hard', save: 'Save 20%' },
]

export function OptInScreen({ busy, onStart }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [fundId, setFundId] = useState('kbc-sustainable-balanced')
  const [consent, setConsent] = useState(false)

  return (
    <div className="screen optin">
      <div className="optin-art">
        <Pond tier="healthy" mood="content" totalInvested={0} hatching />
      </div>

      <div className="optin-body">
        <p className="eyebrow">New in KBC Mobile</p>
        <h1>Meet your swan</h1>
        <p className="lede">
          We learn how you usually spend and set a daily limit that fits you. Stay under it and your swan thrives. Whatever you
          don't spend is invested for you at the end of each month.
        </p>

        <ul className="facts">
          <li>
            <b>One number a day.</b> Your limit adjusts to your week: more on Saturdays if that's when you go out.
          </li>
          <li>
            <b>Big one-offs are covered.</b> A new laptop or a trip is paid from what you've saved, not today's limit.
          </li>
          <li>
            <b>Your savings grow the lake.</b> Each month's surplus goes into a KBC fund of your choice.
          </li>
        </ul>

        <fieldset className="field">
          <legend>Challenge</legend>
          <div className="segmented" role="radiogroup">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                role="radio"
                aria-checked={difficulty === l.key}
                className={difficulty === l.key ? 'on' : ''}
                onClick={() => setDifficulty(l.key)}
              >
                <span>{l.label}</span>
                <small>{l.save}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>Invest my savings in</legend>
          <div className="funds">
            {Object.values(FUNDS).map((f) => (
              <label key={f.id} className={`fund ${fundId === f.id ? 'on' : ''}`}>
                <input type="radio" name="fund" checked={fundId === f.id} onChange={() => setFundId(f.id)} />
                <span className="fund-name">{f.name.replace(' (demo)', '')}</span>
                <span className="fund-risk" aria-label={`Risk class ${f.risk_class} of 7`}>
                  {Array.from({ length: 7 }, (_, i) => (
                    <i key={i} className={i < f.risk_class ? 'lit' : ''} />
                  ))}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Use my KBC transactions to set my daily limit. I can stop any time in settings.</span>
        </label>

        <button className="cta" disabled={!consent || busy} onClick={() => onStart(difficulty, fundId)}>
          {busy ? 'Hatching…' : 'Hatch my swan'}
        </button>
      </div>
    </div>
  )
}
