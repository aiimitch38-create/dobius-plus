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

export type JobState = 'stopped' | 'running' | 'gone'

/** Whether a process group's leader is stopped, running or gone (POSIX `ps -o stat`). */
export function readJobState(pgid: number): Promise<JobState> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'stat=', '-p', String(pgid)], { timeout: 2_000 }, (error, stdout) => {
      const stat = error ? '' : stdout.trim()
      if (stat === '') {
        resolve('gone')
        return
      }
      resolve(stat.startsWith('T') ? 'stopped' : 'running')
    })
  })
}

export type ForegroundSignalDeps = {
  readGroup?: (shellPid: number) => Promise<number | null>
  readJobState?: (pgid: number) => Promise<JobState>
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

// Ctrl-C first: anything already sitting on the shell's prompt line (stray
// keystrokes, terminal replies) would otherwise be glued onto `fg` and run.
// Why Ctrl-C and not End + Ctrl-U: those only clear the line in the emacs
// keymap. In the vi keymap End is typed in literally and Ctrl-U keeps the text
// after the cursor (seen on a real pty: `fg` became `fgps`). Ctrl-C drops the
// whole line in zsh, bash and fish whatever the keymap. It can only reach the
// shell here: the shell owns the terminal when this is written.
const SHELL_FOREGROUND_COMMAND = '\x03fg\r'
const HANDOFF_TIMEOUT_MS = 2_000
const HANDOFF_POLL_MS = 50

type StoppedJob = {
  /** The agent's process group, which we stopped. */
  job: number
  /** The group that took the terminal back when the agent stopped (the shell); null until seen. */
  shell: number | null
  /** `fg` was typed for this pause and has not been seen to work yet. */
  fgSent: boolean
}

type Kill = (pid: number, sig: string) => void
type Ctx = {
  ptyPid: number
  readGroup: (pid: number) => Promise<number | null>
  readState: (pgid: number) => Promise<JobState>
  kill: Kill
  deps: ForegroundSignalDeps
}

/** pty pid -> the job we stopped in that terminal. */
const stoppedGroups = new Map<number, StoppedJob>()
/** pty pid -> last queued pause/resume, so they run one at a time per terminal. */
const operations = new Map<number, Promise<unknown>>()
let exitHookInstalled = false

function installExitHook(kill: Kill): void {
  if (exitHookInstalled) {
    return
  }
  exitHookInstalled = true
  // Why: a paused agent must never outlive the app frozen.
  process.on('exit', () => continueAllStoppedGroups(kill))
}

/** Continues every group the Board stopped (app quit, Board teardown). */
export function continueAllStoppedGroups(
  kill: Kill = (pid, sig) => process.kill(pid, sig)
): number {
  let n = 0
  for (const { job } of stoppedGroups.values()) {
    if (tryKill(kill, job, 'SIGCONT')) {
      n += 1
    }
  }
  stoppedGroups.clear()
  return n
}

/**
 * Continues the ONE stopped group for this terminal, if any, and forgets it.
 * Called when that terminal is torn down (close/restart): most signals,
 * including the kill that follows, stay pending on a stopped process, so the
 * agent would otherwise stay frozen until the whole app quits.
 */
export function continueStoppedGroupForShell(
  ptyPid: number,
  kill: Kill = (pid, sig) => process.kill(pid, sig)
): boolean {
  const stopped = stoppedGroups.get(ptyPid)
  if (stopped === undefined) {
    return false
  }
  stoppedGroups.delete(ptyPid)
  tryKill(kill, stopped.job, 'SIGCONT')
  return true
}

function tryKill(kill: Kill, pgid: number, sig: string): boolean {
  try {
    kill(-pgid, sig)
    return true
  } catch {
    // The group is already gone.
    return false
  }
}

/** Forgets a record, unless the terminal was torn down and re-recorded meanwhile. */
function forget(ptyPid: number, stopped: StoppedJob): void {
  if (stoppedGroups.get(ptyPid) === stopped) {
    stoppedGroups.delete(ptyPid)
  }
}

/** Polls the terminal's foreground group until `done` accepts it; null on timeout. */
async function waitForOwner(ctx: Ctx, done: (owner: number) => boolean): Promise<number | null> {
  const pollMs = ctx.deps.handoffPollMs ?? HANDOFF_POLL_MS
  const deadline = Date.now() + (ctx.deps.handoffTimeoutMs ?? HANDOFF_TIMEOUT_MS)
  for (;;) {
    const owner = await ctx.readGroup(ctx.ptyPid)
    if (owner !== null && done(owner)) {
      return owner
    }
    if (Date.now() >= deadline) {
      return null
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

async function pauseForegroundGroup(ctx: Ctx): Promise<ForegroundSignalResult> {
  const { ptyPid, kill } = ctx
  const existing = stoppedGroups.get(ptyPid)
  if (existing) {
    // Already paused: the foreground is the shell now, and that must never be stopped.
    const state = await ctx.readState(existing.job)
    if (state !== 'gone') {
      // 'running' = an earlier resume could only continue it in the background.
      return state === 'stopped' || tryKill(kill, existing.job, 'SIGSTOP')
        ? 'signalled'
        : 'no-foreground-job'
    }
    forget(ptyPid, existing)
  }
  const job = await ctx.readGroup(ptyPid)
  if (job === null || job === ptyPid) {
    return 'no-foreground-job'
  }
  installExitHook(kill)
  if (!tryKill(kill, job, 'SIGSTOP')) {
    return 'no-foreground-job'
  }
  // Recorded before the shell is known, so quitting right now still continues it.
  const stopped: StoppedJob = { job, shell: null, fgSent: false }
  stoppedGroups.set(ptyPid, stopped)
  const shell = await waitForOwner(ctx, (owner) => owner !== job)
  if (shell === null) {
    // Nothing took the terminal back, so what we stopped was the shell itself
    // (a bare prompt) or a job no shell can foreground again: never leave it frozen.
    tryKill(kill, job, 'SIGCONT')
    forget(ptyPid, stopped)
    return 'no-foreground-job'
  }
  stopped.shell = shell
  return 'signalled'
}

async function resumeStoppedGroup(ctx: Ctx, stopped: StoppedJob): Promise<ForegroundSignalResult> {
  const { ptyPid, kill } = ctx
  const state = await ctx.readState(stopped.job)
  if (state === 'gone') {
    // Never type `fg` for a dead agent: it would foreground some other job.
    forget(ptyPid, stopped)
    return 'no-foreground-job'
  }
  // ponytail: the owner is read last and the write follows it with no await in
  // between, but the user can still type `fg` themselves in the few
  // milliseconds `ps` takes, and then these keys reach the agent. Closing that
  // fully needs a shell-side control channel with an acknowledgement.
  const owner = await ctx.readGroup(ptyPid)
  if (owner === null) {
    return 'handoff-failed'
  }
  if (owner === stopped.job) {
    // The agent already has the terminal: a plain continue is enough.
    if (!tryKill(kill, stopped.job, 'SIGCONT')) {
      forget(ptyPid, stopped)
      return 'no-foreground-job'
    }
    forget(ptyPid, stopped)
    return 'signalled'
  }
  if (owner !== stopped.shell) {
    // The user started something else in this terminal, so there is no prompt
    // to type `fg` at. Continue in the background and keep the record: a
    // full-screen agent may stop again there, and a later resume or quit must
    // still find it.
    if (!tryKill(kill, stopped.job, 'SIGCONT')) {
      forget(ptyPid, stopped)
      return 'no-foreground-job'
    }
    await new Promise((resolve) => setTimeout(resolve, ctx.deps.handoffPollMs ?? HANDOFF_POLL_MS))
    const after = await ctx.readState(stopped.job)
    if (after === 'gone') {
      forget(ptyPid, stopped)
      return 'no-foreground-job'
    }
    return after === 'stopped' ? 'handoff-failed' : 'signalled'
  }
  // Why: an `fg` typed earlier may still be queued in the terminal. Only type
  // another once the shell is back at its prompt with the agent still stopped,
  // which means the earlier one was used up without effect.
  if (!stopped.fgSent || state === 'stopped') {
    stopped.fgSent = true
    ctx.deps.write(SHELL_FOREGROUND_COMMAND)
  }
  // Bare `fg` picks the shell's current job, which may not be ours: only the
  // recorded group owning the terminal counts as success.
  if ((await waitForOwner(ctx, (now) => now === stopped.job)) === null) {
    return 'handoff-failed'
  }
  forget(ptyPid, stopped)
  return 'signalled'
}

/**
 * `ptyPid` is the pty's child process. It is only used to find the terminal;
 * it may be the shell or a wrapper around it (macOS `login`).
 */
export function signalForegroundProcessGroup(
  ptyPid: number,
  signal: string,
  deps: ForegroundSignalDeps
): Promise<ForegroundSignalResult> {
  const real = FOREGROUND_SIGNALS[signal]
  if (!real || process.platform === 'win32') {
    return Promise.resolve('unsupported')
  }
  const ctx: Ctx = {
    ptyPid,
    readGroup: deps.readGroup ?? readForegroundGroup,
    readState: deps.readJobState ?? readJobState,
    kill: deps.kill ?? ((pid: number, sig: string) => process.kill(pid, sig)),
    deps
  }
  const run = async (): Promise<ForegroundSignalResult> => {
    if (real === 'SIGSTOP') {
      return pauseForegroundGroup(ctx)
    }
    const stopped = stoppedGroups.get(ptyPid)
    return stopped === undefined ? 'not-paused' : resumeStoppedGroup(ctx, stopped)
  }
  // Why queued before any await: a second pause must not see the shell in the
  // foreground and stop it, and a resume must not miss a pause still in flight.
  const previous = operations.get(ptyPid) ?? Promise.resolve()
  const operation = previous.then(run, run)
  const settled = operation.catch(() => undefined)
  operations.set(ptyPid, settled)
  void settled.then(() => {
    if (operations.get(ptyPid) === settled) {
      operations.delete(ptyPid)
    }
  })
  return operation
}

export function isGroupStoppedForShell(shellPid: number): boolean {
  return stoppedGroups.has(shellPid)
}

export function resetStoppedGroupsForTest(): void {
  operations.clear()
  stoppedGroups.clear()
}
