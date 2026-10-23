import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isShellProcessName } from '../console-card/console-card-status'
import { isConsolePaused, markConsolePaused, pausedConsoleIds } from './board-pause'

// Pause/resume = suspend/continue the agent process in each console's
// terminal (SIGSTOP/SIGCONT on the terminal's foreground job, local, daemon and
// SSH alike). Windows has no job-control signals, so it says so instead.

export type PauseResult = {
  changed: string[]
  /** No agent in the foreground (bare shell) or no terminal at all. */
  notRunning: string[]
  /** The signal was sent but the terminal did not change as expected. */
  failed: string[]
  unsupported: boolean
}

const SETTLE_MS = 400

export function pauseSupported(userAgent: string = navigator.userAgent): boolean {
  return !/Windows/i.test(userAgent)
}

async function foregroundIsShell(ptyId: string): Promise<boolean | null> {
  try {
    const name = await window.api.pty.getForegroundProcess(ptyId)
    return name === null ? null : isShellProcessName(name)
  } catch {
    return null
  }
}

/**
 * Why verify: the signal IPC is fire-and-forget. A stopped job hands the
 * terminal back to the shell, so "foreground is the shell" after a pause (and
 * "foreground is the agent" after a resume) is the proof it worked. A console
 * is only marked paused once that proof is in.
 */
export async function setConsolesPaused(
  consoles: readonly { tabId: string; name: string }[],
  paused: boolean,
  opts: { userAgent?: string; settleMs?: number } = {}
): Promise<PauseResult> {
  const result: PauseResult = { changed: [], notRunning: [], failed: [], unsupported: false }
  if (!pauseSupported(opts.userAgent)) {
    return { ...result, unsupported: true }
  }
  const settle = opts.settleMs ?? SETTLE_MS
  const ptyIdsByTabId = useAppStore.getState().ptyIdsByTabId
  await Promise.all(
    consoles.map(async (c) => {
      const ptyId = ptyIdsByTabId[c.tabId]?.[0]
      if (!ptyId) {
        result.notRunning.push(c.name)
        return
      }
      if (paused && (isConsolePaused(c.tabId) || (await foregroundIsShell(ptyId)) !== false)) {
        // Already paused, or nothing but a shell to pause.
        if (!isConsolePaused(c.tabId)) {
          result.notRunning.push(c.name)
        }
        return
      }
      if (!paused && !isConsolePaused(c.tabId)) {
        return
      }
      window.api.pty.signal(ptyId, paused ? 'SIGSTOP_FOREGROUND' : 'SIGCONT_FOREGROUND')
      await new Promise((resolve) => setTimeout(resolve, settle))
      const shellNow = await foregroundIsShell(ptyId)
      const worked = paused ? shellNow === true : shellNow === false
      if (worked) {
        markConsolePaused(c.tabId, paused)
        result.changed.push(c.name)
      } else {
        result.failed.push(c.name)
      }
    })
  )
  return result
}

/** Resumes every console this window paused (Board teardown must not leave agents frozen). */
export async function resumeAllPausedConsoles(): Promise<void> {
  const ids = [...pausedConsoleIds()]
  if (ids.length > 0) {
    await setConsolesPaused(
      ids.map((tabId) => ({ tabId, name: tabId })),
      false
    )
  }
}

export function pauseResultText(
  result: PauseResult,
  paused: boolean
): { ok: boolean; text: string } {
  if (result.unsupported) {
    return {
      ok: false,
      text: translate('board.pause.windows', 'Pausing live agents is not available on Windows yet.')
    }
  }
  const parts: string[] = []
  if (result.changed.length > 0) {
    parts.push(
      paused
        ? translate('board.pause.paused', 'Paused {{names}}.', { names: result.changed.join(', ') })
        : translate('board.pause.resumed', 'Resumed {{names}}.', {
            names: result.changed.join(', ')
          })
    )
  }
  if (result.failed.length > 0) {
    parts.push(
      paused
        ? translate('board.pause.failedPause', 'Could not pause {{names}}.', {
            names: result.failed.join(', ')
          })
        : translate(
            'board.pause.failedResume',
            'Could not resume {{names}}; restart them if they stay frozen.',
            {
              names: result.failed.join(', ')
            }
          )
    )
  }
  if (parts.length === 0) {
    parts.push(translate('board.pause.none', 'No running console to change.'))
  }
  return { ok: result.changed.length > 0 && result.failed.length === 0, text: parts.join(' ') }
}
