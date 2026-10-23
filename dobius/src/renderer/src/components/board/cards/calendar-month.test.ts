import { describe, expect, it } from 'vitest'
import { dateKey, monthGrid, shiftMonth } from './calendar-month'

describe('dateKey', () => {
  it('formats local dates with padding', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('monthGrid', () => {
  it('returns 42 cells starting on the Sunday on/before the 1st', () => {
    // Oct 1 2026 is a Thursday.
    const grid = monthGrid(2026, 9)
    expect(grid).toHaveLength(42)
    expect(grid[0]).toEqual({ key: '2026-09-27', day: 27, inMonth: false })
    expect(grid[4]).toEqual({ key: '2026-10-01', day: 1, inMonth: true })
    expect(grid.filter((c) => c.inMonth)).toHaveLength(31)
  })
})

describe('shiftMonth', () => {
  it('wraps across years', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })
})
