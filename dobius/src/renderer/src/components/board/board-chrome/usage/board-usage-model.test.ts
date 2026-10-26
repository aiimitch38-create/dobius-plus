import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../../../../../shared/rate-limit-types'
import {
  clampPercent,
  donutDash,
  footerCommand,
  footerStatus,
  formatClock,
  formatElapsed,
  formatResetAt,
  isCliProbe,
  probeStageKey,
  relativeUpdated,
  usagePhase,
  usageWindowRows
} from './board-usage-model'

const WINDOW = { usedPercent: 3, windowMinutes: 300, resetsAt: null, resetDescription: '2:20 AM' }

function provider(partial: Partial<ProviderRateLimits>): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: 1_000,
    error: null,
    status: 'ok',
    ...partial
  }
}

describe('usagePhase', () => {
  it('is loading before any reading and while the first fetch runs', () => {
    expect(usagePhase(null)).toBe('loading')
    expect(usagePhase(provider({ status: 'idle' }))).toBe('loading')
    expect(usagePhase(provider({ status: 'fetching' }))).toBe('loading')
  })

  it('keeps the last reading on screen while refreshing', () => {
    expect(usagePhase(provider({ status: 'fetching', session: WINDOW }))).toBe('refreshing')
  })

  it('is loaded with windows and unavailable without them or on error', () => {
    expect(usagePhase(provider({ session: WINDOW }))).toBe('loaded')
    expect(usagePhase(provider({ buckets: [{ ...WINDOW, name: 'flash' }] }))).toBe('loaded')
    expect(usagePhase(provider({}))).toBe('unavailable')
    expect(usagePhase(provider({ status: 'error', error: 'nope' }))).toBe('unavailable')
    expect(usagePhase(provider({ status: 'unavailable' }))).toBe('unavailable')
  })
})

describe('usageWindowRows', () => {
  it('lists session first, then weekly, Fable, monthly and named buckets', () => {
    const rows = usageWindowRows(
      provider({
        session: WINDOW,
        weekly: { ...WINDOW, usedPercent: 17 },
        fableWeekly: { ...WINDOW, usedPercent: 9 },
        monthly: { ...WINDOW, usedPercent: 40 },
        buckets: [{ ...WINDOW, name: 'gemini-2.5-pro', usedPercent: 1 }]
      })
    )
    expect(rows.map((r) => r.key)).toEqual([
      'session',
      'weekly',
      'fableWeekly',
      'monthly',
      'bucket:gemini-2.5-pro'
    ])
    expect(rows[4].labelKey).toBeNull()
    expect(rows[4].label).toBe('gemini-2.5-pro')
  })
})

describe('donut math', () => {
  it('clamps and rounds the percent', () => {
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(3.4)).toBe(3)
    expect(clampPercent(120)).toBe(100)
    expect(clampPercent(Number.NaN)).toBe(0)
  })

  it('splits the circumference into filled and empty lengths', () => {
    expect(donutDash(25, 200)).toBe('50 150')
    expect(donutDash(0, 200)).toBe('0 200')
    expect(donutDash(100, 200)).toBe('200 0')
  })
})

describe('reset formatting', () => {
  it('writes clock times the way the reference does', () => {
    expect(formatClock({ hour: 2, minute: 20 })).toBe('2:20am')
    expect(formatClock({ hour: 4, minute: 0 })).toBe('4am')
    expect(formatClock({ hour: 0, minute: 5 })).toBe('12:05am')
    expect(formatClock({ hour: 12, minute: 0 })).toBe('12pm')
    expect(formatClock({ hour: 16, minute: 30 })).toBe('4:30pm')
  })

  it('shows only the time when the reset lands today in the given zone', () => {
    const now = Date.UTC(2026, 9, 25, 15, 0) // 11:00am Detroit (EDT, UTC-4)
    const resetsAt = Date.UTC(2026, 9, 25, 18, 20) // 2:20pm Detroit
    expect(formatResetAt(resetsAt, null, { now, timeZone: 'America/Detroit' })).toBe('2:20pm')
  })

  it('adds the date when the reset is on another day', () => {
    const now = Date.UTC(2026, 9, 25, 15, 0)
    const resetsAt = Date.UTC(2026, 10, 1, 9, 0) // Nov 1, 4:00am Detroit (EST after DST ends)
    expect(formatResetAt(resetsAt, null, { now, timeZone: 'America/Detroit' })).toBe('Nov 1 at 4am')
  })

  it('falls back to the provider text without a timestamp', () => {
    expect(formatResetAt(null, 'Thu', { now: 0, timeZone: 'UTC' })).toBe('Thu')
    expect(formatResetAt(null, null, { now: 0, timeZone: 'UTC' })).toBeNull()
  })
})

describe('elapsed and relative time', () => {
  it('formats m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(8.7)).toBe('0:08')
    expect(formatElapsed(65)).toBe('1:05')
    expect(formatElapsed(-3)).toBe('0:00')
  })

  it('buckets how long ago a reading was', () => {
    const now = 10 * 60 * 60_000
    expect(relativeUpdated(now - 10_000, now)).toEqual({ unit: 'now' })
    expect(relativeUpdated(now - 3 * 60_000, now)).toEqual({ unit: 'minutes', value: 3 })
    expect(relativeUpdated(now - 2 * 3_600_000, now)).toEqual({ unit: 'hours', value: 2 })
    expect(relativeUpdated(0, 3 * 86_400_000)).toEqual({ unit: 'days', value: 3 })
  })
})

describe('footer', () => {
  it('reads while loading, reports age when loaded, flags refreshes', () => {
    const now = 100_000
    expect(footerStatus(null, now)).toEqual({ kind: 'reading' })
    expect(footerStatus(provider({ status: 'fetching' }), now)).toEqual({ kind: 'reading' })
    expect(footerStatus(provider({ session: WINDOW, updatedAt: now - 5_000 }), now)).toEqual({
      kind: 'updated',
      relative: { unit: 'now' },
      refreshing: false
    })
    expect(
      footerStatus(provider({ status: 'fetching', session: WINDOW, updatedAt: now - 120_000 }), now)
    ).toEqual({ kind: 'updated', relative: { unit: 'minutes', value: 2 }, refreshing: true })
    expect(footerStatus(provider({ status: 'error', error: 'x' }), now)).toEqual({
      kind: 'unavailable'
    })
  })

  it('names the command the reading came from', () => {
    expect(footerCommand('claude', 'cli')).toBe('claude › /usage')
    expect(footerCommand('claude', undefined)).toBe('claude › /usage')
    expect(footerCommand('claude', 'oauth')).toBe('claude › usage api')
    expect(footerCommand('codex', undefined)).toBe('codex › usage')
    expect(footerCommand('opencode-go', undefined)).toBe('opencode › usage')
    expect(footerCommand('minimax', undefined)).toBe('minimax › usage')
  })
})

describe('probe notes', () => {
  it('attributes the reading to the CLI page only on the CLI path', () => {
    expect(isCliProbe('cli-usage', undefined)).toBe(true)
    expect(isCliProbe('oauth', 'cli')).toBe(false)
    expect(isCliProbe(null, 'cli')).toBe(true)
    expect(isCliProbe(null, 'oauth')).toBe(false)
    expect(isCliProbe(null, undefined)).toBe(false)
  })

  it('maps stages to copy keys', () => {
    expect(probeStageKey(null)).toBe('stageReading')
    expect(probeStageKey('oauth')).toBe('stageOauth')
    expect(probeStageKey('cli-start')).toBe('stageCliStart')
    expect(probeStageKey('cli-usage')).toBe('stageCliUsage')
    expect(probeStageKey('cli-read')).toBe('stageReading')
  })
})
