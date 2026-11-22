import {
  LIVE_DELEGATION_SETTLE_MAX_MS,
  LIVE_DELEGATION_SETTLE_MS,
  LIVE_MAX_PENDING_DELEGATIONS,
  LIVE_NOT_HEARD_TEXT,
  LIVE_UNREACHABLE_TEXT
} from './live-voice-call-types'
import type { LiveSessionLink } from './live-voice-link'
import type { NamedTimers } from './live-voice-timers'
import { isHangUpIntent, isStopIntent, type LiveTranscript } from './live-voice-transcript'
import { commentaryEvent } from './live-voice-wire'

/** What the delegation bridge needs from the call that owns it. */
export type DelegationHost = {
  link: LiveSessionLink
  transcript: LiveTranscript
  timers: NamedTimers
  now: () => number
  lastInputAt: () => number
  /** The call's generation; a change means the call this work was for is over. */
  generation: () => number
  send: (data: string) => void
  /** Re-derives the shown state (thinking while work is pending). */
  settle: () => void
}

/**
 * The client side of `client` delegation: the voice model says "ADAM should
 * handle this", the bridge takes Carson's words from the transcript, asks
 * ADAM through main, and hands the spoken answer back as commentary.
 */
export class LiveDelegations {
  private pending = 0
  private waitingForWords = 0
  // Why an epoch: "stop" bumps it, and work started before it is neither sent
  // to ADAM nor spoken, whatever main answers.
  private epoch = 0

  constructor(private readonly host: DelegationHost) {}

  get count(): number {
    return this.pending
  }

  /** True while a delegation has not yet taken Carson's words. */
  get awaitingWords(): boolean {
    return this.waitingForWords > 0
  }

  reset(): void {
    this.pending = 0
    this.waitingForWords = 0
  }

  /** Drops ADAM's work for this call, if any is running. */
  cancel(): void {
    this.epoch += 1
    if (this.pending > 0) {
      this.host.link.cancel()
    }
  }

  async run(delegationId: string | null): Promise<void> {
    const host = this.host
    if (this.pending >= LIVE_MAX_PENDING_DELEGATIONS) {
      return
    }
    const generation = host.generation()
    const epoch = this.epoch
    const isCurrent = (): boolean => host.generation() === generation && this.epoch === epoch
    this.pending += 1
    this.waitingForWords += 1
    host.settle()
    try {
      // Why wait for words first: the delegation can arrive before the
      // transcript of what Carson said. Then wait for him to finish.
      const startedAt = host.now()
      const waiting = (): boolean =>
        host.transcript.peekInput() === '' ||
        host.now() - host.lastInputAt() < LIVE_DELEGATION_SETTLE_MS
      while (waiting() && host.now() - startedAt < LIVE_DELEGATION_SETTLE_MAX_MS) {
        await host.timers.sleep(100)
        if (!isCurrent()) {
          return
        }
      }
      this.waitingForWords = Math.max(0, this.waitingForWords - 1)
      const request = host.transcript.takeRequest()
      if (!request) {
        host.send(commentaryEvent(LIVE_NOT_HEARD_TEXT, delegationId))
        return
      }
      // Why: the model may hand "stop" itself over as a request. It must
      // cancel ADAM's work, not reach ADAM as a new message.
      if (isStopIntent(request)) {
        this.epoch += 1
        host.link.cancel()
        return
      }
      if (!isCurrent()) {
        return
      }
      const result = await host.link.delegate(request, host.transcript.recentLines())
      const say = result.ok ? result.speak : LIVE_UNREACHABLE_TEXT
      if (isCurrent() && say) {
        // ADAM's answer is already in his thread (askAdam wrote it).
        if (result.ok) {
          host.transcript.expectReply()
        }
        host.send(commentaryEvent(say, delegationId))
      }
    } finally {
      if (host.generation() === generation) {
        this.pending = Math.max(0, this.pending - 1)
        host.settle()
      }
    }
  }

  /**
   * Checks Carson's finished phrase: "stop" cancels ADAM's work, "hang up"
   * asks the call to end. Returns true for a hang-up.
   */
  checkIntent(): boolean {
    const said = this.host.transcript.peekInput()
    if (isStopIntent(said)) {
      this.host.transcript.discardInput()
      this.cancel()
      return false
    }
    return isHangUpIntent(said)
  }
}
