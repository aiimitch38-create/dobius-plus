// ADAM the conductor: remembers the terminals ADAM sent work to (quick hands
// typing, `dobius terminal send` from his Hermes process) and, when one of
// them finishes or stops to ask Carson something, produces one short notice.
// Why main and no AI step: the notice is built from the agent's own status and
// its own last reply, so ADAM never claims more than the agent said.
// No Electron import: the runtime RPC (terminal.send) reaches it too.

import { lastOutputLine, looksSecret } from './live-voice-terminal-text'

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
  /** The "ADAM reports finished work" setting. */
  enabled: () => boolean
  now?: () => number
  setInterval?: (run: () => void, ms: number) => unknown
  clearInterval?: (timer: unknown) => void
}

export type DispatchSource = 'quick-hands' | 'cli'

type Tracked = {
  handle: string
  what: string
  source: DispatchSource
  sentAt: number
  sawWorking: boolean
  /** When the current done / needs-you reading began; it must hold SETTLE_MS. */
  settling: { kind: ConductorNoticeKind; since: number } | null
  /** A needs-you was already said for this stretch of waiting. */
  askedAt: number | null
}

export const CONDUCTOR_POLL_MS = 2_000
// Why 5 seconds: an agent between two tool calls, or a prompt Carson answers
// at once, must not be reported.
export const CONDUCTOR_SETTLE_MS = 5_000
export const CONDUCTOR_EXPIRE_MS = 6 * 60 * 60_000
export const CONDUCTOR_MAX_TRACKED = 30
export const CONDUCTOR_NOTICE_MAX_CHARS = 200
const WHAT_MAX_CHARS = 80
const CONTEXT_MAX_LINES = 6

// oxlint-disable-next-line no-control-regex -- stripping terminal escapes is the point
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g

/** One line of plain words: no escapes, control characters, markdown marks or extra spaces. */
export function plainWords(text: string): string {
  return (
    text
      .replace(ANSI, '')
      // oxlint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[`*_#>|]+/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

const SENTENCES = /[^.!?]+(?:[.!?]+(?=\s|$)|$)/g

function sentencesOf(text: string): string[] {
  return (plainWords(text).match(SENTENCES) ?? []).map((s) => s.trim()).filter(Boolean)
}

/** The first sentence of a reply, as plain words. */
export function firstSentence(text: string): string {
  return sentencesOf(text)[0] ?? ''
}

/** The last sentence ending in "?", or null. */
export function lastQuestion(text: string): string | null {
  const questions = sentencesOf(text).filter((s) => s.endsWith('?'))
  return questions.at(-1) ?? null
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** The agent's last reply if it was written after ADAM's message, else null. */
function freshReply(read: ConductorRead | null, sentAt: number): string | null {
  const reply = read?.reply
  // Why the time check: a reply from before ADAM's message is the previous task's.
  return reply && (reply.at === null || reply.at >= sentAt) && reply.text.trim() ? reply.text : null
}

function lastSentenceAsks(text: string): boolean {
  return sentencesOf(text).at(-1)?.endsWith('?') === true
}

/** "<label> says it's done: <first sentence>", short, never a secret. */
export function doneNotice(label: string, read: ConductorRead | null, sentAt: number): string {
  const fresh = freshReply(read, sentAt) ?? ''
  const sentence = fresh ? firstSentence(fresh) : ''
  if (!sentence) {
    return clip(`${label} looks finished, but I could not read what it said.`, CONDUCTOR_NOTICE_MAX_CHARS)
  }
  // Why the whole reply: a key past the first sentence would still be shown in part elsewhere.
  if (looksSecret(fresh) || looksSecret(sentence)) {
    return clip(
      `${label} says it's done. Its reply looked like it had a secret, so I left it out.`,
      CONDUCTOR_NOTICE_MAX_CHARS
    )
  }
  return clip(`${label} says it's done: ${sentence}`, CONDUCTOR_NOTICE_MAX_CHARS)
}

/** "<label> needs you: <question>", short, never a secret. */
export function needsYouNotice(
  label: string,
  read: ConductorRead | null,
  status: ConductorStatus['status'],
  sentAt: number
): string {
  const reply = freshReply(read, sentAt)
  // Why the whole reply: a question next to a key must not be shown.
  const fromReply = reply && !looksSecret(reply) ? lastQuestion(reply) : null
  const screenLine = read ? lastOutputLine(read.screen.filter((line) => line.includes('?'))) : null
  const question = fromReply ?? (screenLine ? plainWords(screenLine) : null)
  if (question && !looksSecret(question)) {
    return clip(`${label} needs you: ${question}`, CONDUCTOR_NOTICE_MAX_CHARS)
  }
  const generic =
    status === 'permission'
      ? `${label} needs you: it is waiting for your answer or a permission.`
      : `${label} needs you.`
  return clip(generic, CONDUCTOR_NOTICE_MAX_CHARS)
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
  private unseen: string[] = []
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

  /** ADAM sent `text` to the terminal. A repeat send restarts its clock. */
  noteDispatch(handle: string, text: string, source: DispatchSource): void {
    if (!this.deps.enabled() || !handle || !text.trim()) {
      return
    }
    const previous = this.tracked.get(handle)
    this.tracked.delete(handle)
    this.tracked.set(handle, {
      handle,
      what: clip(plainWords(text), WHAT_MAX_CHARS),
      source,
      sentAt: this.now(),
      // Why kept: a second message while it works still ends with one finish.
      sawWorking: previous?.sawWorking ?? false,
      settling: null,
      askedAt: null
    })
    while (this.tracked.size > CONDUCTOR_MAX_TRACKED) {
      const oldest = this.tracked.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.tracked.delete(oldest)
    }
    this.startPolling()
  }

  /** Something changed (an agent hook fired): look now, not at the next poll. */
  poke(): void {
    if (this.tracked.size > 0) {
      void this.check()
    }
  }

  /**
   * The notices since ADAM's last turn, once: the next message to him carries
   * them as context, and later messages do not repeat them.
   */
  takeContext(): string[] {
    const lines = this.unseen
    this.unseen = []
    return lines
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
      this.tracked.clear()
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

  private forget(entry: Tracked): void {
    if (this.tracked.get(entry.handle) === entry) {
      this.tracked.delete(entry.handle)
    }
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
    // Why only after working: quick hands never press Enter, so a terminal sits
    // idle until Carson (or ADAM) submits; that idle is not a finish.
    if (!entry.sawWorking) {
      return
    }
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
    await this.announce(entry, kind, status)
  }

  private async announce(
    entry: Tracked,
    settled: ConductorNoticeKind,
    status: ConductorStatus['status']
  ): Promise<void> {
    // Why claimed before the awaits: a poke during the reads must not announce twice.
    entry.askedAt = this.now()
    entry.settling = null
    const [label, read] = await Promise.all([
      this.deps.labelOf(entry.handle).catch(() => null),
      this.deps.read(entry.handle).catch(() => null)
    ])
    const reply = freshReply(read, entry.sentAt)
    // Why: an agent that ended its turn on a question is waiting for Carson, not done.
    const kind: ConductorNoticeKind =
      settled === 'done' && reply && lastSentenceAsks(reply) ? 'needs-you' : settled
    if (kind === 'done') {
      this.forget(entry)
    }
    const name = label?.trim() || 'A terminal'
    const text =
      kind === 'done' ? doneNotice(name, read, entry.sentAt) : needsYouNotice(name, read, status, entry.sentAt)
    this.unseen = [...this.unseen, text].slice(-CONTEXT_MAX_LINES)
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
