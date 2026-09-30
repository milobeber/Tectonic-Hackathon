const eur = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' })
const eur0 = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export const money = (x: number) => eur.format(x)
export const money0 = (x: number) => eur0.format(x)

/** Split "€ 14,20" into parts so the hero number can size euros and cents differently. */
export function moneyParts(x: number) {
  const [whole, cents] = Math.abs(x).toFixed(2).split('.')
  return { whole: Number(whole).toLocaleString('nl-BE'), cents }
}

const d = (iso: string) => new Date(iso + 'T00:00:00Z')

export const dayLabel = (iso: string) =>
  d(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export const shortDate = (iso: string) => d(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export const monthName = (iso: string) => d(iso).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })

export const weekdayName = (iso: string) => d(iso).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })

export const weekdayKey = (iso: string) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d(iso).getUTCDay()]

/** The day after the cycle ends: payday for wage cycles, the 1st for calendar months. */
export const dayAfter = (isoDate: string) => {
  const x = d(isoDate)
  x.setUTCDate(x.getUTCDate() + 1)
  return x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
