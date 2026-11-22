import type { BoardThreadMessage } from '../board-command-bar/BoardThread'
import {
  boardThreadStorageKey,
  deserializeBoardThread,
  serializeBoardThread
} from './board-thread-persistence'

// One place that adds a row to a repo's Board thread, whether or not the Board
// is on screen: a late ADAM reply or a voice turn must still land in its thread.

/** Best-effort: a storage failure (private window, quota, hardened context) must never break the thread. */
export function readStoredThread(repoId: string | null): BoardThreadMessage[] {
  if (!repoId) {
    return []
  }
  try {
    return deserializeBoardThread(window.localStorage.getItem(boardThreadStorageKey(repoId)))
  } catch {
    return []
  }
}

export function writeStoredThread(repoId: string | null, messages: BoardThreadMessage[]): void {
  if (!repoId) {
    return
  }
  try {
    window.localStorage.setItem(boardThreadStorageKey(repoId), serializeBoardThread(messages))
  } catch {
    // Storage can be unavailable or full; the in-memory thread still works this session.
  }
}

type Taker = (repoId: string | null, row: BoardThreadMessage) => boolean
const takers = new Set<Taker>()

/** The mounted thread registers here; returning true means "I show this repo, I have it". */
export function onBoardThreadAppend(taker: Taker): () => void {
  takers.add(taker)
  return () => {
    takers.delete(taker)
  }
}

export function appendToBoardThread(
  repoId: string | null,
  message: Omit<BoardThreadMessage, 'id'>
): void {
  const row = { ...message, id: crypto.randomUUID() }
  for (const taker of takers) {
    if (taker(repoId, row)) {
      return
    }
  }
  writeStoredThread(repoId, [...readStoredThread(repoId), row])
}
