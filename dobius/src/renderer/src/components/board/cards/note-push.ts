import { activeAgentNotesSendFailureMessage } from '@/lib/active-agent-note-send-result'
import { useAppStore } from '@/store'
import { getBoard, type BoardState } from '@/store/slices/board'
import { deliverOrder } from '../board-delivery/board-delivery'

export type NotePushTarget = { cardId: string; tabId: string; title: string }

export function notePushTargets(board: BoardState): NotePushTarget[] {
  return board.cards.flatMap((c) =>
    c.kind === 'console' ? [{ cardId: c.id, tabId: c.tabId, title: c.title }] : []
  )
}

/**
 * Delivers a note to one chosen console through the Board delivery queue (so it
 * waits on dialogs, never interleaves with other sends, and gets a mission row).
 * Returns null on success, else a message for the user.
 */
export async function pushNoteToConsole(
  worktreeId: string,
  tabId: string,
  text: string
): Promise<string | null> {
  const card = getBoard(useAppStore.getState(), worktreeId).cards.find(
    (c) => c.kind === 'console' && c.tabId === tabId
  )
  if (!card) {
    return activeAgentNotesSendFailureMessage('no-active-terminal', { explicitTarget: true })
  }
  const result = await deliverOrder({
    worktreeId,
    summary: text,
    lanes: [{ tabId, name: card.title, text }]
  })
  return result.ok ? null : result.text
}
