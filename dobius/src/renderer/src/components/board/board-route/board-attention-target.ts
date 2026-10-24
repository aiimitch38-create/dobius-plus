// Pure lookup for "jump to the console that needs you" — same unacknowledged
// waiting/blocked rule as boardConsoleActivity's needsYou count, but resolved
// down to a single card (and its on-canvas center) instead of a tally.
import type { BoardActivityInput } from './board-console-activity'

export type BoardAttentionConsole = {
  id: string
  tabId: string
  x: number
  y: number
  w: number
  h: number
}

export type BoardAttentionTarget = {
  cardId: string
  center: { x: number; y: number }
}

/**
 * Every console needing the user, longest-waiting first (by the smallest
 * stateStartedAt among its fresh, unacknowledged waiting/blocked panes).
 */
export function boardAttentionTargets(
  consoles: readonly BoardAttentionConsole[],
  input: BoardActivityInput
): BoardAttentionTarget[] {
  const found: (BoardAttentionTarget & { stateStartedAt: number })[] = []

  for (const console of consoles) {
    const prefix = `${console.tabId}:`
    let earliestStart: number | null = null

    for (const [paneKey, entry] of Object.entries(input.agentStatusByPaneKey)) {
      if (!paneKey.startsWith(prefix)) {
        continue
      }
      if (input.now - entry.updatedAt > input.staleAfterMs) {
        continue
      }
      if (entry.state !== 'waiting' && entry.state !== 'blocked') {
        continue
      }
      const ackAt = input.acknowledgedAgentsByPaneKey[entry.paneKey] ?? 0
      if (ackAt >= entry.stateStartedAt) {
        continue
      }
      if (earliestStart === null || entry.stateStartedAt < earliestStart) {
        earliestStart = entry.stateStartedAt
      }
    }

    if (earliestStart !== null) {
      found.push({
        cardId: console.id,
        center: { x: console.x + console.w / 2, y: console.y + console.h / 2 },
        stateStartedAt: earliestStart
      })
    }
  }

  return found
    .sort((a, b) => a.stateStartedAt - b.stateStartedAt)
    .map(({ cardId, center }) => ({ cardId, center }))
}

/** The console needing attention longest. Null when none qualify. */
export function boardAttentionTarget(
  consoles: readonly BoardAttentionConsole[],
  input: BoardActivityInput
): BoardAttentionTarget | null {
  return boardAttentionTargets(consoles, input)[0] ?? null
}
