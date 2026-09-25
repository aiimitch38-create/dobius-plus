/* Date helpers for the Timeline and Calendar views.
 *
 * Split out of KanbanBoard.tsx only so the local-midnight parse below can be
 * tested without mounting the board. */

export const DAY_MS = 86_400_000

/** Day-precision ISO ('2026-09-12') parsed at LOCAL midnight. `new Date(iso)`
 *  would read it as UTC and land on the previous day west of Greenwich, which
 *  puts a task on the wrong calendar cell. */
export function parseDueDate(iso: string | undefined): number | null {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  if (!match) {
    return null
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
}

export function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
