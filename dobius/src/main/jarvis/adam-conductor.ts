// ADAM the conductor: remembers the terminals ADAM sent work to (quick hands
// typing, `dobius terminal send` from his Hermes process) and, when one of
// them finishes or stops to ask Carson something, produces one short notice.
// Why two texts per notice: `display` (the thread row Carson reads) may quote
// the agent's first sentence; `spoken` (anything a model hears: the live
// voice, Hermes) is a fixed template plus an allowlisted name, never a word
// from the terminal (shared/conductor-speech.ts).
// No Electron import: the runtime RPC (terminal.send) reaches it too.

import { conductorSpeech, speakableName } from '../../shared/conductor-speech'
import { conductorJobs, conductorStaleJobs } from './adam-conductor-jobs'
import type {
  ConductorDeps,
  ConductorJob,
  ConductorNotice,
  ConductorNoticeKind,
  ConductorRead,
  DispatchSource,
  Tracked
} from './adam-conductor-types'

import {
  doneNotice,
  freshReply,
  isNewWork,
  replyKey,
  safeHandle,
  lastSentenceAsks,
  needsYouNotice,
  nextProgressEvent,
  safeLabel,
  summarizeUpdates,
  type ConductorUpdate
} from './adam-conductor-text'

export const CONDUCTOR_POLL_MS = 2_000
// Why 5 seconds: an agent between two tool calls, or a prompt Carson answers
// at once, must not be reported.
export const CONDUCTOR_SETTLE_MS = 5_000
export const CONDUCTOR_EXPIRE_MS = 6 * 60 * 60_000
export const CONDUCTOR_MAX_TRACKED = 30
// Why throttled: a reply check reads the agent's transcript file.
export const CONDUCTOR_REPLY_CHECK_MS = 6_000
const CONTEXT_MAX_LINES = 6
const UNSEEN_MAX = 50

/**
 * Watches the terminals ADAM sent work to. Untracks a terminal once it is
 * reported done; one that needs Carson stays tracked, so its finish is still
 * reported after he answers.
 */
export class AdamConductor {
  private readonly tracked = new Map<string, Tracked>()
  private timer: unknown = null
  private checking: Promise<void> | null = null
  private recheck = false
  private unseen: ConductorUpdate[] = []
  private nextId = 1
  private readonly now: () => number

  constructor(private readonly deps: ConductorDeps) {
    this.now = deps.now ?? Date.now
  }

  get size(): number {
    return this.tracked.size
  }

  isTracking(handle: string): boolean {
    return this.tracked.has(handle)
  }

  /**
   * ADAM sent `text` to the terminal. Each send starts over: a follow-up that
   * is typed but never submitted must not inherit the last task's work.
   */
  noteDispatch(handle: string, text: string, source: DispatchSource): void {
    if (!this.deps.enabled() || !handle || !text.trim()) {
      return
    }
    this.tracked.delete(handle)
    const entry: Tracked = {
      id: this.nextId++,
      handle,
      source,
      sentAt: this.now(),
      sawWorking: false,
      baselineReply: undefined,
      replyCheckedAt: this.now(),
      settling: null,
      askedAt: null,
      workingSince: null,
      progressAt: 0
    }
    this.tracked.set(handle, entry)
    while (this.tracked.size > CONDUCTOR_MAX_TRACKED) {
      const oldest = this.tracked.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.tracked.delete(oldest)
    }
    // Why read now: work that finishes before the first poll is only visible
    // as a reply newer than this one.
    void this.deps
      .read(handle)
      .then((read) => (isNewWork(read, entry.sentAt) ? null : replyKey(read)))
      .catch(() => null)
      .then((key) => {
        entry.baselineReply = key
      })
    this.startPolling()
    // Why at once: an agent that starts (or asks) right away is seen now.
    void this.check()
  }

  /** Something changed (an agent hook fired): look now, not at the next poll. */
  poke(): void {
    if (this.tracked.size > 0) {
      void this.check()
    }
  }

  /**
   * The updates since ADAM's last turn, once: the next message to him carries
   * them as context, and later messages do not repeat them. Many become one
   * summary line instead of being dropped.
   */
  takeContext(): string[] {
    const lines = summarizeUpdates(this.unseen, CONTEXT_MAX_LINES)
    this.unseen = []
    return lines
  }

  /** The tracked jobs as a model may hear them (adam-conductor-jobs.ts). */
  jobs(): Promise<ConductorJob[]> {
    return conductorJobs(this.tracked.values(), this.deps.identify)
  }

  /** Every tracked job's waiting and working clocks, for the stale alerts. */
  readonly staleJobs = () => conductorStaleJobs(this.tracked.values())

  /** Reports were switched off: forget every terminal and every unsaid update. */
  clear(): void {
    this.tracked.clear()
    this.unseen = []
    this.stopPolling()
    this.deps.cleared?.()
  }

  dispose(): void {
    this.tracked.clear()
    this.stopPolling()
  }

  /** One pass over every tracked terminal; overlapping calls fold into one more pass. */
  check(): Promise<void> {
    if (this.checking) {
      this.recheck = true
      return this.checking
    }
    this.checking = (async () => {
      try {
        do {
          this.recheck = false
          await this.checkAll()
        } while (this.recheck)
      } finally {
        this.checking = null
        if (this.tracked.size === 0) {
          this.stopPolling()
        }
      }
    })()
    return this.checking
  }

  private async checkAll(): Promise<void> {
    if (!this.deps.enabled()) {
      if (this.tracked.size > 0 || this.unseen.length > 0) {
        this.clear()
      }
      return
    }
    for (const entry of this.tracked.values()) {
      try {
        await this.checkOne(entry)
      } catch {
        // Why untrack: status throws only when the terminal is gone (closed or exited).
        this.forget(entry)
      }
    }
  }

  private isCurrent(entry: Tracked): boolean {
    return this.tracked.get(entry.handle) === entry
  }

  private forget(entry: Tracked): void {
    if (this.isCurrent(entry)) {
      this.tracked.delete(entry.handle)
    }
  }

  /** The agent's latest reply, read at most every REPLY_CHECK (undefined = not this time). */
  private async readSometimes(
    entry: Tracked,
    now: number
  ): Promise<ConductorRead | null | undefined> {
    if (now - entry.replyCheckedAt < CONDUCTOR_REPLY_CHECK_MS) {
      return undefined
    }
    entry.replyCheckedAt = now
    return this.deps.read(entry.handle).catch(() => null)
  }

  /** A reply newer than the one there when ADAM sent the work: the agent did work. */
  private async newReplySinceDispatch(entry: Tracked, now: number): Promise<boolean> {
    const read = await this.readSometimes(entry, now)
    // Why a baseline only for untimed replies: a timed one is judged by its time,
    // however late the baseline read came back.
    const key = read?.reply?.at === null ? replyKey(read) : null
    return (
      read !== undefined &&
      (isNewWork(read, entry.sentAt) ||
        (key !== null && entry.baselineReply !== undefined && key !== entry.baselineReply))
    )
  }

  private async checkOne(entry: Tracked): Promise<void> {
    const now = this.now()
    if (now - entry.sentAt > CONDUCTOR_EXPIRE_MS) {
      this.forget(entry)
      return
    }
    const { isRunningAgent, status } = await this.deps.status(entry.handle)
    entry.lastStatus = status
    if (status === 'working') {
      entry.sawWorking = true
      entry.settling = null
      entry.askedAt = null
      await this.maybeProgress(entry, now)
      return
    }
    // Why a prompt counts: quick hands never type into one and a guarded send
    // refuses one, so a prompt after ADAM's message is the agent's own doing.
    if (status === 'permission') {
      entry.sawWorking = true
    }
    // Why only after evidence of work: quick hands never press Enter, so a
    // terminal sits idle until Carson (or ADAM) submits; that idle is not a finish.
    if (!entry.sawWorking && !(await this.newReplySinceDispatch(entry, now))) {
      return
    }
    entry.sawWorking = true
    const kind: ConductorNoticeKind | null =
      status === 'permission' ? 'needs-you' : status === 'idle' || !isRunningAgent ? 'done' : null
    // Why: after "needs you", the agent may answer and finish between two
    // polls, never seen working; a reply stamped after the ask shows it did.
    const askedAt = entry.askedAt
    if (kind === 'done' && askedAt !== null) {
      const read = await this.readSometimes(entry, now)
      entry.askedAt =
        read && entry.askedAt === askedAt && isNewWork(read, askedAt) ? null : entry.askedAt
    }
    // Why askedAt blocks both: once Carson was asked, nothing more is said
    // until he answers and the agent works again.
    if (!kind || entry.askedAt !== null) {
      return
    }
    if (entry.settling?.kind !== kind) {
      entry.settling = { kind, since: now }
      return
    }
    if (now - entry.settling.since < CONDUCTOR_SETTLE_MS) {
      return
    }
    await this.announce(entry, kind)
  }

  private progressOn(): boolean {
    return this.deps.enabled() && (this.deps.progressEnabled?.() ?? true)
  }

  /** "Juniper started working." once, then "still working, N minutes in." every 5 minutes. */
  private async maybeProgress(entry: Tracked, now: number): Promise<void> {
    const event = nextProgressEvent(entry, now)
    if (!event || !this.deps.progress || !this.progressOn()) {
      return
    }
    const identity = await this.deps.identify(entry.handle).catch(() => null)
    if (!this.isCurrent(entry) || !this.progressOn()) {
      return
    }
    const name = speakableName(identity?.agentName, identity?.project)
    const minutes = Math.max(1, Math.round((now - (entry.workingSince ?? now)) / 60_000))
    this.deps.progress({
      event,
      handle: entry.handle,
      name,
      ...(event === 'progress' ? { minutes } : {})
    })
  }

  private async announce(entry: Tracked, settled: ConductorNoticeKind): Promise<void> {
    // Why claimed before the awaits: a poke during the reads must not announce twice.
    entry.askedAt = this.now()
    entry.settling = null
    const [identity, read] = await Promise.all([
      this.deps.identify(entry.handle).catch(() => null),
      this.deps.read(entry.handle).catch(() => null)
    ])
    // Why status last, after the slow reads: work that resumed during them must
    // cancel the notice. Also rechecked: ADAM may have sent new work (this entry
    // was replaced), or reports were turned off.
    const after = this.isCurrent(entry)
      ? await this.deps.status(entry.handle).catch(() => null)
      : null
    const stillSettled =
      after !== null &&
      (settled === 'needs-you'
        ? after.status === 'permission'
        : after.status === 'idle' || !after.isRunningAgent)
    if (!this.isCurrent(entry) || !this.deps.enabled() || !stillSettled) {
      if (this.isCurrent(entry)) {
        entry.askedAt = null
      }
      return
    }
    const reply = freshReply(read, entry.sentAt)
    // Why: an agent that ended its turn on a question is waiting for Carson, not done.
    // The reply only picks the template; none of its words go into `spoken`.
    const kind: ConductorNoticeKind =
      settled === 'done' && reply && lastSentenceAsks(reply) ? 'needs-you' : settled
    if (kind === 'done') {
      this.forget(entry)
    }
    const event: ConductorNotice['event'] =
      kind === 'needs-you' ? 'needs-you' : reply ? 'done' : 'unclear'
    const name = speakableName(identity?.agentName, identity?.project)
    const spoken = conductorSpeech([{ event, name }])
    const shown = safeLabel(identity?.agentName || identity?.title)
    const display =
      kind === 'done'
        ? doneNotice(shown, read, entry.sentAt)
        : needsYouNotice(shown, read, after.status, entry.sentAt)
    const line = `${spoken} (terminal ${safeHandle(entry.handle)})`
    this.unseen = [...this.unseen, { label: name, text: line }].slice(-UNSEEN_MAX)
    this.deps.report({ kind, event, handle: entry.handle, name, spoken, display, at: this.now() })
  }

  private startPolling(): void {
    if (this.timer !== null) {
      return
    }
    const timer = (this.deps.setInterval ?? ((run, ms) => setInterval(run, ms)))(
      () => void this.check(),
      CONDUCTOR_POLL_MS
    )
    ;(timer as { unref?: () => void } | null)?.unref?.()
    this.timer = timer
  }

  private stopPolling(): void {
    if (this.timer === null) {
      return
    }
    ;(this.deps.clearInterval ?? ((t) => clearInterval(t as NodeJS.Timeout)))(this.timer)
    this.timer = null
  }
}

let current: AdamConductor | null = null

/** Set by jarvis-ipc.ts; the runtime RPC reaches the same conductor through it. */
export function setAdamConductor(next: AdamConductor | null): void {
  current?.dispose()
  current = next
}

export function adamConductor(): AdamConductor | null {
  return current
}
