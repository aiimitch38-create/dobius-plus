import type { ProviderRateLimits } from '../../../../../shared/rate-limit-types'

export type BoardUsageSummary = {
  provider: ProviderRateLimits['provider']
  usedPercent: number
  resetDescription: string | null
}

/**
 * The usage pill shows the single most-used session (5h) window across
 * providers that reported OK data, falling back to weekly when no session exists.
 */
export function boardUsageSummary(
  providers: readonly (ProviderRateLimits | null | undefined)[]
): BoardUsageSummary | null {
  let best: BoardUsageSummary | null = null
  for (const p of providers) {
    if (!p || p.status !== 'ok') {
      continue
    }
    const window = p.session ?? p.weekly
    if (!window) {
      continue
    }
    if (!best || window.usedPercent > best.usedPercent) {
      best = {
        provider: p.provider,
        usedPercent: Math.round(window.usedPercent),
        resetDescription: window.resetDescription
      }
    }
  }
  return best
}
