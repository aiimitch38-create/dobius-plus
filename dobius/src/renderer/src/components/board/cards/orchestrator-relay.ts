import type { BoardState } from '@/store/slices/board'
import type { OrchestratorMessage } from './OrchestratorCard'

// Pure helpers for the orchestrator card's relay over orchestration messaging.

/** The card's own mailbox handle; replies to its messages land here. */
export function orchestratorHandle(cardId: string): string {
  return `board-orchestrator:${cardId}`
}

/** Tab ids of wired cards that are still consoles on this board. */
export function wiredConsoleTabIds(board: BoardState, wiredCardIds: readonly string[]): string[] {
  const wired = new Set(wiredCardIds)
  return board.cards.flatMap((c) => (c.kind === 'console' && wired.has(c.id) ? [c.tabId] : []))
}

/** Subject line for the message list: the first line, bounded. */
export function relaySubject(text: string): string {
  const first = text.trim().split('\n')[0] ?? ''
  return first.length > 80 ? `${first.slice(0, 79)}…` : first
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
