import type {
  ProviderRateLimits,
  RateLimitWindow,
  UsageProbeStage,
  UsageRateLimitSource
} from '../../../../../../shared/rate-limit-types'
import type { TuiAgent } from '../../../../../../shared/types'

// View model for the Board usage popover. Pure: no store, no i18n, no timers.
// Components translate the keys this module returns.

export type UsageProviderId = ProviderRateLimits['provider']

// Order fixed so the provider row reads the same every time regardless of fetch order.
export const USAGE_PROVIDER_ORDER: readonly UsageProviderId[] = [
  'claude',
  'codex',
  'gemini',
  'opencode-go',
  'kimi',
  'minimax'
]

export const USAGE_PROVIDER_LABELS: Record<UsageProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  'opencode-go': 'OpenCode Go',
  kimi: 'Kimi',
  minimax: 'MiniMax'
}

/** Agent whose catalog icon stands for the provider; null = no icon (letter tile). */
export function usageProviderAgent(provider: UsageProviderId): TuiAgent | null {
  switch (provider) {
    case 'claude':
      return 'claude'
    case 'codex':
      return 'codex'
    case 'gemini':
      return 'gemini'
    case 'opencode-go':
      return 'opencode'
    case 'kimi':
      return 'kimi'
    default:
      return null
  }
}

/** Providers that have local usage history (claude-usage/, codex-usage/, opencode-usage/). */
export type UsageHistoryProvider = 'claude' | 'codex' | 'opencode'

export function usageHistoryProvider(provider: UsageProviderId): UsageHistoryProvider | null {
  return provider === 'claude' || provider === 'codex'
    ? provider
    : provider === 'opencode-go'
      ? 'opencode'
      : null
}

export type UsagePhase = 'loading' | 'refreshing' | 'loaded' | 'unavailable'

export function hasUsageWindows(p: ProviderRateLimits | null | undefined): boolean {
  return Boolean(
    p && (p.session || p.weekly || p.fableWeekly || p.monthly || (p.buckets?.length ?? 0) > 0)
  )
}

/**
 * loading: nothing to show yet; refreshing: fetching with the last reading still
 * on screen; loaded: windows to draw; unavailable: provider answered with no data.
 */
export function usagePhase(p: ProviderRateLimits | null | undefined): UsagePhase {
  if (!p || p.status === 'idle') {
    return 'loading'
  }
  if (p.status === 'fetching') {
    return hasUsageWindows(p) ? 'refreshing' : 'loading'
  }
  if (p.status === 'ok' && hasUsageWindows(p)) {
    return 'loaded'
  }
  return 'unavailable'
}

export type UsageWindowLabelKey = 'session' | 'weekly' | 'fableWeekly' | 'monthly'

export type UsageWindowRow = {
  key: string
  /** i18n key under board.usagePanel.window; null when `label` is the provider's own bucket name. */
  labelKey: UsageWindowLabelKey | null
  /** The provider's bucket name (Gemini); null for the keyed windows. */
  label: string | null
  window: RateLimitWindow
}

/** Session first (it feeds the donut), then every other window the provider reports. */
export function usageWindowRows(p: ProviderRateLimits): UsageWindowRow[] {
  const rows: UsageWindowRow[] = []
  const keyed: [UsageWindowLabelKey, RateLimitWindow | null | undefined][] = [
    ['session', p.session],
    ['weekly', p.weekly],
    ['fableWeekly', p.fableWeekly],
    ['monthly', p.monthly]
  ]
  for (const [labelKey, window] of keyed) {
    if (window) {
      rows.push({ key: labelKey, labelKey, label: null, window })
    }
  }
  for (const bucket of p.buckets ?? []) {
    rows.push({ key: `bucket:${bucket.name}`, labelKey: null, label: bucket.name, window: bucket })
  }
  return rows
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.round(Math.max(0, Math.min(100, value)))
}

/** SVG stroke-dasharray for a ring of `circumference` showing `usedPercent`. */
export function donutDash(usedPercent: number, circumference: number): string {
  const filled = (clampPercent(usedPercent) / 100) * circumference
  return `${filled} ${Math.max(0, circumference - filled)}`
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

type DateParts = { year: number; month: number; day: number; hour: number; minute: number }

function partsIn(ms: number, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }).formatToParts(new Date(ms))
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute')
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2:20am" / "4am": 12-hour, lowercase meridiem, minutes only when non-zero. */
export function formatClock(parts: Pick<DateParts, 'hour' | 'minute'>): string {
  const meridiem = parts.hour >= 12 ? 'pm' : 'am'
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12
  const minutes = parts.minute === 0 ? '' : `:${String(parts.minute).padStart(2, '0')}`
  return `${hour12}${minutes}${meridiem}`
}

/**
 * Reset time as the reference shows it: "2:20am" when it lands today (in the
 * given zone), otherwise "Nov 1 at 4am". Falls back to the provider's own text.
 */
export function formatResetAt(
  resetsAt: number | null,
  fallback: string | null,
  options: { now: number; timeZone: string }
): string | null {
  if (resetsAt === null) {
    return fallback
  }
  const when = partsIn(resetsAt, options.timeZone)
  const today = partsIn(options.now, options.timeZone)
  const clock = formatClock(when)
  const sameDay = when.year === today.year && when.month === today.month && when.day === today.day
  return sameDay ? clock : `${MONTHS[when.month - 1]} ${when.day} at ${clock}`
}

/** "0:08", "1:05", "12:00". */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export type RelativeUpdated =
  | { unit: 'now' }
  | { unit: 'minutes'; value: number }
  | { unit: 'hours'; value: number }
  | { unit: 'days'; value: number }

export function relativeUpdated(updatedAt: number, now: number): RelativeUpdated {
  const elapsedMs = Math.max(0, now - updatedAt)
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) {
    return { unit: 'now' }
  }
  if (minutes < 60) {
    return { unit: 'minutes', value: minutes }
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return { unit: 'hours', value: hours }
  }
  return { unit: 'days', value: Math.floor(hours / 24) }
}

export type FooterStatus =
  | { kind: 'reading' }
  | { kind: 'updated'; relative: RelativeUpdated; refreshing: boolean }
  | { kind: 'unavailable' }

/** Right side of the footer bar for the selected provider. */
export function footerStatus(p: ProviderRateLimits | null | undefined, now: number): FooterStatus {
  const phase = usagePhase(p)
  if (phase === 'loading') {
    return { kind: 'reading' }
  }
  if (phase === 'unavailable' || !p) {
    return { kind: 'unavailable' }
  }
  return {
    kind: 'updated',
    relative: relativeUpdated(p.updatedAt, now),
    refreshing: phase === 'refreshing'
  }
}

/** Mono command label on the footer's left, e.g. "claude › /usage". */
export function footerCommand(
  provider: UsageProviderId,
  source: UsageRateLimitSource | undefined
): string {
  if (provider === 'claude') {
    return source === 'cli' || source === undefined ? 'claude › /usage' : 'claude › usage api'
  }
  if (provider === 'codex') {
    return 'codex › usage'
  }
  if (provider === 'opencode-go') {
    return 'opencode › usage'
  }
  return `${provider} › usage`
}

/** True when the reading came from (or is coming from) the hidden CLI `/usage` probe. */
export function isCliProbe(
  stage: UsageProbeStage | null,
  source: UsageRateLimitSource | undefined
): boolean {
  if (stage !== null) {
    return stage.startsWith('cli-')
  }
  return source === 'cli'
}

/** Which i18n key under board.usagePanel describes the live stage. */
export function probeStageKey(
  stage: UsageProbeStage | null
): 'stageOauth' | 'stageCliStart' | 'stageCliUsage' | 'stageReading' {
  switch (stage) {
    case 'oauth':
      return 'stageOauth'
    case 'cli-start':
      return 'stageCliStart'
    case 'cli-usage':
      return 'stageCliUsage'
    default:
      return 'stageReading'
  }
}
