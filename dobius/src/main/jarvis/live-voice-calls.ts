import { randomUUID } from 'node:crypto'
import type {
  AdamLookingAt,
  AdamThreadRow,
  JarvisAskResult,
  LiveDelegateResult,
  LiveVoiceNotice,
  OpenAiLiveErrorKind,
  OpenAiLiveFailure
} from '../../shared/speech-types'
import type { AdamProgressStep } from '../../shared/adam-progress'
import type { AdamAskOptions } from './adam-conversation'
import { AdamProgressThrottle } from './adam-progress'
import { logLiveVoiceProblem } from './live-voice-log'
import type { QuickHandsDeps } from './live-voice-quick-hands'
import { LiveQuickTurns } from './live-voice-quick-turns'
import { LIVE_METER_TICK_MS, type LiveVoiceMeter } from './live-voice-meter'
import { liveVoiceFailure } from './openai-live-session'
import { spokenFor } from './live-voice-spoken'
import { callLinesOf, LIVE_CALL_LINES_MAX, liveVoiceMessage } from './live-voice-message'

export { LIVE_SPOKEN_MAX_CHARS, LIVE_WORD_FOR_WORD_LEAD, speakableReply } from './live-voice-spoken'
export { callLinesOf, liveVoiceMessage } from './live-voice-message'

const LIVE_REQUEST_MAX_CHARS = 4_000
const LIVE_TRANSCRIPT_MAX_CHARS = 4_000

export const LIVE_STILL_WORKING_TEXT = 'ADAM is still working on the last thing. Ask again when he is done.'
export const LIVE_CAP_REACHED_TEXT =
  "Today's live voice spending cap is reached, so this call is ending. You can still type to ADAM on the Board, or raise the cap in Settings, Voice."
// Why 15 seconds: creating a WebRTC session bills 15 seconds up front
// (design doc section 1.7), whether or not the call ever connects.
export const LIVE_SETUP_RESERVE_SEC = 15
// Why main can end the call: a window that misses or ignores the cap notice
// must not keep billing. One meter tick after the cap, main ends it.
export const LIVE_CAP_FORCE_END_MS = 15_000
// Refusals OpenAI (or main) gave before any session existed: never billed.
const SETUP_NOT_BILLED: ReadonlySet<OpenAiLiveErrorKind> = new Set([
  'invalid-offer',
  'busy',
  'not-allowed',
  'not-ready',
  'no-key',
  'key-unreadable',
  'bad-key',
  'no-access',
  'no-billing',
  'rate-limited',
  'rejected',
  'over-cap',
  'meter-unavailable'
])

export const LIVE_CAP_WARNING_TEXT = "Heads up: about 80 percent of today's live voice budget is used."

export type LiveVoiceCallsDeps = {
  meter: LiveVoiceMeter
  capUsd: () => number
  /** Sends a notice to the window that owns the call. */
  notify: (notice: LiveVoiceNotice) => void
  ask: (text: string, options: AdamAskOptions) => Promise<JarvisAskResult>
  isAdamBusy: () => boolean
  cancelAdam: () => void
  lookingAt: () => AdamLookingAt | null
  appendThread: (row: AdamThreadRow) => Promise<void>
  /**
   * Ends the owning window's call without its help. Attempt 1, 2, ... so
   * the caller can escalate. The meter runs until the call is reported gone.
   */
  forceEnd?: (attempt: number) => void
  /** Instant local answers (terminals, usage) tried before ADAM; absent = ADAM only. */
  quickHands?: QuickHandsDeps
  /** The "Read ADAM's facts word for word" setting; absent = off. */
  wordForWord?: () => boolean
  /** Writes one line to the live voice log (defaults to the log file). */
  log?: (source: string, text: string) => void
  now?: () => number
  setInterval?: (handler: () => void, ms: number) => unknown
  clearInterval?: (timer: unknown) => void
}

/**
 * Main's side of an OpenAI Live call: the spend meter and cap, the delegated
 * requests to ADAM, and the transcript rows. The window owns the audio; main
 * owns every decision that costs money or reaches ADAM.
 */
export class LiveVoiceCalls {
  private ownerId: number | null = null
  private timer: unknown = null
  private delegation: { ownerId: number; token: symbol } | null = null
  private warnedDay: string | null = null
  // Why a token per call: transcript row ids are `live:<call>:<item>:<role>`,
  // stable within a call so a resent line is saved once.
  private callToken = ''
  private reserved: { seconds: number; day: string } | null = null
  private capReachedAt: number | null = null
  private forceAttempts = 0
  private readonly quickTurns: LiveQuickTurns | null
  // Why a generation: "stop" must also stop quick work that holds no ADAM turn.
  private stopGeneration = 0
  private quickInFlight = 0
  private readonly log: (source: string, text: string) => void
  private readonly progressNotes: AdamProgressThrottle

  constructor(private readonly deps: LiveVoiceCallsDeps) {
    this.log = deps.log ?? logLiveVoiceProblem
    // Why the check at send time: a step held back by the throttle must not
    // land after the request ended or Carson said stop.
    this.progressNotes = new AdamProgressThrottle({
      send: (step) => this.delegation && deps.notify({ kind: 'adam-progress', text: '', step }),
      now: deps.now
    })
    this.quickTurns = deps.quickHands
      ? new LiveQuickTurns({
          hands: deps.quickHands,
          appendThread: deps.appendThread,
          log: this.log,
          now: deps.now
        })
      : null
  }

  get activeOwnerId(): number | null {
    return this.ownerId
  }

  /**
   * Null when a new call may start, with its setup charge already saved;
   * the refusal otherwise. Every null is followed by callStarted or setupFailed.
   */
  reserveStart(): OpenAiLiveFailure | null {
    const meter = this.deps.meter
    if (!meter.available) {
      return liveVoiceFailure('meter-unavailable')
    }
    if (meter.status(this.deps.capUsd()).overCap) {
      return liveVoiceFailure('over-cap')
    }
    const day = meter.reserve(LIVE_SETUP_RESERVE_SEC)
    if (!day) {
      return liveVoiceFailure('meter-unavailable')
    }
    this.reserved = { seconds: LIVE_SETUP_RESERVE_SEC, day }
    return null
  }

  /** No call came of the reserved start; the charge stays unless never billed. */
  setupFailed(kind: OpenAiLiveErrorKind): void {
    if (this.reserved && SETUP_NOT_BILLED.has(kind)) {
      this.deps.meter.release(this.reserved.seconds, this.reserved.day)
    }
    this.reserved = null
  }

  /**
   * Returns the call's token; every later call IPC must carry it. The caller
   * registers the owner, then calls tick() so the first notice can reach it.
   */
  callStarted(ownerId: number): string {
    if (this.ownerId !== null) {
      this.callEnded(this.ownerId)
    }
    this.ownerId = ownerId
    this.callToken = randomUUID()
    this.quickTurns?.reset()
    this.capReachedAt = null
    this.forceAttempts = 0
    this.deps.meter.start(this.reserved?.seconds ?? 0)
    this.reserved = null
    const timer = (this.deps.setInterval ?? ((run, ms) => setInterval(run, ms)))(
      () => this.tick(),
      LIVE_METER_TICK_MS
    )
    ;(timer as { unref?: () => void } | null)?.unref?.()
    this.timer = timer
    return this.callToken
  }

  /** Session events the window saw on the data channel. */
  report(ownerId: number, event: unknown): boolean {
    if (ownerId !== this.ownerId) {
      return false
    }
    const type =
      event && typeof event === 'object' ? (event as { type?: unknown }).type : undefined
    if (type === 'paused') {
      this.deps.meter.setStandby(true)
    } else if (type === 'resumed') {
      this.deps.meter.setStandby(false)
    } else if (type === 'closed') {
      this.callEnded(ownerId)
    } else {
      return false
    }
    return true
  }

  /** The call is over (hung up, dropped, or its window closed). */
  callEnded(ownerId: number): void {
    if (ownerId !== this.ownerId) {
      return
    }
    this.ownerId = null
    if (this.timer !== null) {
      ;(this.deps.clearInterval ?? ((t) => clearInterval(t as NodeJS.Timeout)))(this.timer)
      this.timer = null
    }
    this.deps.meter.stop()
    this.cancelDelegation(ownerId)
  }

  tick(): void {
    if (this.ownerId === null) {
      return
    }
    const status = this.deps.meter.status(this.deps.capUsd())
    if (status.overCap) {
      // Why every tick: a window that missed the first notice still hangs up.
      this.deps.notify({ kind: 'cap-reached', text: LIVE_CAP_REACHED_TEXT })
      const now = (this.deps.now ?? Date.now)()
      this.capReachedAt ??= now
      if (now - this.capReachedAt >= LIVE_CAP_FORCE_END_MS) {
        this.forceAttempts += 1
        console.warn(`[jarvis-live] cap reached and the call is still open; ending it (try ${this.forceAttempts})`)
        this.deps.forceEnd?.(this.forceAttempts)
      }
      return
    }
    if (status.nearCap && this.warnedDay !== status.day) {
      this.warnedDay = status.day
      this.deps.notify({ kind: 'cap-warning', text: LIVE_CAP_WARNING_TEXT })
    }
  }

  async delegate(ownerId: number, payload: unknown): Promise<LiveDelegateResult> {
    if (ownerId !== this.ownerId) {
      return { ok: false, error: 'No live call is open in this window.' }
    }
    const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const request = typeof raw.request === 'string' ? raw.request.trim() : ''
    if (!request || request.length > LIVE_REQUEST_MAX_CHARS) {
      return { ok: false, error: 'The request was empty or too long.' }
    }
    const clock = this.deps.now ?? Date.now
    const startedAt = clock()
    const callToken = this.callToken
    const generation = this.stopGeneration
    const isCurrent = (): boolean =>
      this.ownerId === ownerId && this.callToken === callToken && this.stopGeneration === generation
    const windowLines = callLinesOf(raw.callLines)
    const timing = { outcome: 'error', quickMs: null as number | null, adamMs: null as number | null }
    let token: symbol | null = null
    try {
      // Why before the busy check: a quick hand never touches ADAM's turn, so it
      // may answer while he works on something else.
      if (this.quickTurns) {
        const quickStart = clock()
        this.quickInFlight += 1
        const quick = await this.quickTurns
          .tryAnswer(request, callToken, isCurrent, windowLines)
          .finally(() => {
            this.quickInFlight -= 1
          })
        timing.quickMs = clock() - quickStart
        if (quick) {
          timing.outcome = quick.outcome
          return quick.result
        }
      }
      // Why refuse here, before asking: a second spoken request while ADAM
      // works (or while a typed Board turn runs) must not cancel or queue.
      if (this.delegation || this.deps.isAdamBusy()) {
        timing.outcome = 'busy'
        return { ok: true, kind: 'error', speak: LIVE_STILL_WORKING_TEXT }
      }
      token = Symbol('live-delegation')
      this.delegation = { ownerId, token }
      this.progressNotes.reset()
      const adamStart = clock()
      const lines =
        this.quickTurns?.contextLines(windowLines, LIVE_CALL_LINES_MAX) ?? windowLines
      const result = await this.deps.ask(
        liveVoiceMessage(request, this.deps.lookingAt(), lines),
        { source: 'voice', said: request }
      )
      timing.adamMs = clock() - adamStart
      timing.outcome = 'adam'
      // Why re-check after the await: a hang-up or a new call while ADAM
      // worked means nobody is listening for this answer any more.
      // A "stop" clears the token: even an answer that finished meanwhile
      // must not be spoken.
      if (this.ownerId !== ownerId || this.delegation?.token !== token) {
        return { ok: true, kind: 'cancelled', speak: '' }
      }
      const speak = spokenFor(result, this.deps.wordForWord?.() === true)
      return { ok: true, kind: result.kind, speak }
    } finally {
      if (token && this.delegation?.token === token) {
        this.delegation = null
      }
      const quick = timing.quickMs === null ? '' : ` quick=${timing.quickMs}ms`
      const adam = timing.adamMs === null ? '' : ` hermes=${timing.adamMs}ms`
      this.log('timing', `${timing.outcome} ${clock() - startedAt}ms${quick}${adam}`)
    }
  }

  /** ADAM's progress on his running turn: passed on only while it is this call's request. */
  progress(step: AdamProgressStep): void {
    if (this.delegation !== null && this.delegation.ownerId === this.ownerId) {
      this.progressNotes.offer(step)
    }
  }

  /** Carson said stop, or the call ended: drop ADAM's work for this call only. */
  cancelDelegation(ownerId: number): boolean {
    const current = this.delegation
    const ownsAdamTurn = current !== null && current.ownerId === ownerId
    if (!ownsAdamTurn && ownerId !== this.ownerId) {
      return false
    }
    // Quick work in flight sees the new generation before its next write.
    this.stopGeneration += 1
    this.quickTurns?.dropPending()
    const stoppedQuick = this.quickInFlight > 0
    if (!ownsAdamTurn) {
      return stoppedQuick
    }
    this.delegation = null
    this.deps.cancelAdam()
    return true
  }

  /** A spoken line ADAM never saw (small talk), kept in his thread. */
  async recordTranscript(ownerId: number, payload: unknown): Promise<boolean> {
    if (ownerId !== this.ownerId) {
      return false
    }
    const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : null
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    const itemId =
      typeof raw.itemId === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(raw.itemId) ? raw.itemId : ''
    if (!role || !text || !itemId) {
      return false
    }
    try {
      await this.deps.appendThread({
        id: `live:${this.callToken}:${itemId}:${role}`,
        role,
        text: text.slice(0, LIVE_TRANSCRIPT_MAX_CHARS),
        voice: true
      })
      return true
    } catch (error) {
      // Why caught: the store rejects a failed disk write (the row stays in
      // memory and the window is told) or a bad row; the call goes on.
      console.warn('[jarvis-live] transcript row not saved:', error)
      return false
    }
  }
}
