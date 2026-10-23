import type { BoardThreadMessage } from '../board-command-bar/BoardThread'

// Why: per-repo thread history persists across tab switches within that repo
// (DEEP-BEHAVIOR-SPEC §4) but must never grow unbounded, carry closures
// (`action.onClick`), or resurrect a "thinking" placeholder on reload.
export const BOARD_THREAD_HISTORY_CAP = 200

export function boardThreadStorageKey(repoId: string): string {
  return `dobius.board.thread.v1.${repoId}`
}

/** Only the fields that can round-trip through JSON; drops action callbacks and transient rows. */
export type PersistedBoardThreadMessage = Pick<
  BoardThreadMessage,
  'id' | 'role' | 'text' | 'tone' | 'report'
>

export function serializeBoardThread(messages: readonly BoardThreadMessage[]): string {
  const persistable: PersistedBoardThreadMessage[] = messages
    .filter((message) => !message.transient)
    .map(({ id, role, text, tone, report }) => ({ id, role, text, tone, report }))
    .slice(-BOARD_THREAD_HISTORY_CAP)
  return JSON.stringify(persistable)
}

function isPersistedBoardThreadMessage(value: unknown): value is PersistedBoardThreadMessage {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.text === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant' || candidate.role === 'system')
  )
}

/** Never throws: corrupt/missing JSON (or a non-array payload) returns an empty thread. */
export function deserializeBoardThread(raw: string | null): BoardThreadMessage[] {
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isPersistedBoardThreadMessage)
  } catch {
    return []
  }
}
