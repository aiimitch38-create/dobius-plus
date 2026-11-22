import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { safeText } from '../safe-text'
import { getOptionalWorktreeSelector } from '../selectors'

type SnoozedTab = {
  worktreeId: string
  tabId: string
  title: string
  until: number | null
  ready: boolean
  returning: boolean
}

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const
const MAX_AHEAD_MS = 365 * 86_400_000

/** When `--until` means, in ms; null for "until brought back". Throws on anything unclear. */
export function parseSnoozeUntil(raw: string, now: number = Date.now()): number | null {
  const text = raw.trim().toLowerCase()
  if (text === 'manual' || text === 'never') {
    return null
  }
  let at: number
  const duration = /^(\d{1,6})\s*([mhd])$/.exec(text)
  const clock = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (duration) {
    at = now + Number(duration[1]) * UNIT_MS[duration[2] as keyof typeof UNIT_MS]
  } else if (clock) {
    const [hour, minute] = [Number(clock[1]), Number(clock[2])]
    if (hour > 23 || minute > 59) {
      throw new RuntimeClientError('invalid_argument', '--until clock time must be a valid 24-hour time')
    }
    const next = new Date(now)
    next.setHours(hour, minute, 0, 0)
    if (next.getTime() <= now) {
      next.setDate(next.getDate() + 1)
    }
    at = next.getTime()
  } else if (/^\d{12,}$/.test(text)) {
    at = Number(text)
  } else {
    at = Date.parse(raw.trim())
  }
  if (!Number.isFinite(at)) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--until must be like 30m, 2h, 1d, 14:30, an ISO date and time, or manual'
    )
  }
  if (at <= now || at - now > MAX_AHEAD_MS) {
    throw new RuntimeClientError('invalid_argument', '--until must be in the future and within a year')
  }
  return at
}

export function formatSnoozedTabs(tabs: SnoozedTab[]): string {
  if (tabs.length === 0) {
    return 'No snoozed tabs.'
  }
  return tabs
    .map((t) => {
      const when = t.returning
        ? 'coming back'
        : t.ready
          ? 'ready'
          : t.until === null
            ? 'manual'
            : new Date(t.until).toISOString()
      return safeText(`${t.tabId}  ${when}  ${t.worktreeId}  ${t.title}`)
    })
    .join('\n')
}

export const TABS_SNOOZE_HANDLERS: Record<string, CommandHandler> = {
  'tabs snooze': async ({ client, flags, json }) => {
    const until = parseSnoozeUntil(getRequiredStringFlag(flags, 'until'))
    const result = await client.call<{ worktreeId: string; tabId: string; until: number | null }>(
      'tabs.snooze',
      {
        tab: getRequiredStringFlag(flags, 'tab'),
        until,
        ...(flags.get('force') === true ? { force: true } : {})
      }
    )
    printResult(result, json, (value) =>
      safeText(
        `Snoozed tab ${value.tabId}; it comes back ${value.until === null ? 'when you bring it back' : `at ${new Date(value.until).toISOString()}`}.`
      )
    )
  },
  'tabs unsnooze': async ({ client, flags, cwd, json }) => {
    const worktree = await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)
    const result = await client.call<{ tabId: string; message: string }>('tabs.unsnooze', {
      tab: getRequiredStringFlag(flags, 'tab'),
      ...(worktree ? { worktree } : {})
    })
    printResult(result, json, (value) => safeText(`Tab ${value.tabId}: ${value.message}`))
  },
  'tabs snoozed': async ({ client, flags, cwd, json }) => {
    const worktree = await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)
    const result = await client.call<{ tabs: SnoozedTab[] }>(
      'tabs.snoozed',
      worktree ? { worktree } : {}
    )
    printResult(result, json, (value) => formatSnoozedTabs(value.tabs))
  }
}
