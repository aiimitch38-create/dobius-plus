import type {
  LiveVoiceMicMode,
  LiveVoiceNotice,
  OpenAiLiveErrorKind
} from '../../../../shared/speech-types'
import {
  LIVE_CAP_HANG_UP_GRACE_MS,
  LIVE_CONNECT_TIMEOUT_MS,
  LIVE_DROPPED_TEXT,
  LIVE_HANG_UP_GRACE_MS,
  LIVE_IDLE_HANGUP_MS,
  LIVE_INTENT_SETTLE_MS,
  LIVE_SPEAKING_QUIET_MS,
  type LivePeerCall,
  type LiveVoiceCallDeps,
  type LiveVoiceSnapshot,
  sameSnapshot
} from './live-voice-call-types'
import { closeLivePeer, muteLivePeer, openLivePeer } from './live-voice-peer'
import { NamedTimers } from './live-voice-timers'
import { LiveDelegations } from './live-voice-delegation'
import { LIVE_RECYCLE_RETRY_MS, LiveReconnectPolicy } from './live-voice-reconnect'
import { LiveLevels } from './live-voice-levels'
import { LiveSessionLink } from './live-voice-link'
import { LiveTranscript } from './live-voice-transcript'
import { commentaryEvent, muteEvent, parseLiveEvent, type LiveEvent } from './live-voice-wire'

/**
 * One OpenAI Live call: the microphone, the WebRTC peer, the data channel,
 * and the handoff of every real request to ADAM through main.
 *
 * Why a plain class under the hook: the state machine is tested with fake
 * peers and timers, and React only renders its snapshot.
 */
export class LiveVoiceCall {
  private call: LivePeerCall | null = null
  private starting = false
  // Why a generation: hang-up can land while start() is still awaiting the
  // microphone or main. Each start owns one generation; a start that resumes
  // after a newer one began closes whatever it opened.
  private generation = 0
  private snapshot: LiveVoiceSnapshot = { state: 'idle', muted: false, errorText: null }
  private readonly transcript: LiveTranscript
  private readonly timers: NamedTimers
  private readonly delegations: LiveDelegations
  private lastInputAt = 0
  private capWarned = false
  private readonly reconnect: LiveReconnectPolicy
  private readonly levels: LiveLevels
  private readonly link: LiveSessionLink

  constructor(
    private readonly deps: LiveVoiceCallDeps,
    private readonly onChange: (snapshot: LiveVoiceSnapshot) => void = () => undefined
  ) {
    this.timers = new NamedTimers(deps.setTimeout, deps.clearTimeout)
    this.levels = new LiveLevels(deps.levelOf)
    this.link = new LiveSessionLink(deps.api)
    this.transcript = new LiveTranscript((line) => this.link.transcript(line), this.now)
    this.delegations = new LiveDelegations({
      link: this.link,
      transcript: this.transcript,
      timers: this.timers,
      now: () => this.now(),
      lastInputAt: () => this.lastInputAt,
      generation: () => this.generation,
      send: (data) => this.send(data),
      settle: () => this.settleState()
    })
    this.reconnect = new LiveReconnectPolicy({
      timers: this.timers,
      now: () => this.now(),
      isQuiet: () =>
        (this.snapshot.state === 'listening' || this.snapshot.state === 'standby') &&
        this.delegations.count === 0 &&
        this.now() - this.lastInputAt > LIVE_RECYCLE_RETRY_MS,
      reopen: (delayMs) => this.reopen(delayMs),
      giveUp: () => void this.hangUp(LIVE_DROPPED_TEXT)
    })
  }

  getSnapshot = (): LiveVoiceSnapshot => this.snapshot

  get active(): boolean {
    return this.call !== null || this.starting || this.timers.has('reconnect')
  }

  getInputLevel = (): number => (this.snapshot.muted ? 0 : this.levels.read('input'))
  getOutputLevel = (): number => this.levels.read('output')

  /** The orb or Cmd+T: start a call, or (push-to-talk) mute and unmute, or hang up. */
  press(micMode: LiveVoiceMicMode): void {
    if (!this.active) {
      void this.start()
      return
    }
    if (micMode === 'push-to-talk' && this.call?.connected) {
      this.setMuted(!this.snapshot.muted)
      return
    }
    void this.hangUp()
  }

  async start(): Promise<void> {
    if (this.active) {
      return
    }
    this.timers.clear('reconnect')
    this.starting = true
    const generation = ++this.generation
    const isCurrent = (): boolean => this.generation === generation
    this.update({ state: 'connecting', errorText: null })
    try {
      const opened = await openLivePeer(this.deps, this.snapshot.muted, isCurrent, {
        onMessage: (data) => {
          const event = parseLiveEvent(data)
          if (event) {
            this.handle(event)
          }
        },
        onDropped: (why) => this.dropped(why),
        onRemoteStream: (stream) => this.levels.set('output', stream)
      })
      if (!opened) {
        return
      }
      const { call, offerSdp } = opened
      this.call = call
      this.levels.set('input', call.mic)
      const result = await this.deps.api.liveSessionConnect(offerSdp)
      if (!isCurrent()) {
        // Why report: main already counts this session as this window's
        // call, and its meter must stop. Its own token, never the new call's.
        if (result.ok) {
          this.link.report('closed', result.callToken ?? null)
        }
        return
      }
      if (!result.ok) {
        this.failOrRetry(result.error, result.kind)
        return
      }
      call.connected = true
      this.link.adopt(result.callToken ?? null)
      await call.peer.setRemoteDescription({ type: 'answer', sdp: result.answerSdp })
      if (isCurrent()) {
        this.timers.arm('connect', LIVE_CONNECT_TIMEOUT_MS, () =>
          this.dropped('the call never started')
        )
      }
    } catch (error) {
      if (isCurrent()) {
        this.failOrRetry(error instanceof Error ? error.message : String(error), 'network')
      }
    } finally {
      if (isCurrent()) {
        this.starting = false
      }
    }
  }

  /** Ends the call for good: saves the transcript, cancels ADAM's work, closes audio. */
  async hangUp(errorText: string | null = null): Promise<void> {
    this.generation += 1
    this.starting = false
    this.reconnect.reset()
    this.delegations.cancel()
    this.teardown()
    this.update({ state: errorText ? 'error' : 'idle', errorText, muted: false })
  }

  setMuted(muted: boolean): void {
    if (this.call) {
      muteLivePeer(this.call, muted)
    }
    this.update({ muted })
    this.settleState()
  }

  /** A spending-cap notice from main. */
  notice(notice: LiveVoiceNotice): void {
    if (!this.call) {
      return
    }
    const warning = notice.kind === 'cap-warning'
    if (!(warning && this.capWarned) && !this.timers.has('cap')) {
      this.send(commentaryEvent(notice.text, null))
    }
    this.capWarned ||= warning
    if (!warning && !this.timers.has('cap')) {
      // Why a grace: let the voice say why before the line goes dead. A drop
      // meanwhile reconnects, and main then refuses the new call over the cap.
      this.timers.arm('cap', LIVE_CAP_HANG_UP_GRACE_MS, () => void this.hangUp(notice.text))
    }
  }

  private handle(event: LiveEvent): void {
    switch (event.type) {
      case 'started':
        this.timers.clear('connect')
        this.reconnect.started(event.expiresAtMs)
        this.touchIdle()
        if (this.snapshot.muted) {
          this.send(muteEvent(true))
        }
        this.settleState()
        return
      case 'paused':
        this.link.report('paused')
        if (this.snapshot.state !== 'thinking') {
          this.update({ state: 'standby' })
        }
        return
      case 'resumed':
        this.link.report('resumed')
        this.touchIdle()
        this.settleState()
        return
      case 'input':
        this.transcript.addInput(event.delta, this.delegations.awaitingWords)
        this.lastInputAt = this.now()
        this.touchIdle()
        if (this.snapshot.state === 'standby') {
          this.settleState()
        }
        this.timers.arm('intent', LIVE_INTENT_SETTLE_MS, () => this.checkIntent())
        return
      case 'output':
        this.transcript.addOutput(event.delta)
        this.touchIdle()
        this.update({ state: 'speaking' })
        this.timers.arm('speaking', LIVE_SPEAKING_QUIET_MS, () => {
          this.transcript.replyFinished()
          this.settleState()
        })
        return
      case 'delegation':
        this.touchIdle()
        void this.delegations.run(event.id)
        return
      case 'closed':
        this.dropped(`the session closed (${event.reason})`)
        return
      case 'error':
        console.warn('[live-voice] session error:', event.message)
        break
      default:
        break
    }
  }

  private checkIntent(): void {
    if (this.delegations.checkIntent()) {
      // Why a grace: let the voice say goodbye before the line goes dead.
      this.timers.arm('hangup', LIVE_HANG_UP_GRACE_MS, () => void this.hangUp())
    }
  }

  /** The call ended without Carson hanging up. */
  private dropped(why: string): void {
    console.warn(`[live-voice] call dropped: ${why}`)
    this.logProblem(`dropped: ${why}`)
    this.reconnect.dropped()
  }

  private reopen(delayMs: number): void {
    this.generation += 1
    // Why: a drop can land while start() still awaits; that start is retired
    // and its finally no longer runs, so its flag is cleared here.
    this.starting = false
    this.delegations.cancel()
    this.teardown()
    this.update({ state: 'connecting' })
    this.timers.arm('reconnect', delayMs, () => void this.start())
  }

  /** Closes the current leg and tells main. Never changes the shown state. */
  protected teardown(): void {
    this.timers.clearAll()
    const call = this.call
    this.call = null
    this.delegations.reset()
    this.levels.dispose()
    if (!call) {
      return
    }
    // Why before reporting closed: main only saves lines for its active call.
    if (call.connected) {
      this.transcript.endCall()
      this.link.close()
    }
    closeLivePeer(call)
  }

  protected settleState(): void {
    if (!this.call || this.snapshot.state === 'error' || this.timers.has('speaking')) {
      return
    }
    if (this.delegations.count > 0) {
      this.update({ state: 'thinking' })
      return
    }
    this.update({ state: this.snapshot.muted ? 'standby' : 'listening' })
  }

  protected touchIdle(): void {
    this.timers.arm('idle', LIVE_IDLE_HANGUP_MS, () => {
      if (this.delegations.count > 0) {
        this.touchIdle()
        return
      }
      void this.hangUp()
    })
  }

  /** A reconnect that fails for a passing reason keeps trying; others stop. */
  private failOrRetry(errorText: string, kind: OpenAiLiveErrorKind): void {
    if (this.reconnect.retries(kind)) {
      this.dropped(`reconnect failed (${kind})`)
      return
    }
    this.fail(errorText)
  }

  private logProblem(text: string): void {
    void this.deps.api
      .liveLog?.({ text })
      .catch((error: unknown) => console.warn('[live-voice] log failed', error))
  }

  private fail(errorText: string): void {
    console.error(`[live-voice] call failed: ${errorText}`)
    this.logProblem(`failed: ${errorText}`)
    this.teardown()
    this.starting = false
    this.update({ state: 'error', errorText })
  }

  protected send(data: string): void {
    const channel = this.call?.channel
    if (channel && channel.readyState === 'open') {
      channel.send(data)
    }
  }

  protected now = (): number => (this.deps.now ?? Date.now)()

  protected update(patch: Partial<LiveVoiceSnapshot>): void {
    const next = { ...this.snapshot, ...patch }
    if (!sameSnapshot(next, this.snapshot)) {
      this.snapshot = next
      this.onChange(next)
    }
  }
}
