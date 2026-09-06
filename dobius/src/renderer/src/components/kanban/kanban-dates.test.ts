import { describe, expect, it } from 'vitest'

import { DAY_MS, parseDueDate, startOfDay } from './kanban-dates'

describe('parseDueDate', () => {
  it('lands on local midnight of the stated day, not UTC', () => {
    const parsed = parseDueDate('2026-09-12')
    expect(parsed).not.toBeNull()
    const date = new Date(parsed as number)
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 8, 12])
    expect(date.getHours()).toBe(0)
  })

  it('returns null for a missing or unparseable date', () => {
    expect(parseDueDate(undefined)).toBeNull()
    expect(parseDueDate('')).toBeNull()
    expect(parseDueDate('next tuesday')).toBeNull()
  })

  it('keeps consecutive days exactly one day apart', () => {
    const first = parseDueDate('2026-09-12') as number
    const second = parseDueDate('2026-09-13') as number
    expect(second - first).toBe(DAY_MS)
  })
})

describe('startOfDay', () => {
  it('strips the time of day', () => {
    const noon = new Date(2026, 8, 12, 12, 34, 56, 789).getTime()
    expect(startOfDay(noon)).toBe(parseDueDate('2026-09-12'))
  })
})
