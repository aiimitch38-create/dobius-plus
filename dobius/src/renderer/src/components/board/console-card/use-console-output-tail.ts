import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { useAppStore } from '@/store'
import { subscribeToPtyData } from '@/components/terminal-pane/pty-data-sidecar-subscriptions'
import {
  consoleScreenRuns,
  glanceBackoffMs,
  glancePollSkipReason,
  sameConsoleSnapshot,
  screenKey,
  type ConsoleScreen,
  type GlanceSnapshotIdentity
} from './console-output-tail'

/** Poll delay while the screen keeps changing (also the first backoff step). */
export const GLANCE_REFRESH_MS = 1000
/** Output just arrived for a backed-off card: re-read after this short settle. */
export const GLANCE_OUTPUT_WAKE_MS = 250
/** No poll while the board camera moved this recently; retried after the window. */
export const GLANCE_MOTION_QUIET_MS = 300

type Snapshot = { data: string; cols: number; rows: number; seq?: number }

export type GlanceTailCounters = {
  /** Snapshot IPCs issued. */
  polls: number
  /** Snapshots that were parsed through xterm (differed from the last one). */
  parses: number
  /** Snapshots identical to the last one (parse skipped). */
  unchanged: number
  /** Epoch ms when counting started, for per-minute rates. */
  since: number
}

/**
 * Per-pty poll counters, readable from DevTools as `window.__dobiusGlanceTail`.
 * Rate per card: polls / ((Date.now() - since) / 60000).
 */
export const glanceTailCounters = new Map<string, GlanceTailCounters>()
if (typeof window !== 'undefined') {
  ;(window as unknown as { __dobiusGlanceTail?: unknown }).__dobiusGlanceTail = glanceTailCounters
}

function countersFor(ptyId: string): GlanceTailCounters {
  let entry = glanceTailCounters.get(ptyId)
  if (!entry) {
    entry = { polls: 0, parses: 0, unchanged: 0, since: Date.now() }
    glanceTailCounters.set(ptyId, entry)
  }
  return entry
}

let lastBoardMotionAt = 0
let boardMotionTracked = false

/** Records a board camera move; glance polls hold off while the view is in flight. */
export function markBoardMotion(now: number = Date.now()): void {
  lastBoardMotionAt = now
}

// Why: one store listener for every glance card, instead of a viewport
// subscription per card that would re-render each miniature on every pan frame.
function trackBoardMotion(): void {
  if (boardMotionTracked) {
    return
  }
  boardMotionTracked = true
  useAppStore.subscribe((state, prev) => {
    const boards = state.boardsByWorktree
    const before = prev.boardsByWorktree
    if (boards === before) {
      return
    }
    for (const id in boards) {
      if (boards[id]?.viewport !== before[id]?.viewport) {
        markBoardMotion()
        return
      }
    }
  })
}

/**
 * Styled screen rows (colours, bold, ...) of a console while its card is a zoomed-out miniature.
 * Why the main-process snapshot: a card in glance mode has handed its pane
 * back to a hidden host, where background output can be dropped and restored
 * later, so the renderer xterm may be stale; main's headless copy is not.
 * Why an unopened xterm: the snapshot is ANSI (cursor moves, alt screen), and
 * only an emulator turns it into the rows a user would see. It never renders.
 *
 * Polling is adaptive: 1 s while the screen changes, backing off to 10 s once
 * it stops; an identical snapshot is never re-parsed; nothing polls while the
 * document is hidden, while the camera is moving, or once an unfocused window
 * has gone idle. PTY output, focus and visibility wake a sleeping card.
 */
export function useConsoleOutputTail(ptyId: string | null, enabled: boolean): ConsoleScreen | null {
  const [screen, setScreen] = useState<ConsoleScreen | null>(null)
  // Why refs: the parser and the last-seen keys survive enable/disable flips
  // (a card scrolled off and back on screen) so no xterm is rebuilt and no
  // unchanged screen is re-parsed or re-rendered.
  const parserRef = useRef<Terminal | null>(null)
  const lastSnapshotRef = useRef<GlanceSnapshotIdentity | null>(null)
  const lastScreenKeyRef = useRef('')

  useEffect(() => {
    lastSnapshotRef.current = null
    lastScreenKeyRef.current = ''
    return () => {
      parserRef.current?.dispose()
      parserRef.current = null
      // Why: the counters map is keyed by pty and would otherwise grow for every console ever glanced.
      if (ptyId) {
        glanceTailCounters.delete(ptyId)
      }
    }
  }, [ptyId])

  useEffect(() => {
    if (!enabled || !ptyId) {
      return
    }
    trackBoardMotion()
    const counters = countersFor(ptyId)
    let cancelled = false
    let inFlight = false
    let asleep = false
    let unchangedStreak = 0
    let outputPending = false
    let timer: number | undefined
    let dueAt = Infinity

    const parse = (snap: Snapshot): Promise<ConsoleScreen> =>
      new Promise((resolve) => {
        const cols = Math.max(2, snap.cols)
        const rows = Math.max(1, snap.rows)
        let parser = parserRef.current
        if (!parser) {
          parser = new Terminal({ cols, rows, scrollback: 0 })
          parserRef.current = parser
        } else if (parser.cols !== cols || parser.rows !== rows) {
          parser.resize(cols, rows)
        }
        const term = parser
        term.reset()
        term.write(snap.data, () =>
          resolve({ cols, rows, lines: consoleScreenRuns(term.buffer.active, cols) })
        )
      })

    const schedule = (delayMs: number): void => {
      window.clearTimeout(timer)
      dueAt = Date.now() + delayMs
      timer = window.setTimeout(tick, delayMs)
    }

    const tick = (): void => {
      if (cancelled) {
        return
      }
      dueAt = Infinity
      if (inFlight) {
        schedule(GLANCE_REFRESH_MS)
        return
      }
      const skip = glancePollSkipReason(
        {
          hidden: document.visibilityState === 'hidden',
          focused: document.hasFocus(),
          unchangedStreak,
          sinceMotionMs: Date.now() - lastBoardMotionAt
        },
        GLANCE_MOTION_QUIET_MS
      )
      if (skip === 'moving') {
        schedule(GLANCE_MOTION_QUIET_MS)
        return
      }
      if (skip) {
        asleep = true
        return
      }
      inFlight = true
      outputPending = false
      counters.polls += 1
      window.api.pty
        .getMainBufferSnapshot(ptyId, { scrollbackRows: 0 })
        .then((snap) => {
          if (cancelled || !snap) {
            return
          }
          if (sameConsoleSnapshot(lastSnapshotRef.current, snap)) {
            unchangedStreak += 1
            counters.unchanged += 1
            return
          }
          lastSnapshotRef.current = {
            data: snap.data,
            cols: snap.cols,
            rows: snap.rows,
            seq: snap.seq
          }
          unchangedStreak = 0
          counters.parses += 1
          return parse(snap).then((next) => {
            if (cancelled) {
              return
            }
            const key = screenKey(next)
            if (key !== lastScreenKeyRef.current) {
              lastScreenKeyRef.current = key
              setScreen(next)
            }
          })
        })
        .catch((error: unknown) => console.debug('[board-console] glance tail failed', error))
        .finally(() => {
          inFlight = false
          if (!cancelled) {
            schedule(outputPending ? GLANCE_OUTPUT_WAKE_MS : glanceBackoffMs(unchangedStreak))
          }
        })
    }

    const wake = (): void => {
      if (!cancelled && !inFlight && asleep) {
        asleep = false
        tick()
      }
    }

    // Why: new output is the one signal that a backed-off or sleeping card
    // must re-read soon. A card already polling every second is left alone so
    // a chatty TUI cannot pull the cadence below GLANCE_REFRESH_MS.
    const onOutput = (): void => {
      if (cancelled) {
        return
      }
      const backedOff = unchangedStreak > 0
      unchangedStreak = 0
      outputPending = true
      if (inFlight) {
        return
      }
      if (asleep) {
        asleep = false
        schedule(GLANCE_OUTPUT_WAKE_MS)
        return
      }
      if (backedOff && dueAt - Date.now() > GLANCE_OUTPUT_WAKE_MS) {
        schedule(GLANCE_OUTPUT_WAKE_MS)
      }
    }

    const unsubscribeOutput = subscribeToPtyData(ptyId, onOutput)
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)

    // Why: a random phase per card spreads many glance polls across the second
    // instead of one IPC burst; the very first read of a card is immediate.
    schedule(lastSnapshotRef.current ? Math.random() * GLANCE_REFRESH_MS : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      unsubscribeOutput()
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [enabled, ptyId])

  return screen
}
