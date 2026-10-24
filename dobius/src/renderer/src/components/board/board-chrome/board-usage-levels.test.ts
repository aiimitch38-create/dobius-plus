import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits, RateLimitWindow } from '../../../../../shared/rate-limit-types'
import { detectUsageResets, usageLevel, usageLevelColor, usageWindows } from './board-usage-levels'

const win = (usedPercent: number, resetsAt: number | null): RateLimitWindow => ({
  usedPercent,
  windowMinutes: 300,
  resetsAt,
  resetDescription: null
})
const H = 60 * 60_000

describe('usageLevel', () => {
  it('turns amber at 75% and red at 90%', () => {
    expect(usageLevel(74.9)).toBe('normal')
    expect(usageLevel(75)).toBe('warning')
    expect(usageLevel(89.9)).toBe('warning')
    expect(usageLevel(90)).toBe('danger')
    expect(usageLevelColor('warning')).toBe('var(--board-warning-text)')
    expect(usageLevelColor('danger')).toBe('var(--board-danger-text)')
    expect(usageLevelColor('normal')).toBe('var(--board-accent)')
  })
})

describe('detectUsageResets', () => {
  it('sees a reset when usage drops and the window end jumps forward', () => {
    expect(
      detectUsageResets({ 'claude:session': win(80, 5 * H) }, { 'claude:session': win(2, 10 * H) })
    ).toEqual(['claude:session'])
  })

  it('ignores normal drift, rising usage and first readings', () => {
    expect(
      detectUsageResets({ 'claude:session': win(40, 5 * H) }, { 'claude:session': win(39, 5 * H) })
    ).toEqual([])
    expect(
      detectUsageResets({ 'codex:weekly': win(10, 5 * H) }, { 'codex:weekly': win(20, 20 * H) })
    ).toEqual([])
    expect(detectUsageResets({}, { 'claude:session': win(1, H) })).toEqual([])
  })

  it('without reset times, counts only a near-total drop', () => {
    expect(
      detectUsageResets({ 'kimi:weekly': win(60, null) }, { 'kimi:weekly': win(0, null) })
    ).toEqual(['kimi:weekly'])
    expect(
      detectUsageResets({ 'kimi:weekly': win(60, null) }, { 'kimi:weekly': win(40, null) })
    ).toEqual([])
  })
})

describe('usageWindows', () => {
  it('keys every window of providers that answered', () => {
    const ok = {
      provider: 'claude',
      status: 'ok',
      session: win(1, H),
      weekly: win(2, H)
    } as unknown as ProviderRateLimits
    const failed = {
      provider: 'codex',
      status: 'error',
      session: win(1, H),
      weekly: null
    } as unknown as ProviderRateLimits
    expect(Object.keys(usageWindows([ok, failed, null]))).toEqual([
      'claude:session',
      'claude:weekly'
    ])
  })
})
