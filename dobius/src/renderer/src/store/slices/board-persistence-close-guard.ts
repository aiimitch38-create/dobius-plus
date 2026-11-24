import { flushBoardPersistence } from './board-persistence'

// ponytail: 2 s cap on holding a window close for a board write still in flight.
export const BOARD_CLOSE_FLUSH_TIMEOUT_MS = 2_000

/**
 * Window-close guard: lands a debounced or queued board write before the
 * renderer goes away. Why: a write queued behind an in-flight one lives only
 * here until main acks it, and the sync shutdown save covers the session, not
 * boards. Never vetoes the close; a refused or slow write is only logged.
 */
export async function flushBoardsBeforeClose(
  timeoutMs = BOARD_CLOSE_FLUSH_TIMEOUT_MS
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  try {
    if ((await Promise.race([flushBoardPersistence(), timedOut])) === 'timeout') {
      console.warn(`[board] board save still pending after ${timeoutMs} ms; closing anyway`)
    }
  } catch (error) {
    console.warn('[board] board save before close failed', error)
  } finally {
    clearTimeout(timer)
  }
  return true
}
