/* Runs the board dispatcher for as long as a Dobius window is open.
 *
 * Renders nothing. Mounted once at the app root so a task assigned to an agent
 * gets picked up regardless of which page is showing — the board does not have
 * to be open, only the app.
 *
 * Gated on settings.vertexAutoModeEnabled: dispatch starts agent runs, which
 * cost money, with no click. */

import { useEffect } from 'react'

import { setBoardDispatchEnabled, startBoardDispatch, stopBoardDispatch } from './board-dispatch'

export function BoardDispatchGate({ enabled }: { enabled: boolean }): null {
  useEffect(() => {
    setBoardDispatchEnabled(enabled)
    if (!enabled) {
      stopBoardDispatch()
      return
    }
    return startBoardDispatch()
  }, [enabled])

  return null
}
