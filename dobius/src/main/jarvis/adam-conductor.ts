// ADAM the conductor: remembers the terminals ADAM sent work to (quick hands
// typing, `dobius terminal send` from his Hermes process) and, when one of
// them finishes or stops to ask Carson something, produces one short notice.
// Why main and no AI step: the notice is built from the agent's own status and
// its own last reply, so ADAM never claims more than the agent said.
// No Electron import: the runtime RPC (terminal.send) reaches it too.

import {
  doneNotice,
  freshReply,
  lastSentenceAsks,
  needsYouNotice,
  plainWords,
  clip,
  safeLabel,
  summarizeUpdates,
  type ConductorUpdate
} from './adam-conductor-text'

export {
  CONDUCTOR_NOTICE_MAX_CHARS,
  doneNotice,
  firstSentence,
  lastQuestion,
  needsYouNotice,
  plainWords,
  safeLabel,
  summarizeUpdates
} from './adam-conductor-text'

export type ConductorStatus = {
  isRunningAgent: boolean
  status: 'working' | 'permission' | 'idle' | null
}

/** What the agent last said, from its transcript (or screen), for the notice. */
export type ConductorRead = {
  /** The agent's last reply and when it was written (null = no timestamp). */
  reply: { text: string; at: number | null } | null
  /** The visible screen lines, top to bottom, for a question the transcript lacks. */
  screen: string[]
}

export type ConductorNoticeKind = 'done' | 'needs-you'

export type ConductorNotice = {
  kind: ConductorNoticeKind
  handle: string
  label: string
  /** Plain words, already secret-filtered and short: safe to show and say. */
  text: string
  at: number
}

export type ConductorDeps = {
  status: (handle: string) => Promise<ConductorStatus>
  read: (handle: string) => Promise<ConductorRead>
  /** The terminal's current name, or null when it is gone. */
  labelOf: (handle: string) => Promise<string | null>
  report: (notice: ConductorNotice) => void
  /** Reports were switched off: anything still waiting to be said is dropped. */
  cleared?: () => void
  /** The "ADAM reports finished work" setting. */
  enabled: () => boolean
  now?: () => number
  setInterval?: (run: () => void, ms: number) => unknown
  clearInterval?: (timer: unknown) => void
}

export type DispatchSource = 'quick-hands' | 'cli'

type Tracked = {
  /** Unique per dispatch: a newer send to the same terminal replaces this one. */
  id: number
  handle: string
  what: string
  source: DispatchSource
  sentAt: number
  sawWorking: boolean
  /** The agent's last reply when ADAM sent the work (undefined = not read yet). */
  baselineReply: string | null | undefined
  replyCheckedAt: number
  /** When the current done / needs-you reading began; it must hold SETTLE_MS. */
  settling: { kind: ConductorNoticeKind; since: number } | null
  /** A notice was already given for this stretch of waiting. */
  askedAt: number | null
}

export const CONDUCTOR_POLL_MS = 2_000
// Why 5 seconds: an agent between two tool calls, or a prompt Carson answers
// at once, must not be reported.
export const CONDUCTOR_SETTLE_MS = 5_000
export const CONDUCTOR_EXPIRE_MS = 6 * 60 * 60_000
export const CONDUCTOR_MAX_TRACKED = 30
// Why throttled: a reply check reads the agent's transcript file.
export const CONDUCTOR_REPLY_CHECK_MS = 6_000
const WHAT_MAX_CHARS = 80
const CONTEXT_MAX_LINES = 6
const UNSEEN_MAX = 50

/** Identifies one reply, so "a new reply since ADAM's message" can be told apart. */
function replyKey(read: ConductorRead | null): string | null {
  return read?.reply ? `${read.reply.at ?? ''}|${read.reply.text.slice(0, 300)}` : null
}

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
      what: clip(plainWords(text), WHAT_MAX_CHARS),
      source,
      sentAt: this.now(),
      sawWorking: false,
      baselineReply: undefined,
      replyCheckedAt: this.now(),
      settling: null,
      askedAt: null
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
      .then((read) => replyKey(read))
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

  /** A reply newer than the one there when ADAM sent the work: the agent did work. */
  private async newReplySinceDispatch(entry: Tracked, now: number): Promise<boolean> {
    if (entry.baselineReply === undefined || now - entry.replyCheckedAt < CONDUCTOR_REPLY_CHECK_MS) {
      return false
    }
    entry.replyCheckedAt = now
    const key = replyKey(await this.deps.read(entry.handle).catch(() => null))
    return key !== null && key !== entry.baselineReply
  }

  private async checkOne(entry: Tracked): Promise<void> {
    const now = this.now()
    if (now - entry.sentAt > CONDUCTOR_EXPIRE_MS) {
      this.forget(entry)
      return
    }
    const { isRunningAgent, status } = await this.deps.status(entry.handle)
    if (status === 'working') {
      entry.sawWorking = true
      entry.settling = null
      entry.askedAt = null
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
      status === 'permission'
        ? 'needs-you'
        : status === 'idle' || !isRunningAgent
          ? 'done'
          : null
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

  private async announce(entry: Tracked, settled: ConductorNoticeKind): Promise<void> {
    // Why claimed before the awaits: a poke during the reads must not announce twice.
    entry.askedAt = this.now()
    entry.settling = null
    const [label, read, after] = await Promise.all([
      this.deps.labelOf(entry.handle).catch(() => null),
      this.deps.read(entry.handle).catch(() => null),
      this.deps.status(entry.handle).catch(() => null)
    ])
    // Why rechecked: during the reads ADAM may have sent new work (this entry
    // was replaced), the agent may have started again, or reports were turned off.
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
    const kind: ConductorNoticeKind =
      settled === 'done' && reply && lastSentenceAsks(reply) ? 'needs-you' : settled
    if (kind === 'done') {
      this.forget(entry)
    }
    const name = safeLabel(label)
    const text =
      kind === 'done'
        ? doneNotice(name, read, entry.sentAt)
        : needsYouNotice(name, read, after.status, entry.sentAt)
    this.unseen = [...this.unseen, { label: name, text }].slice(-UNSEEN_MAX)
    this.deps.report({ kind, handle: entry.handle, label: name, text, at: this.now() })
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
