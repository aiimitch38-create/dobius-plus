// Snooze quick picks for a tab, ported from Sam's shared/snooze-times.js.
// Pure: every time is computed from `now` in local time, so tests pass a fixed date.

const HOUR_MS = 60 * 60 * 1000

/** Local wall-clock `hour`:00 on the day `dayOffset` days after `base`, as a ms timestamp. */
export function localDayAtHour(base: Date, dayOffset: number, hour: number): number {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    hour,
    0,
    0,
    0
  ).getTime()
}

/** Days until the next Monday, never today: on a Monday it is a week out. */
export function daysUntilNextMonday(base: Date): number {
  return (8 - base.getDay()) % 7 || 7
}

export type SnoozePickId =
  | 'tonight'
  | 'tomorrow-night'
  | 'morning'
  | '24h'
  | '2d'
  | 'week'
  | 'manual'

export type SnoozePick = {
  id: SnoozePickId
  /** English name; the menu translates by `id` and uses this as the fallback. */
  label: string
  /** When the tab comes back (ms), or null for "until I bring it back". */
  at: number | null
}

/**
 * The picks shown under Snooze, in order. Tonight 9 PM only while it is still
 * ahead (after 9 PM the first pick is tomorrow night instead).
 */
export function snoozePicks(nowMs: number = Date.now()): SnoozePick[] {
  const now = new Date(nowMs)
  const ninePmToday = localDayAtHour(now, 0, 21)
  const night: SnoozePick =
    ninePmToday > nowMs
      ? { id: 'tonight', label: 'Tonight', at: ninePmToday }
      : { id: 'tomorrow-night', label: 'Tomorrow night', at: localDayAtHour(now, 1, 21) }
  return [
    night,
    { id: 'morning', label: 'Tomorrow morning', at: localDayAtHour(now, 1, 9) },
    { id: '24h', label: '24 hours', at: nowMs + 24 * HOUR_MS },
    { id: '2d', label: '2 days', at: nowMs + 48 * HOUR_MS },
    { id: 'week', label: 'Next week', at: localDayAtHour(now, daysUntilNextMonday(now), 9) },
    { id: 'manual', label: 'Until I bring it back', at: null }
  ]
}

/**
 * "9:00 PM", "Wed 9:00 AM", or "Nov 18, 9:00 AM" past a week: how a pick or a
 * snoozed row shows its time. Null for "until I bring it back" (the caller
 * owns that wording so it can be translated).
 */
export function snoozeTimeLabel(atMs: number | null, nowMs: number = Date.now()): string | null {
  if (atMs == null) {
    return null
  }
  const d = new Date(atMs)
  const now = new Date(nowMs)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return time
  }
  if (atMs - nowMs < 6.5 * 24 * HOUR_MS) {
    return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
  }
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}
