import { execFile } from 'node:child_process'

// Board "Pause all" suspends the agent running in a terminal, not the shell.
// The agent is the terminal's foreground job, so these pseudo-signals stop or
// continue that whole process group (agent plus its children).
//
// Why the bookkeeping: once a foreground job is stopped, the interactive shell
// takes the terminal back. On resume there is no foreground job to look up any
// more, and SIGCONT alone leaves the agent running in the BACKGROUND (typed
// text would hit the shell). So pause records the stopped group, and resume
// continues that exact group and hands it the terminal again with the shell's
// own `fg` (verified on a real zsh -i pty).

export const FOREGROUND_SIGNALS: Readonly<Record<string, 'SIGSTOP' | 'SIGCONT'>> = {
  SIGSTOP_FOREGROUND: 'SIGSTOP',
  SIGCONT_FOREGROUND: 'SIGCONT'
}

export function isForegroundSignal(signal: string): boolean {
  return signal in FOREGROUND_SIGNALS
}

/** The terminal's foreground process group for a shell pid (POSIX `ps -o tpgid`). */
export function readForegroundGroup(shellPid: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-o', 'tpgid=', '-p', String(shellPid)],
      { timeout: 2_000 },
      (error, stdout) => {
        const pgid = error ? Number.NaN : Number(stdout.trim())
        resolve(Number.isInteger(pgid) && pgid > 1 ? pgid : null)
      }
    )
  })
}

export type ForegroundSignalDeps = {
  readGroup?: (shellPid: number) => Promise<number | null>
  kill?: (pid: number, sig: string) => void
  /** Writes to the terminal (used to send `fg` to the shell on resume). */
  write: (data: string) => void
}

export type ForegroundSignalResult =
  | 'signalled'
  | 'unsupported'
  | 'no-foreground-job'
  | 'not-paused'

/** shell pid -> process group we stopped in that terminal. */
const stoppedGroups = new Map<number, number>()
let exitHookInstalled = false

function installExitHook(kill: (pid: number, sig: string) => void): void {
  if (exitHookInstalled) {
    return
  }
  exitHookInstalled = true
  // Why: a paused agent must never outlive the app frozen.
  process.on('exit', () => continueAllStoppedGroups(kill))
}

/** Continues every group the Board stopped (app quit, Board teardown). */
export function continueAllStoppedGroups(
  kill: (pid: number, sig: string) => void = (pid, sig) => process.kill(pid, sig)
): number {
  let n = 0
  for (const pgid of stoppedGroups.values()) {
    try {
      kill(-pgid, 'SIGCONT')
      n += 1
    } catch {
      // Already gone; nothing left to continue.
    }
  }
  stoppedGroups.clear()
  return n
}

export async function signalForegroundProcessGroup(
  shellPid: number,
  signal: string,
  deps: ForegroundSignalDeps
): Promise<ForegroundSignalResult> {
  const real = FOREGROUND_SIGNALS[signal]
  if (!real || process.platform === 'win32') {
    return 'unsupported'
  }
  const readGroup = deps.readGroup ?? readForegroundGroup
  const kill = deps.kill ?? ((pid: number, sig: string) => process.kill(pid, sig))
  if (real === 'SIGSTOP') {
    const pgid = await readGroup(shellPid)
    // The shell itself in the foreground means no agent is running: never freeze a bare prompt.
    if (pgid === null || pgid === shellPid) {
      return 'no-foreground-job'
    }
    installExitHook(kill)
    kill(-pgid, 'SIGSTOP')
    stoppedGroups.set(shellPid, pgid)
    return 'signalled'
  }
  const pgid = stoppedGroups.get(shellPid)
  if (pgid === undefined) {
    return 'not-paused'
  }
  stoppedGroups.delete(shellPid)
  kill(-pgid, 'SIGCONT')
  // Only type `fg` when the shell owns the terminal (it took it back on stop).
  if ((await readGroup(shellPid)) === shellPid) {
    deps.write('fg\r')
  }
  return 'signalled'
}

export function isGroupStoppedForShell(shellPid: number): boolean {
  return stoppedGroups.has(shellPid)
}

export function resetStoppedGroupsForTest(): void {
  stoppedGroups.clear()
}
