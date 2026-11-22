import type { OpenAiLiveErrorKind } from '../../../../shared/speech-types'
import type { NamedTimers } from './live-voice-timers'

// Why these numbers: the Live API ends a connected call after 2 hours with
// reason `expired` (design doc section 1.4, partly verified), so a call is
// recycled 5 minutes early at a quiet moment, or forced 4 minutes later.
// A dropped call is retried three times with growing waits, then given up.
export const LIVE_SESSION_MAX_MS = 2 * 60 * 60_000
export const LIVE_RECYCLE_LEAD_MS = 5 * 60_000
export const LIVE_RECYCLE_FORCE_AFTER_MS = 4 * 60_000
export const LIVE_RECYCLE_RETRY_MS = 5_000
export const LIVE_RECYCLE_MIN_MS = 60_000
export const LIVE_RECONNECT_DELAYS_MS = [1_000, 3_000, 8_000] as const

/** Setup failures worth another try; a cap, key or access refusal is final. */
export const LIVE_RETRYABLE_KINDS: ReadonlySet<OpenAiLiveErrorKind> = new Set([
  'busy',
  'network',
  'timeout',
  'server',
  'rate-limited',
  'cancelled'
])

/** What the reconnect logic needs from the call. */
export type ReconnectHost = {
  timers: NamedTimers
  now: () => number
  /** Nobody is talking and ADAM is not working: a good moment to recycle. */
  isQuiet: () => boolean
  /** Closes the current session and opens a new one after the wait. */
  reopen: (delayMs: number) => void
  /** Out of retries: end the call and say why. */
  giveUp: () => void
}

/**
 * When to reconnect a call. The call does the closing and opening, and every
 * new session is seeded from ADAM's thread by main.
 */
export class LiveReconnectPolicy {
  private attempts = 0
  private forceAt = 0
  // True from a drop or recycle until the next session.started.
  private reconnecting = false

  constructor(private readonly host: ReconnectHost) {}

  /** session.started: a good connection resets the retry count and plans the recycle. */
  started(expiresAtMs: number | null): void {
    this.attempts = 0
    this.reconnecting = false
    const now = this.host.now()
    const recycleAt = (expiresAtMs ?? now + LIVE_SESSION_MAX_MS) - LIVE_RECYCLE_LEAD_MS
    this.forceAt = recycleAt + LIVE_RECYCLE_FORCE_AFTER_MS
    this.host.timers.arm('recycle', Math.max(LIVE_RECYCLE_MIN_MS, recycleAt - now), () =>
      this.recycle()
    )
  }

  /**
   * The call dropped without a hang-up. Why a new session, not a repair: the
   * Live API documents no resume without stored recordings.
   */
  dropped(): void {
    const delay = LIVE_RECONNECT_DELAYS_MS[this.attempts]
    if (delay === undefined) {
      this.host.giveUp()
      return
    }
    this.attempts += 1
    this.reconnecting = true
    this.host.reopen(delay)
  }

  /** True when a failed reconnect should be counted as one more drop. */
  retries(kind: OpenAiLiveErrorKind): boolean {
    return this.reconnecting && LIVE_RETRYABLE_KINDS.has(kind)
  }

  reset(): void {
    this.attempts = 0
    this.reconnecting = false
  }

  private recycle(): void {
    if (!this.host.isQuiet() && this.host.now() < this.forceAt) {
      this.host.timers.arm('recycle', LIVE_RECYCLE_RETRY_MS, () => this.recycle())
      return
    }
    this.reconnecting = true
    this.host.reopen(0)
  }
}
