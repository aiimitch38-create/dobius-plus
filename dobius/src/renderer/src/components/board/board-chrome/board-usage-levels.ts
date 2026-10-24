import type { ProviderRateLimits, RateLimitWindow } from '../../../../../shared/rate-limit-types'

// Usage colouring and window-reset detection for the Board usage panel and pill.
// Pure: no store, no sound, no network.

export const USAGE_WARNING_PERCENT = 75
export const USAGE_DANGER_PERCENT = 90

export type UsageLevel = 'normal' | 'warning' | 'danger'

export function usageLevel(usedPercent: number): UsageLevel {
  return usedPercent >= USAGE_DANGER_PERCENT
    ? 'danger'
    : usedPercent >= USAGE_WARNING_PERCENT
      ? 'warning'
      : 'normal'
}

/** CSS colour for a level; normal uses the Board accent. */
export function usageLevelColor(level: UsageLevel): string {
  return level === 'danger'
    ? 'var(--board-danger-text)'
    : level === 'warning'
      ? 'var(--board-warning-text)'
      : 'var(--board-accent)'
}

const WINDOW_KEYS = ['session', 'weekly', 'fableWeekly', 'monthly'] as const

export type UsageWindows = Record<string, RateLimitWindow>

/** "claude:session" -> window, for every window a provider reports right now. */
export function usageWindows(providers: readonly (ProviderRateLimits | null)[]): UsageWindows {
  const out: UsageWindows = {}
  for (const p of providers) {
    if (!p || p.status !== 'ok') {
      continue
    }
    for (const key of WINDOW_KEYS) {
      const w = p[key]
      if (w) {
        out[`${p.provider}:${key}`] = w
      }
    }
  }
  return out
}

// A reset moves the window's end forward by a good part of its length.
const MIN_RESET_ADVANCE_MS = 10 * 60_000
// Without reset times, only a near-total drop counts (from real use to almost none).
const DROP_FROM_PERCENT = 20
const DROP_TO_PERCENT = 5

function windowReset(prev: RateLimitWindow, next: RateLimitWindow): boolean {
  if (next.usedPercent >= prev.usedPercent) {
    return false
  }
  if (prev.resetsAt !== null && next.resetsAt !== null) {
    return next.resetsAt - prev.resetsAt >= MIN_RESET_ADVANCE_MS
  }
  return prev.usedPercent >= DROP_FROM_PERCENT && next.usedPercent <= DROP_TO_PERCENT
}

/** Keys of windows that reset between two readings; windows seen for the first time never count. */
export function detectUsageResets(prev: UsageWindows, next: UsageWindows): string[] {
  return Object.keys(next).filter((key) => {
    const before = prev[key]
    return before !== undefined && windowReset(before, next[key])
  })
}
