// KBC Mobile chrome for the video: the "Start" home screen and KBC's tab bar.
// Layout and labels follow the live KBC Mobile app (EN), colours are KBC's design tokens.
;(function () {
  const icon = (d, w = 1.8) =>
    `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`

  const TABS = [
    ['start', 'Start', 'M4 7.5h13.5a2.5 2.5 0 0 1 2.5 2.5v7.5a2.5 2.5 0 0 1-2.5 2.5H6a2 2 0 0 1-2-2zM4 7.5l11.5-3.5v3.5M16.5 14h.01'],
    ['mykbc', 'My KBC', 'M4 5.5h3v3H4zM10 5.5h10v3H10zM4 10.5h3v3H4zM10 10.5h10v3H10zM4 15.5h3v3H4zM10 15.5h10v3H10z'],
    ['swan', 'Plume', 'M7 17c2 2 8 2 10-1 1.4-2 .6-4.6-1.4-5.2-2-.6-2.6.8-2.6 2 0 2-2.6 2.6-4 1.4M13 12.6c0-2.6-.6-4-2-4.6'],
    ['invest', 'Investments', 'M5 12.5a7 5.5 0 0 1 13.4-2.2l1.6-.8v3.4l-1.3.7c-.5 1.3-1.4 2.3-2.7 3V19h-3v-1.6h-2V19H8v-2.4c-1.8-1-3-2.5-3-4.1zM9 8.5l1.5-2.5M14.5 11h.01'],
    ['offer', 'Offer', 'M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4'],
  ]

  const KBC = {
    /** Replace the demo app's tab bar in a phone with KBC's. The Swan tab starts hidden unless withSwan. */
    tabbar(device, active = 'start', withSwan = true) {
      const bar = device.querySelector('.tabbar')
      bar.classList.add('kbc-tabbar')
      bar.setAttribute('aria-label', 'KBC Mobile')
      bar.innerHTML = TABS.map(([key, label, d]) => {
        const on = key === active ? ' tab--on' : ''
        const hide = key === 'swan' && !withSwan ? ' style="width:0px;opacity:0"' : ''
        return `<span class="tab tab--${key}${on}"${hide}>${icon(d, key === 'mykbc' ? 1.6 : 1.8)}${label}</span>`
      }).join('')
      return bar
    },

    kate: () =>
      `<span class="kbc-kate-icon"><svg viewBox="0 0 12 12" width="10" height="10"><g stroke="#0097db" stroke-width="1.6" stroke-linecap="round"><path d="M4 3h4M2.5 6h7M4.5 9h3"/></g></svg></span>`,

    /** The Start screen. tx = [[dd/mm, merchant, amount]], newest first. */
    home(tx, { swanTip = false } = {}) {
      const amount = (x) => {
        const [w, c] = Math.abs(x).toFixed(2).split('.')
        return `${x < 0 ? '-' : ''}${w.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}<small>,${c} EUR</small>`
      }
      const wallet = `<svg viewBox="0 0 48 40" width="54" height="46"><path d="M6 12h32a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H9a3 3 0 0 1-3-3zM6 12l26-7v7M34 24h.01" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      const card = (cls, name, x) =>
        `<div class="kbc-card"><div class="kbc-card-art ${cls}">${wallet}</div><div class="kbc-card-meta"><span>${name}</span><b>${amount(x).replace('<small>', '<small>')}</b></div></div>`
      const rows = tx
        .map(
          ([d, m, a], i) =>
            `<div class="kbc-tx-row" data-row="${i}"><span class="kbc-tx-hl"></span><span class="d">${d}</span><span class="m">${m}</span><span class="a">${amount(a)}</span></div>`,
        )
        .join('')
      const swan = `
        <div class="kbc-tip kbc-tip--swan" data-swan-tip>
          <span class="kbc-tip-icon"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 17c2 2 8 2 10-1 1.4-2 .6-4.6-1.4-5.2-2-.6-2.6.8-2.6 2 0 2-2.6 2.6-4 1.4M13 12.6c0-2.6-.6-4-2-4.6" fill="none" stroke="#0b1b33" stroke-width="2.2" stroke-linecap="round"/></svg></span>
          <div>
            <span class="kbc-tip-kicker"><span class="kbc-new">New</span> Plume</span>
            <p>Meet Plume, your swan: a daily limit that fits how you spend. What you don't spend gets invested.</p>
            <span class="kbc-tip-cta">Try it</span>
          </div>
          <span class="kbc-tip-x">✕</span>
        </div>`
      return `
      <div class="screen kbc-home">
        <div class="kbc-top">
          <span class="kbc-avatar">SP</span>
          <span class="kbc-search">How can I help you?<span class="kbc-kate">${KBC.kate()}Kate</span></span>
          <span class="kbc-bell"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><i></i></span>
        </div>
        <div class="kbc-chips">
          <span class="kbc-chip kbc-chip--on"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7.5h13.5a2.5 2.5 0 0 1 2.5 2.5v7.5a2.5 2.5 0 0 1-2.5 2.5H6a2 2 0 0 1-2-2zM4 7.5l11.5-3.5v3.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg></span>
          <span class="kbc-chip">MyNWS</span><span class="kbc-chip">MyMobility</span><span class="kbc-chip">MyHome</span>
        </div>
        <div class="kbc-cards">
          <div class="kbc-card kbc-card--ktc"><span>35,00 KTC</span></div>
          ${card('', 'Personal account', 1284.37)}
          ${card('kbc-card-art--teal', 'Savings account', 3950)}
          ${card('kbc-card-art--navy', 'Shared account', 612.08)}
        </div>
        <div class="kbc-tx">${rows}<div class="kbc-tx-link">⌃ Hide transactions</div></div>
        <div class="kbc-foryou">
          <h3>For you</h3>
          ${swanTip ? swan : ''}
          <div class="kbc-tip">
            <span class="kbc-tip-icon"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 19l4-12 8 8zM14 5l1-2M18 9l2-1M17 6l2-2" fill="none" stroke="#0d2a50" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <div><span class="kbc-tip-kicker">${KBC.kate()} Kate tip</span><p>See what's new in KBC Mobile now!</p></div>
            <span class="kbc-tip-x">✕</span>
          </div>
        </div>
      </div>`
    },

    fab: () =>
      `<div class="kbc-fab"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 9h13l-3.5-3.5M19 15H6l3.5 3.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`,

    /** KBC's real transaction list for the demo customer, newest first. */
    TX: [
      ['24/09', 'Bakkerij Mertens', -4.66],
      ['24/09', 'Coffee Lab', -3.8],
      ['23/09', 'Bakkerij Mertens', -3.6],
      ['22/09', 'Colruyt', -41.98],
      ['22/09', 'De Lijn', -2.5],
      ['21/09', 'Deliveroo', -27.4],
      ['21/09', 'Pizzeria Da Mario', -24.65],
      ['21/09', 'Cafe De Markt', -20.69],
      ['21/09', 'Bol.com', -11.74],
      ['19/09', 'Colruyt', -18.74],
      ['18/09', 'De Lijn', -8.36],
      ['17/09', 'Bakkerij Mertens', -5.63],
      ['16/09', 'Aldi', -34.87],
      ['15/09', 'Spotify', -11.99],
      ['15/09', 'Coffee Lab', -2.75],
      ['14/09', 'Bakkerij Mertens', -2.5],
      ['13/09', 'Aldi', -32.9],
      ['12/09', 'Colruyt', -28.26],
      ['10/09', 'Basic-Fit', -25.0],
      ['10/09', 'Lidl', -35.54],
      ['08/09', 'Proximus', -20.0],
      ['08/09', 'Coffee Lab', -3.55],
    ],
  }

  window.KBC = KBC
})()
