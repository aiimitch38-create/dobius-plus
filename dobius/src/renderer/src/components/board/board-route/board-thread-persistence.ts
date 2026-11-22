import type { BoardThreadMessage } from '../board-command-bar/BoardThread'

// Why: ADAM's thread persists across projects and restarts but must never grow unbounded, carry closures
// (`action.onClick`), or resurrect a "thinking" placeholder on reload.
export const BOARD_THREAD_HISTORY_CAP = 200

// ADAM has one thread for every project, kept by the main process (adam-thread-store.ts).
// The older per-project threads in this window's storage (`dobius.board.thread.v1.<repoId>`)
// are left untouched and are no longer shown.

/** Only the fields that can round-trip through JSON; drops action callbacks and transient rows. */
export type PersistedBoardThreadMessage = Pick<
  BoardThreadMessage,
  'id' | 'role' | 'text' | 'tone' | 'report' | 'voice'
>

export function serializeBoardThread(messages: readonly BoardThreadMessage[]): string {
  const persistable: PersistedBoardThreadMessage[] = messages
    .filter((message) => !message.transient)
    .map(({ id, role, text, tone, report, voice }) => ({ id, role, text, tone, report, voice }))
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
