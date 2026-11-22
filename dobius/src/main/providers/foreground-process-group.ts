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

export type JobState = 'stopped' | 'running' | 'gone' | 'unknown'

/** Reads `pgid stat` rows from `ps -ax -o pgid=,stat=` for one process group. */
export function jobStateFromPsRows(pgid: number, rows: string): JobState {
  let members = 0
  let stopped = false
  for (const row of rows.split('\n')) {
    const [group, stat] = row.trim().split(/\s+/)
    // Zombies have already exited; they only wait to be reaped.
    if (Number(group) !== pgid || !stat || stat.startsWith('Z')) {
      continue
    }
    members += 1
    stopped ||= stat.startsWith('T')
  }
  if (members === 0) {
    return 'gone'
  }
  return stopped ? 'stopped' : 'running'
}

/**
 * Whether a process group is stopped, running or gone, by its members (the
 * leader alone may have exited). A failed lookup is 'unknown', never 'gone':
 * forgetting a paused agent on a `ps` hiccup would leave it frozen for good.
 */
export function readJobState(pgid: number): Promise<JobState> {
  return new Promise((resolve) => {
    execFile('ps', ['-ax', '-o', 'pgid=,stat='], { timeout: 2_000 }, (error, stdout) => {
      resolve(error ? 'unknown' : jobStateFromPsRows(pgid, stdout))
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
  /** `fg` was typed for this pause. Never typed twice for the same pause. */
  fgSent: boolean
}

type Kill = (pid: number, sig: string) => void
type Ctx = {
  ptyPid: number
  /** The terminal's lifetime at the time of the call; see `alive`. */
  lifetime: object
  readGroup: (pid: number) => Promise<number | null>
  readState: (pgid: number) => Promise<JobState>
  kill: Kill
  deps: ForegroundSignalDeps
}

/** pty pid -> the job we stopped in that terminal. */
const stoppedGroups = new Map<number, StoppedJob>()
/** pty pid -> last queued pause/resume, so they run one at a time per terminal. */
const operations = new Map<number, Promise<unknown>>()
/**
 * pty pid -> token for the terminal currently using that pid. Teardown drops
 * it, so an operation still waiting on `ps` can tell its terminal is gone (and
 * the pid possibly reused) before it signals or types anything.
 */
const lifetimes = new Map<number, object>()
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
  lifetimes.clear()
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
  lifetimes.delete(ptyPid)
  operations.delete(ptyPid)
  const stopped = stoppedGroups.get(ptyPid)
  if (stopped === undefined) {
    return false
  }
  stoppedGroups.delete(ptyPid)
  tryKill(kill, stopped.job, 'SIGCONT')
  return true
}

/** False once the terminal this operation was started for has been torn down. */
function alive(ctx: Ctx): boolean {
  return lifetimes.get(ctx.ptyPid) === ctx.lifetime
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
    if (!alive(ctx)) {
      return null
    }
    if (owner !== null && done(owner)) {
      return owner
    }
    if (Date.now() >= deadline) {
      return null
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

// Returned when the terminal was torn down mid-operation: teardown already
// continued and forgot the agent, so there is nothing left to act on.
const TORN_DOWN: ForegroundSignalResult = 'no-foreground-job'

async function pauseForegroundGroup(ctx: Ctx): Promise<ForegroundSignalResult> {
  const { ptyPid, kill } = ctx
  const existing = stoppedGroups.get(ptyPid)
  if (existing) {
    // Already paused: the foreground is the shell now, and that must never be stopped.
    const state = await ctx.readState(existing.job)
    if (!alive(ctx)) {
      return TORN_DOWN
    }
    if (state === 'running') {
      // An earlier resume left it running; this is a new pause of the same agent.
      if (!tryKill(kill, existing.job, 'SIGSTOP')) {
        forget(ptyPid, existing)
        return 'no-foreground-job'
      }
      existing.fgSent = false
      return 'signalled'
    }
    if (state !== 'gone') {
      return 'signalled'
    }
    forget(ptyPid, existing)
  }
  const job = await ctx.readGroup(ptyPid)
  if (!alive(ctx)) {
    return TORN_DOWN
  }
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
  if (!alive(ctx)) {
    return TORN_DOWN
  }
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
  if (!alive(ctx)) {
    return TORN_DOWN
  }
  if (state === 'gone') {
    // Never type `fg` for a dead agent: it would foreground some other job.
    forget(ptyPid, stopped)
    return 'no-foreground-job'
  }
  if (state === 'unknown') {
    return 'handoff-failed'
  }
  // ponytail: known limit, accepted. The owner is read last and the write
  // follows it with no await in between, but the user can still type `fg`
  // themselves in the few milliseconds `ps` takes, and then Ctrl-C + `fg`
  // reach the agent. Closing that fully needs a shell-side control channel
  // with an acknowledgement (shell integration).
  const owner = await ctx.readGroup(ptyPid)
  if (!alive(ctx)) {
    return TORN_DOWN
  }
  if (owner === null) {
    return 'handoff-failed'
  }
  if (owner !== stopped.shell) {
    // Either the agent already has the terminal, or the user started something
    // else in it. There is no prompt to type `fg` at, so a plain continue is
    // all that is left. Only the agent owning the terminal counts as resumed:
    // in the background a full-screen agent may stop again, so the record stays
    // for a later resume or quit to find.
    if (!tryKill(kill, stopped.job, 'SIGCONT')) {
      forget(ptyPid, stopped)
      return 'no-foreground-job'
    }
    if (owner !== stopped.job) {
      return 'handoff-failed'
    }
    forget(ptyPid, stopped)
    return 'signalled'
  }
  // Why once per pause: an `fg` typed earlier may still be queued in the
  // terminal, and a second copy would be typed into the agent once the first
  // one lands. A retry only waits for the first to take effect.
  if (!stopped.fgSent) {
    stopped.fgSent = true
    ctx.deps.write(SHELL_FOREGROUND_COMMAND)
  }
  // Bare `fg` picks the shell's current job, which may not be ours: only the
  // recorded group owning the terminal counts as success.
  const handedOver = await waitForOwner(ctx, (now) => now === stopped.job)
  if (!alive(ctx)) {
    return TORN_DOWN
  }
  if (handedOver === null) {
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
  let lifetime = lifetimes.get(ptyPid)
  if (!lifetime) {
    lifetime = {}
    lifetimes.set(ptyPid, lifetime)
  }
  const ctx: Ctx = {
    ptyPid,
    lifetime,
    readGroup: deps.readGroup ?? readForegroundGroup,
    readState: deps.readJobState ?? readJobState,
    kill: deps.kill ?? ((pid: number, sig: string) => process.kill(pid, sig)),
    deps
  }
  const run = async (): Promise<ForegroundSignalResult> => {
    if (!alive(ctx)) {
      return TORN_DOWN
    }
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
  lifetimes.clear()
  stoppedGroups.clear()
}
