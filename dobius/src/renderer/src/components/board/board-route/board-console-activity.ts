import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'

export type BoardConsoleState = 'working' | 'waiting' | 'blocked' | 'done' | 'idle'

export type BoardActivityInput = {
  agentStatusByPaneKey: Readonly<Record<string, AgentStatusEntry>>
  acknowledgedAgentsByPaneKey: Readonly<Record<string, number>>
  now: number
  staleAfterMs: number
}

const STATE_RANK: Record<BoardConsoleState, number> = {
  blocked: 4,
  waiting: 3,
  working: 2,
  done: 1,
  idle: 0
}

// Why: paneKey is `${tabId}:${leafId}`; a console card shows a whole tab, so
// every fresh pane in that tab counts toward the card.
function freshEntriesForTab(tabId: string, input: BoardActivityInput): AgentStatusEntry[] {
  const prefix = `${tabId}:`
  return Object.entries(input.agentStatusByPaneKey)
    .filter(
      ([paneKey, entry]) =>
        paneKey.startsWith(prefix) && input.now - entry.updatedAt <= input.staleAfterMs
    )
    .map(([, entry]) => entry)
}

/** The most urgent fresh state across a tab's panes; idle when nothing fresh reported. */
export function boardConsoleState(tabId: string, input: BoardActivityInput): BoardConsoleState {
  let best: BoardConsoleState = 'idle'
  for (const entry of freshEntriesForTab(tabId, input)) {
    if (STATE_RANK[entry.state] > STATE_RANK[best]) {
      best = entry.state
    }
  }
  return best
}

/**
 * live = consoles with an agent working or waiting on the user (blocked included).
 * needsYou = waiting/blocked panes the user hasn't looked at since the state began,
 * using the same acknowledgement rule as the sidebar agent rows.
 */
export function boardConsoleActivity(
  tabIds: readonly string[],
  input: BoardActivityInput
): { live: number; needsYou: number } {
  let live = 0
  let needsYou = 0
  for (const tabId of tabIds) {
    const entries = freshEntriesForTab(tabId, input)
    if (
      entries.some((e) => e.state === 'working' || e.state === 'waiting' || e.state === 'blocked')
    ) {
      live += 1
    }
    if (
      entries.some(
        (e) =>
          (e.state === 'waiting' || e.state === 'blocked') &&
          (input.acknowledgedAgentsByPaneKey[e.paneKey] ?? 0) < e.stateStartedAt
      )
    ) {
      needsYou += 1
    }
  }
  return { live, needsYou }
}
