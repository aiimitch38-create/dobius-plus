import type { BoardThreadMessage } from './BoardThread'

export const BOARD_COMMAND_HISTORY_CAP = 50

// Why: every sent command is already appended to the per-repo thread as a
// `user` row (mention relay, planner, conductor), and that thread is persisted
// per repo. Deriving history from it keeps one source of truth instead of a
// second store that could drift from what the thread shows.
export function boardCommandHistory(
  messages: readonly Pick<BoardThreadMessage, 'role' | 'text' | 'transient'>[],
  cap: number = BOARD_COMMAND_HISTORY_CAP
): string[] {
  const history: string[] = []
  for (const message of messages) {
    if (message.role !== 'user' || message.transient) {
      continue
    }
    const text = message.text.trim()
    // Repeating the same order twice in a row should cost one Up press, not two.
    if (!text || history.at(-1) === text) {
      continue
    }
    history.push(text)
  }
  return history.slice(-cap)
}

/** `index` is null while editing the live draft; otherwise it points into `history`. */
export type BoardCommandHistoryCursor = {
  index: number | null
  /** The unsent draft saved on the first Up, restored when Down walks past the newest entry. */
  draft: string
}

export type BoardCommandHistoryStep = {
  cursor: BoardCommandHistoryCursor
  /** Text to show in the input, or null when the key should do nothing. */
  text: string | null
}

export function stepBoardCommandHistory(
  history: readonly string[],
  cursor: BoardCommandHistoryCursor,
  direction: 'up' | 'down',
  currentDraft: string
): BoardCommandHistoryStep {
  if (direction === 'up') {
    if (history.length === 0) {
      return { cursor, text: null }
    }
    if (cursor.index === null) {
      const index = history.length - 1
      return { cursor: { index, draft: currentDraft }, text: history[index] }
    }
    const index = Math.max(0, Math.min(cursor.index, history.length) - 1)
    return { cursor: { ...cursor, index }, text: history[index] }
  }
  if (cursor.index === null) {
    return { cursor, text: null }
  }
  const index = cursor.index + 1
  if (index >= history.length) {
    return { cursor: { index: null, draft: '' }, text: cursor.draft }
  }
  return { cursor: { ...cursor, index }, text: history[index] }
}
