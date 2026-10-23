import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../../../../shared/rate-limit-types'
import { boardUsageSummary } from './board-usage-summary'

function provider(
  name: ProviderRateLimits['provider'],
  status: ProviderRateLimits['status'],
  session: number | null,
  weekly: number | null = null
): ProviderRateLimits {
  const w = (used: number | null) =>
    used === null
      ? null
      : { usedPercent: used, windowMinutes: 300, resetsAt: null, resetDescription: '11:20 PM' }
  return {
    provider: name,
    status,
    session: w(session),
    weekly: w(weekly),
    updatedAt: 0,
    error: null
  }
}

describe('boardUsageSummary', () => {
  it('picks the most-used OK provider window', () => {
    expect(
      boardUsageSummary([provider('claude', 'ok', 40.4), provider('codex', 'ok', 72.6), null])
    ).toEqual({ provider: 'codex', usedPercent: 73, resetDescription: '11:20 PM' })
  })

  it('skips errored providers and falls back to the weekly window', () => {
    expect(
      boardUsageSummary([provider('claude', 'error', 99), provider('gemini', 'ok', null, 12)])
    ).toEqual({ provider: 'gemini', usedPercent: 12, resetDescription: '11:20 PM' })
  })

  it('returns null with no usable data', () => {
    expect(boardUsageSummary([null, provider('codex', 'unavailable', 5)])).toBeNull()
  })
})
