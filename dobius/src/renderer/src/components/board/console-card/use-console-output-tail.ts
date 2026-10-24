import { useEffect, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { consoleTailLines, sameLines } from './console-output-tail'

export const GLANCE_REFRESH_MS = 1000

type Snapshot = { data: string; cols: number; rows: number }

/**
 * Plain-text tail of a console's screen while its card is a zoomed-out glance.
 * Why the main-process snapshot: a card in glance mode has handed its pane
 * back to a hidden host, where background output can be dropped and restored
 * later, so the renderer xterm may be stale; main's headless copy is not.
 * Why an unopened xterm: the snapshot is ANSI (cursor moves, alt screen), and
 * only an emulator turns it into the rows a user would see. It never renders.
 */
export function useConsoleOutputTail(ptyId: string | null, enabled: boolean): string[] | null {
  const [lines, setLines] = useState<string[] | null>(null)

  useEffect(() => {
    if (!enabled || !ptyId) {
      return
    }
    let cancelled = false
    let inFlight = false
    let parser: Terminal | null = null

    const parse = (snap: Snapshot): Promise<string[]> =>
      new Promise((resolve) => {
        const cols = Math.max(2, snap.cols)
        const rows = Math.max(1, snap.rows)
        if (!parser) {
          parser = new Terminal({ cols, rows, scrollback: 0 })
        } else if (parser.cols !== cols || parser.rows !== rows) {
          parser.resize(cols, rows)
        }
        const term = parser
        term.reset()
        term.write(snap.data, () => resolve(consoleTailLines(term.buffer.active)))
      })

    const tick = (): void => {
      if (inFlight || document.visibilityState === 'hidden') {
        return
      }
      inFlight = true
      window.api.pty
        .getMainBufferSnapshot(ptyId, { scrollbackRows: 0 })
        .then((snap) => (snap && !cancelled ? parse(snap) : null))
        .then((next) => {
          if (!cancelled && next) {
            setLines((prev) => (sameLines(prev, next) ? prev : next))
          }
        })
        .catch((error: unknown) => console.debug('[board-console] glance tail failed', error))
        .finally(() => {
          inFlight = false
        })
    }

    tick()
    // Why: a random phase per card spreads many glance polls across the second instead of one IPC burst.
    let timer: number | undefined
    const phase = window.setTimeout(() => {
      timer = window.setInterval(tick, GLANCE_REFRESH_MS)
    }, Math.random() * GLANCE_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearTimeout(phase)
      window.clearInterval(timer)
      parser?.dispose()
    }
  }, [enabled, ptyId])

  return lines
}
