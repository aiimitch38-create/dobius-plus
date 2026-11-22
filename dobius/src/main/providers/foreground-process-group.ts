import { execFile } from 'node:child_process'

// Board "Pause all" suspends the agent running in a terminal, not the shell.
// The agent is the terminal's foreground job, so these pseudo-signals stop or
// continue that whole process group (agent plus its children).
//
// Why the bookkeeping: once a foreground job is stopped, the interactive shell
// takes the terminal back. On resume there is no foreground job to look up any
// more, so pause records the stopped group AND the group that took the terminal
// (the shell).
//
// Why the shell is observed, never assumed to be the pty's own pid: on macOS the
// pty child is `/usr/bin/login`, and the shell is its child with a different
// pid. Comparing against the pty pid made resume skip `fg` every time.
//
// Why resume goes through the shell's own `fg`: a SIGCONT sent while the shell
// still owns the terminal wakes the agent in the BACKGROUND. A full-screen agent
// that touches the terminal there is stopped again by the kernel
// (SIGTTIN/SIGTTOU), so it stays frozen. `fg` hands the terminal over first and
// then continues the job. The record is kept until the agent really owns the
// terminal again, so a failed resume can be retried.

export const FOREGROUND_SIGNALS: Readonly<Record<string, 'SIGSTOP' | 'SIGCONT'>> = {
  SIGSTOP_FOREGROUND: 'SIGSTOP',
  SIGCONT_FOREGROUND: 'SIGCONT'
}

export function isForegroundSignal(signal: string): boolean {
  return signal in FOREGROUND_SIGNALS
}

/** The foreground process group of the terminal a pid lives in (POSIX `ps -o tpgid`). */
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
  /** How long to wait for the terminal to change hands after a pause or resume. */
  handoffTimeoutMs?: number
  handoffPollMs?: number
}

export type ForegroundSignalResult =
  | 'signalled'
  | 'unsupported'
  | 'no-foreground-job'
  | 'not-paused'
  /** Resume could not give the agent the terminal back; it is still paused and can be retried. */
  | 'handoff-failed'

// Ctrl-U first: anything already sitting on the shell's prompt line (stray
// keystrokes, terminal replies) would otherwise be glued onto `fg`.
const SHELL_FOREGROUND_COMMAND = '\x15fg\r'
const HANDOFF_TIMEOUT_MS = 2_000
const HANDOFF_POLL_MS = 50

type StoppedJob = {
  /** The agent's process group, which we stopped. */
  job: number
  /** The group that took the terminal back when the agent stopped (the shell). */
  shell: number
}

/** pty pid -> the job we stopped in that terminal. */
const stoppedGroups = new Map<number, StoppedJob>()
/** pty pid -> resume in flight, so a second resume never types `fg` into the agent. */
const resumesInFlight = new Map<number, Promise<ForegroundSignalResult>>()
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
  for (const { job } of stoppedGroups.values()) {
    try {
      kill(-job, 'SIGCONT')
      n += 1
    } catch {
      // Already gone; nothing left to continue.
    }
  }
  stoppedGroups.clear()
  return n
}

function tryKill(kill: (pid: number, sig: string) => void, pgid: number, sig: string): boolean {
  try {
    kill(-pgid, sig)
    return true
  } catch {
    // The group is already gone.
    return false
  }
}

/** Polls the terminal's foreground group until `done` accepts it; null on timeout. */
async function waitForOwner(
  ptyPid: number,
  readGroup: (pid: number) => Promise<number | null>,
  done: (owner: number) => boolean,
  deps: ForegroundSignalDeps
): Promise<number | null> {
  const pollMs = deps.handoffPollMs ?? HANDOFF_POLL_MS
  const deadline = Date.now() + (deps.handoffTimeoutMs ?? HANDOFF_TIMEOUT_MS)
  for (;;) {
    const owner = await readGroup(ptyPid)
    if (owner !== null && done(owner)) {
      return owner
    }
    if (Date.now() >= deadline) {
      return null
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

async function pauseForegroundGroup(
  ptyPid: number,
  readGroup: (pid: number) => Promise<number | null>,
  kill: (pid: number, sig: string) => void,
  deps: ForegroundSignalDeps
): Promise<ForegroundSignalResult> {
  if (stoppedGroups.has(ptyPid)) {
    // Already paused: the foreground is the shell now, and that must never be stopped.
    return 'signalled'
  }
  const job = await readGroup(ptyPid)
  if (job === null || job === ptyPid) {
    return 'no-foreground-job'
  }
  installExitHook(kill)
  if (!tryKill(kill, job, 'SIGSTOP')) {
    return 'no-foreground-job'
  }
  const shell = await waitForOwner(ptyPid, readGroup, (owner) => owner !== job, deps)
  if (shell === null) {
    // Nothing took the terminal back, so what we stopped was the shell itself
    // (a bare prompt) or a job no shell can foreground again: never leave it frozen.
    tryKill(kill, job, 'SIGCONT')
    return 'no-foreground-job'
  }
  stoppedGroups.set(ptyPid, { job, shell })
  return 'signalled'
}

async function resumeStoppedGroup(
  ptyPid: number,
  stopped: StoppedJob,
  readGroup: (pid: number) => Promise<number | null>,
  kill: (pid: number, sig: string) => void,
  deps: ForegroundSignalDeps
): Promise<ForegroundSignalResult> {
  const owner = await readGroup(ptyPid)
  if (owner === null) {
    return 'handoff-failed'
  }
  if (owner !== stopped.shell) {
    // The agent already has the terminal, or the user started something else in
    // it: there is no prompt to type `fg` at, so a plain continue is all that is left.
    stoppedGroups.delete(ptyPid)
    return tryKill(kill, stopped.job, 'SIGCONT') ? 'signalled' : 'no-foreground-job'
  }
  deps.write(SHELL_FOREGROUND_COMMAND)
  if ((await waitForOwner(ptyPid, readGroup, (now) => now === stopped.job, deps)) === null) {
    return 'handoff-failed'
  }
  stoppedGroups.delete(ptyPid)
  return 'signalled'
}

/**
 * `ptyPid` is the pty's child process. It is only used to find the terminal;
 * it may be the shell or a wrapper around it (macOS `login`).
 */
export async function signalForegroundProcessGroup(
  ptyPid: number,
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
    await resumesInFlight.get(ptyPid)
    return pauseForegroundGroup(ptyPid, readGroup, kill, deps)
  }
  const inFlight = resumesInFlight.get(ptyPid)
  if (inFlight) {
    return inFlight
  }
  const stopped = stoppedGroups.get(ptyPid)
  if (stopped === undefined) {
    return 'not-paused'
  }
  const resume = resumeStoppedGroup(ptyPid, stopped, readGroup, kill, deps).finally(() =>
    resumesInFlight.delete(ptyPid)
  )
  resumesInFlight.set(ptyPid, resume)
  return resume
}

export function isGroupStoppedForShell(shellPid: number): boolean {
  return stoppedGroups.has(shellPid)
}

export function resetStoppedGroupsForTest(): void {
  resumesInFlight.clear()
  stoppedGroups.clear()
}
