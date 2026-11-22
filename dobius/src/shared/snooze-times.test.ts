import { describe, expect, it } from 'vitest'
import { daysUntilNextMonday, localDayAtHour, snoozePicks, snoozeTimeLabel } from './snooze-times'

const local = (y: number, mo: number, d: number, h: number, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi).getTime()

describe('snoozePicks', () => {
  it('offers tonight 9 PM while it is ahead, tomorrow night after it', () => {
    const tue = local(2026, 11, 10, 11, 47) // a Tuesday
    const picks = snoozePicks(tue)
    expect(picks.map((pick) => pick.id)).toEqual([
      'tonight',
      'morning',
      '24h',
      '2d',
      'week',
      'manual'
    ])
    expect(picks[0].at).toBe(local(2026, 11, 10, 21))
    expect(picks[1].at).toBe(local(2026, 11, 11, 9))
    expect(picks[2].at).toBe(tue + 24 * 3600e3)
    expect(picks[3].at).toBe(tue + 48 * 3600e3)
    expect(picks[4].at).toBe(local(2026, 11, 16, 9)) // next Monday
    expect(picks[5].at).toBeNull()
    const late = snoozePicks(local(2026, 11, 10, 21, 0))
    expect(late[0].id).toBe('tomorrow-night')
    expect(late[0].at).toBe(local(2026, 11, 11, 21))
  })

  it('next week from a Monday is the Monday after, from a Sunday is the next day', () => {
    const week = (now: number): number | null | undefined =>
      snoozePicks(now).find((pick) => pick.id === 'week')?.at
    expect(week(local(2026, 11, 16, 8))).toBe(local(2026, 11, 23, 9))
    expect(week(local(2026, 11, 15, 8))).toBe(local(2026, 11, 16, 9))
  })
})

describe('snoozeTimeLabel', () => {
  it('shows the time alone on the same day and the weekday within the week', () => {
    const now = local(2026, 11, 10, 11, 47)
    expect(snoozeTimeLabel(local(2026, 11, 10, 21), now)).toMatch(/^9:00\s?PM$/)
    expect(snoozeTimeLabel(local(2026, 11, 12, 11, 47), now)).toMatch(/^Thu 11:47\s?AM$/)
    expect(snoozeTimeLabel(local(2026, 11, 30, 9), now)).toMatch(/^Nov 30, 9:00\s?AM$/)
    expect(snoozeTimeLabel(null, now)).toBeNull()
  })
})

describe('shared day helpers', () => {
  it('localDayAtHour rolls over month ends in local time', () => {
    expect(localDayAtHour(new Date(2026, 10, 30, 23, 30), 1, 9)).toBe(local(2026, 12, 1, 9))
  })

  it('daysUntilNextMonday is never zero', () => {
    expect(daysUntilNextMonday(new Date(2026, 10, 16, 8))).toBe(7) // Monday
    expect(daysUntilNextMonday(new Date(2026, 10, 15, 8))).toBe(1) // Sunday
    expect(daysUntilNextMonday(new Date(2026, 10, 10, 8))).toBe(6) // Tuesday
  })
})
