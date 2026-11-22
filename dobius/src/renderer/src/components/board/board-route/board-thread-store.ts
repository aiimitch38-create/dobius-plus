import type { AdamThreadRow } from '../../../../../shared/speech-types'
import type { BoardThreadMessage } from '../board-command-bar/BoardThread'
import { deserializeBoardThread } from './board-thread-persistence'

// ADAM has one thread, shown on every project's Board. The main process owns
// it: a window asks main to add a row and is sent the whole thread back, so
// two windows can never overwrite each other's rows, and a late reply or a
// voice turn is kept whether or not a Board is on screen.

/** Rows as main sent them, checked before they are shown. */
export function threadFromMain(rows: unknown): BoardThreadMessage[] {
  return deserializeBoardThread(JSON.stringify(rows ?? []))
}

/** `id` makes a row safe to send twice (main adds a given id once). */
export function appendToBoardThread(
  message: Omit<BoardThreadMessage, 'id'>,
  id: string = crypto.randomUUID()
): void {
  // Only what can be saved crosses to main (no buttons, no waiting rows).
  const { role, text, tone, report, voice } = message
  const row = JSON.parse(JSON.stringify({ id, role, text, tone, report, voice })) as AdamThreadRow
  void window.api.jarvis.adamThreadAppend(row).catch((error: unknown) => {
    console.warn('ADAM thread row could not be saved:', error)
  })
}
