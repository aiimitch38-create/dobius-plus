import { translate } from '@/i18n/i18n'
import type { SnoozePick } from '../../../../shared/snooze-times'
import { snoozePicks, snoozeTimeLabel } from '../../../../shared/snooze-times'

/** The pick's name in the user's language; `pick.label` is the English fallback. */
export function snoozePickLabel(pick: SnoozePick): string {
  switch (pick.id) {
    case 'tonight':
      return translate('lib.tabSnooze.pick.tonight', 'Tonight')
    case 'tomorrow-night':
      return translate('lib.tabSnooze.pick.tomorrowNight', 'Tomorrow night')
    case 'morning':
      return translate('lib.tabSnooze.pick.morning', 'Tomorrow morning')
    case '24h':
      return translate('lib.tabSnooze.pick.24h', '24 hours')
    case '2d':
      return translate('lib.tabSnooze.pick.2d', '2 days')
    case 'week':
      return translate('lib.tabSnooze.pick.week', 'Next week')
    case 'manual':
      return translate('lib.tabSnooze.pick.manual', 'Until I bring it back')
  }
}

/** When a snoozed tab comes back, as the shelf and menus show it. */
export function snoozeUntilLabel(until: number | null, now: number = Date.now()): string {
  return (
    snoozeTimeLabel(until, now) ??
    translate('lib.tabSnooze.untilBroughtBack', 'until you bring it back')
  )
}

export type SnoozeMenuPick = { key: string; label: string; hint: string | null; at: number | null }

/** The rows under Snooze. Dev builds get a one-minute pick to watch a timed return. */
export function snoozeMenuPicks(now: number = Date.now()): SnoozeMenuPick[] {
  const picks: SnoozeMenuPick[] = snoozePicks(now).map((pick) => ({
    key: pick.id,
    label: snoozePickLabel(pick),
    hint: pick.at === null ? null : snoozeTimeLabel(pick.at, now),
    at: pick.at
  }))
  if (import.meta.env.DEV) {
    picks.unshift({ key: 'dev-1m', label: '1 minute (dev only)', hint: null, at: now + 60_000 })
  }
  return picks
}
