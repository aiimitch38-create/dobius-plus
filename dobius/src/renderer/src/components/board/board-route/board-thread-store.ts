import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
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
  void reportUnsaved(window.api.jarvis.adamThreadAppend(row))
}

/** Tells Carson when main could not write the thread to disk; it is still shown and is saved with the next change. */
export async function reportUnsaved(
  change: Promise<{ ok: boolean; error?: 'not-saved' }>
): Promise<void> {
  const unsaved = await change.then(
    (result) => result.error === 'not-saved',
    (error: unknown) => {
      console.warn('ADAM thread change did not reach the app:', error)
      return true
    }
  )
  if (unsaved) {
    toast.error(
      translate(
        'board.adam.threadNotSaved',
        'ADAM’s thread could not be saved to disk. It is still shown here, and Dobius+ will try again with the next message. If this keeps happening, check free disk space.'
      )
    )
  }
}
