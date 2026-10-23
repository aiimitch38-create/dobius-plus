// Pure month-grid math for the calendar card. Dates are local YYYY-MM-DD keys.

export function dateKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

export type MonthCell = { key: string; day: number; inMonth: boolean }

// Always 6 weeks x 7 days (Sunday first) so the card height never jumps between months.
export function monthGrid(year: number, month: number): MonthCell[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return { key: dateKey(d), day: d.getDate(), inMonth: d.getMonth() === month }
  })
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}
