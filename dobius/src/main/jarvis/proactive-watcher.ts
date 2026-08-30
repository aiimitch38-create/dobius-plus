import { basename } from 'node:path'
import type { TerminalActivity } from './terminal-history-context'
import { readRecentTerminalActivity } from './terminal-history-context'

/** How long a terminal must be quiet before its last output counts as finished. */
export const MIN_SILENCE_MS = 30_000
/** Anything older than this is history, not news — so launching never announces yesterday. */
export const MAX_STALENESS_MS = 10 * 60_000
/** Global, not per terminal: four builds finishing together are one message. */
export const COOLDOWN_MS = 5 * 60_000
const POLL_MS = 15_000
const WATCHED_TERMINALS = 10
const DEFAULT_QUIET_FROM = 22
const DEFAULT_QUIET_TO = 8

export type Outcome = 'failed' | 'passed'

/**
 * Strings that contain a failure word but report a SUCCESS. Rewritten to a
 * success marker before the scan rather than special-cased after it.
 *
 * Every one of these was emitted by this repo's own tooling while this build ran
 * (`tsgo`, `vitest`, `electron-vite`). Without the rewrite, a clean typecheck is
 * announced as a broken build — and an assistant that tells you the thing that
 * passed has failed is worse than one that says nothing.
 *
 * They become `✓` rather than being deleted because they are positive evidence:
 * "exit code 0" is the whole completion signal in a bare shell, and deleting it
 * would leave a tail with no marker at all, so a real success would go unspoken.
 */
const NEUTRALISED = /\b(?:0|no)\s+(?:errors?|failures?|failed|failing)\b|\bexit\s+code\s+0\b/g

/**
 * File paths and filenames, removed before the scan.
 *
 * Without this, the substring `error` matches inside a FILENAME and a passing
 * run is announced as a failure. Measured against this repo: a green vitest run
 * whose tail reads `✓ src/shared/codex-auth-errors.test.ts … Tests 20 passed`
 * classified as `failed`, and so did a clean vite build listing an
 * `ErrorBoundary-*.js` chunk. `src/` alone holds ten files with `error` in the
 * name, so this fired constantly rather than rarely.
 *
 * Word boundaries do NOT fix it — `-` is already a word boundary, so
 * `\berrors\b` still matches `auth-errors`. Dropping the whole token is what
 * works: a path names a file, it does not report an outcome.
 */
const PATHS = /\S*\/\S*|\S+\.[a-z]{1,6}\b/g

// `fail` covers FAIL, failed, failure and failing in one entry.
const FAILURE_MARKERS = ['fail', 'error', '✗', 'exit code']
const SUCCESS_MARKERS = ['passed', '✓', 'built in', 'done', 'success']

/**
 * What the tail of a terminal says happened, or `null` for "no completion
 * marker" — which means say nothing.
 *
 * This is the gate that kills the false positives. Silence alone is not
 * evidence a job finished: an agent waiting at a permission prompt is quiet, an
 * interactive REPL is quiet, and at app start every terminal is quiet.
 */
export function classifyOutcome(tail: string): Outcome | null {
  const scanned = tail.toLowerCase().replace(PATHS, ' ').replace(NEUTRALISED, ' ✓ ')
  // Failure wins when both appear: `1 failed | 29 passed` is a failed run.
  if (FAILURE_MARKERS.some((marker) => scanned.includes(marker))) {
    return 'failed'
  }
  if (SUCCESS_MARKERS.some((marker) => scanned.includes(marker))) {
    return 'passed'
  }
  return null
}

/**
 * The exact marker string classifyOutcome matched, so an opening line built
 * on the classification can cite its evidence instead of asserting a bare
 * fact the agent cannot back up when asked "what broke?".
 */
export function matchedMarker(tail: string): string | null {
  const scanned = tail.toLowerCase().replace(PATHS, ' ').replace(NEUTRALISED, ' ✓ ')
  return (
    FAILURE_MARKERS.find((marker) => scanned.includes(marker)) ??
    SUCCESS_MARKERS.find((marker) => scanned.includes(marker)) ??
    null
  )
}

/** Local-hour window, wrapping midnight when `from` is later than `to` (22 → 8). */
export function isQuietHours(now: number, from: number, to: number): boolean {
  const hour = new Date(now).getHours()
  if (from === to) {
    return false
  }
  return from < to ? hour >= from && hour < to : hour >= from || hour < to
}

export type ProactiveSettings = {
  enabled: boolean
  quietFrom?: number
  quietTo?: number
}

export type ProactiveInput = {
  activities: TerminalActivity[]
  now: number
  /** 0 means "has never spoken", so the cooldown cannot block the first message. */
  lastSpokeAt: number
  /** worktreePath → the `lastActiveAt` already announced for it. */
  announced: Map<string, number>
  settings: ProactiveSettings
}

export type ProactiveDecision = {
  text: string
  /** Every completion covered by this one utterance, so none is announced twice. */
  announced: { worktreePath: string; lastActiveAt: number }[]
}

function phrase(worktreePath: string, outcome: Outcome): string {
  const name = basename(worktreePath) || worktreePath
  return outcome === 'failed' ? `The run in ${name} failed.` : `${name} finished clean.`
}

/**
 * All four gates, in one pure function over a plain input object.
 *
 * `now` is a parameter and never `Date.now()`: every gate here is a time
 * comparison, so a test that cannot control the clock cannot test any of them.
 */
export function decideProactive(input: ProactiveInput): ProactiveDecision | null {
  const { activities, now, lastSpokeAt, announced, settings } = input
  if (!settings.enabled) {
    return null
  }
  if (isQuietHours(now, settings.quietFrom ?? DEFAULT_QUIET_FROM, settings.quietTo ?? DEFAULT_QUIET_TO)) {
    return null
  }
  // Gate 4, checked first because it is the cheapest and rejects the most.
  if (lastSpokeAt > 0 && now - lastSpokeAt < COOLDOWN_MS) {
    return null
  }

  const finished: { activity: TerminalActivity; outcome: Outcome }[] = []
  for (const activity of activities) {
    const idle = now - activity.lastActiveAt
    // Gate 2: quiet long enough. Gate 3: not stale enough to be yesterday's news.
    if (idle < MIN_SILENCE_MS || idle > MAX_STALENESS_MS) {
      continue
    }
    if (announced.get(activity.worktreePath) === activity.lastActiveAt) {
      continue
    }
    // Gate 1: a completion marker. No marker, no message.
    const outcome = classifyOutcome(activity.recentOutput)
    if (outcome) {
      finished.push({ activity, outcome })
    }
  }

  if (finished.length === 0) {
    return null
  }

  const covered = finished.map(({ activity }) => ({
    worktreePath: activity.worktreePath,
    lastActiveAt: activity.lastActiveAt
  }))

  if (finished.length === 1) {
    return { text: phrase(finished[0].activity.worktreePath, finished[0].outcome), announced: covered }
  }

  // More than one at once is still ONE utterance — the whole point of a global
  // cooldown. Failures are named because they are the ones worth interrupting for.
  const failures = finished
    .filter((item) => item.outcome === 'failed')
    .map((item) => basename(item.activity.worktreePath) || item.activity.worktreePath)
  const summary = failures.length
    ? `${failures.slice(0, 2).join(' and ')} failed.`
    : 'All clean.'
  return { text: `${finished.length} runs just finished. ${summary}`, announced: covered }
}

export type ProactiveWatcherDeps = {
  historyRoot: string
  readSettings: () => ProactiveSettings
  speak: (text: string) => Promise<unknown>
  now?: () => number
  readActivity?: (historyRoot: string, limit: number) => TerminalActivity[]
}

/**
 * The impure shell: poll, ask `decideProactive`, speak. All the judgement lives
 * in the pure function above.
 *
 * Why a poll and not a file watcher: the trigger requires 30 seconds of silence,
 * so sub-second precision buys nothing, and watching means chokidar handles over
 * directories that come and go with every terminal.
 */
export class ProactiveWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastSpokeAt = 0
  private readonly announced = new Map<string, number>()
  /**
   * False until the first tick has recorded what already exists.
   *
   * Without this, opening the app announces a job that finished four minutes
   * before launch — it passes every gate. Only completions observed while
   * running are news.
   */
  private primed = false

  constructor(private readonly deps: ProactiveWatcherDeps) {}

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => void this.tick(), POLL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async tick(): Promise<void> {
    const settings = this.deps.readSettings()
    const now = (this.deps.now ?? Date.now)()
    const read = this.deps.readActivity ?? readRecentTerminalActivity
    let activities: TerminalActivity[] = []
    try {
      activities = read(this.deps.historyRoot, WATCHED_TERMINALS)
    } catch {
      // An unreadable history directory must never take the app down. Nothing
      // to say this tick.
      return
    }

    if (!this.primed) {
      this.primed = true
      for (const activity of activities) {
        this.announced.set(activity.worktreePath, activity.lastActiveAt)
      }
      return
    }

    const decision = decideProactive({
      activities,
      now,
      lastSpokeAt: this.lastSpokeAt,
      announced: this.announced,
      settings
    })
    if (!decision) {
      return
    }
    for (const entry of decision.announced) {
      this.announced.set(entry.worktreePath, entry.lastActiveAt)
    }
    this.lastSpokeAt = now
    try {
      await this.deps.speak(decision.text)
    } catch {
      // A failed TTS call is not worth retrying — by the time it would be
      // retried the message is stale, and the cooldown has already been spent.
    }
  }
}
