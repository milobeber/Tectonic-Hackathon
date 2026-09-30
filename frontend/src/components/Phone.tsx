import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Changing this resets the scroll position (new screen). */
  screenKey: string
  /** Scroll offset after which the content under the status bar is light, so the bar turns dark. */
  solidStatusAfter: number
}

export function Phone({ children, screenKey, solidStatusAfter }: Props) {
  const content = useRef<HTMLDivElement>(null)
  const [solid, setSolid] = useState(false)

  useEffect(() => {
    content.current?.scrollTo({ top: 0 })
    setSolid(false)
  }, [screenKey])

  return (
    <div className="device">
      <div className="device-screen">
        <div className={`statusbar ${solid ? 'statusbar--solid' : ''}`} aria-hidden>
          <span>9:41</span>
          <span className="statusbar-island" />
          <span className="statusbar-icons">
            <svg viewBox="0 0 18 12" width="17" height="11">
              <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
              <rect x="5" y="5" width="3" height="7" rx="1" fill="currentColor" />
              <rect x="10" y="2" width="3" height="10" rx="1" fill="currentColor" />
              <rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" />
            </svg>
            <svg viewBox="0 0 26 12" width="24" height="11">
              <rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".5" />
              <rect x="2" y="2" width="17" height="8" rx="1.6" fill="currentColor" />
              <rect x="24" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".5" />
            </svg>
          </span>
        </div>
        <div className="device-content" ref={content} onScroll={(e) => setSolid(e.currentTarget.scrollTop > solidStatusAfter)}>
          {children}
        </div>
        <nav className="tabbar" aria-label="KBC Mobile">
          {[
            ['Home', 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z'],
            ['Pay', 'M3 7h18v10H3zM3 11h18'],
            ['Swan', 'M7 17c2 2 8 2 10-1 1.4-2 .6-4.6-1.4-5.2-2-.6-2.6.8-2.6 2 0 2-2.6 2.6-4 1.4M13 12.6c0-2.6-.6-4-2-4.6'],
            ['Invest', 'M4 18l5-6 4 3 7-8M15 7h5v5'],
            ['More', 'M5 12h.01M12 12h.01M19 12h.01'],
          ].map(([label, d]) => (
            <span key={label} className={`tab ${label === 'Swan' ? 'tab--on' : ''}`}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                <path d={d} fill="none" stroke="currentColor" strokeWidth={label === 'More' ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {label}
            </span>
          ))}
        </nav>
      </div>
    </div>
  )
}
