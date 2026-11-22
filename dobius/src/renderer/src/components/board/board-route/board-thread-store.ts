import type { BoardThreadMessage } from '../board-command-bar/BoardThread'
import {
  ADAM_THREAD_STORAGE_KEY,
  deserializeBoardThread,
  serializeBoardThread
} from './board-thread-persistence'

// ADAM has one thread, shown on every project's Board. This is the one place
// that adds a row to it, whether or not a Board is on screen: a late reply or
// a voice turn must still land in the thread.

/** Best-effort: a storage failure (private window, quota, hardened context) must never break the thread. */
export function readStoredThread(): BoardThreadMessage[] {
  try {
    return deserializeBoardThread(window.localStorage.getItem(ADAM_THREAD_STORAGE_KEY))
  } catch {
    return []
  }
}

export function writeStoredThread(messages: BoardThreadMessage[]): void {
  try {
    window.localStorage.setItem(ADAM_THREAD_STORAGE_KEY, serializeBoardThread(messages))
  } catch {
    // Storage can be unavailable or full; the in-memory thread still works this session.
  }
}

type Taker = (row: BoardThreadMessage) => void
const takers = new Set<Taker>()

/** A mounted thread registers here and then owns saving the rows it is handed. */
export function onBoardThreadAppend(taker: Taker): () => void {
  takers.add(taker)
  return () => {
    takers.delete(taker)
  }
}

/** `id` makes a row safe to add twice (one turn announced to more than one window). */
export function appendToBoardThread(
  message: Omit<BoardThreadMessage, 'id'>,
  id: string = crypto.randomUUID()
): void {
  const row = { ...message, id }
  if (takers.size > 0) {
    takers.forEach((taker) => taker(row))
    return
  }
  const stored = readStoredThread()
  if (!stored.some((existing) => existing.id === id)) {
    writeStoredThread([...stored, row])
  }
}
