// GitHub-style activity grid for the Board usage popover. Pure: dates in, cells out.

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4

export type HeatmapCell = {
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  total: number
  level: HeatmapLevel
  /** Days after the anchor date are drawn blank so the last column stays a full week. */
  future: boolean
}

export type HeatmapGrid = {
  /** One column per week, Sunday first, oldest week first. */
  weeks: HeatmapCell[][]
  max: number
}

export type HeatmapPoint = { day: string; total: number }

export const HEATMAP_WEEKS = 26

export function heatmapDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Same thresholds as the Stats daily-intensity grid, so both views agree on a day's shade. */
export function heatmapLevel(total: number, max: number): HeatmapLevel {
  if (total <= 0 || max <= 0) {
    return 0
  }
  const ratio = total / max
  if (ratio <= 0.25) {
    return 1
  }
  if (ratio <= 0.5) {
    return 2
  }
  if (ratio <= 0.75) {
    return 3
  }
  return 4
}

/**
 * Buckets daily totals into `weeks` columns of 7 (Sunday..Saturday) ending with
 * the week that holds `anchor`. Duplicate days are summed; missing days are 0.
 */
export function buildUsageHeatmap(
  points: readonly HeatmapPoint[],
  options: { weeks?: number; anchor?: Date } = {}
): HeatmapGrid {
  const weeks = Math.max(1, Math.floor(options.weeks ?? HEATMAP_WEEKS))
  const anchor = new Date(options.anchor ?? new Date())
  anchor.setHours(0, 0, 0, 0)
  const anchorKey = heatmapDayKey(anchor)

  const totals = new Map<string, number>()
  for (const point of points) {
    totals.set(point.day, (totals.get(point.day) ?? 0) + Math.max(0, point.total))
  }

  // Last column ends on the Saturday of the anchor's week.
  const end = new Date(anchor)
  end.setDate(anchor.getDate() + (6 - anchor.getDay()))
  const start = new Date(end)
  start.setDate(end.getDate() - weeks * 7 + 1)

  let max = 0
  const cursor = new Date(start)
  const days: Omit<HeatmapCell, 'level'>[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const day = heatmapDayKey(cursor)
    const future = day > anchorKey
    const total = future ? 0 : (totals.get(day) ?? 0)
    max = Math.max(max, total)
    days.push({ day, total, future })
    cursor.setDate(cursor.getDate() + 1)
  }

  const grid: HeatmapCell[][] = []
  for (let week = 0; week < weeks; week++) {
    grid.push(
      days
        .slice(week * 7, week * 7 + 7)
        .map((cell) => ({ ...cell, level: heatmapLevel(cell.total, max) }))
    )
  }
  return { weeks: grid, max }
}
