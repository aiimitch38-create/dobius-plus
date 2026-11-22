import type { BoardState } from '@/store/slices/board'
import { wiredConsoleTabIds as wiredTabIdsOf } from '../../../../../shared/board-orchestrator-relay'
import type { OrchestratorMessage } from './OrchestratorCard'

// Pure helpers for the orchestrator card's relay over orchestration messaging.
// Routing and fan-out live in shared/ so `orchestration send --to board:<id>` matches the card.
export {
  orchestratorHandle,
  orchestratorRelayRecipients,
  relaySubject,
  relayThreadId,
  wiredScopedConsoles
} from '../../../../../shared/board-orchestrator-relay'

/** Tab ids of wired cards that are still consoles on this board. */
export function wiredConsoleTabIds(board: BoardState, wiredCardIds: readonly string[]): string[] {
  return wiredTabIdsOf(board.cards, wiredCardIds)
}

export type InboxRow = { id: string; from_handle: string; body: string; subject: string }

/** Replies addressed to the card, labeled with the sending console's title when known. */
export function inboxToThread(
  rows: readonly InboxRow[],
  titleByHandle: ReadonlyMap<string, string>
): OrchestratorMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: 'orchestrator' as const,
    author: titleByHandle.get(row.from_handle) ?? row.from_handle,
    text: row.body.trim() || row.subject
  }))
}
