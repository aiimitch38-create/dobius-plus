import {
  conductorSpeech,
  isSpeakableName,
  type ConductorSpoken
} from '../../../../shared/conductor-speech'
import { ADAM_NOTIFY_MAX_CHARS } from '../../../../shared/adam-speaks-up'
import type { LiveVoiceNotice } from '../../../../shared/speech-types'
import { LiveVoiceCall } from './live-voice-call'
import {
  LIVE_OUTPUT_AUDIBLE_LEVEL,
  LIVE_PROGRESS_AFTER_SPEECH_MS,
  LIVE_PROGRESS_MIN_GAP_MS,
  LIVE_REPORT_POLL_MS,
  LIVE_REPORT_QUIET_MS,
  type LiveVoiceCallDeps,
  type LiveVoiceSnapshot
} from './live-voice-call-types'
import { LiveProgressNotes } from './live-voice-progress-notes'
import { tapLiveMessages } from './live-voice-tap'
import { adamSaysEvent, parseLiveEvent, sayNowEvent, thinkingEvent } from './live-voice-wire'

// Why a cap: main rate-limits ADAM's taps; this only bounds a burst held through noise.
const ADAM_SAYS_HELD_MAX = 4

const isProgress = (update: ConductorSpoken): boolean =>
  update.event === 'started' || update.event === 'progress'

/**
 * A live call that also says the conductor's updates ("Juniper finished.").
 * Why a subclass: the call's own file holds the state machine; this only adds
 * a waiting line on top of it. What is said is rebuilt here from the event
 * and an allowlisted name (conductor-speech.ts): no terminal text reaches the
 * voice model.
 *
 * A report is said only after the call has been quiet for REPORT_QUIET:
 * shown as listening or standby (not speaking, not thinking on a request,
 * not connecting), no transcript of either side in that time, and Carson's
 * microphone never above the speech level at any sample. Reports that
 * arrive meanwhile are said together. Progress lines are the lowest
 * priority: dropped when a finish or a question is waiting, when Carson spoke
 * in the last 30 seconds, and to keep to one every 2 minutes.
 */
export class LiveVoiceReportingCall extends LiveVoiceCall {
  private reports: ConductorSpoken[] = []
  /** ADAM's own messages (`dobius adam notify`), said with the reports once quiet. */
  private adamSays: string[] = []
  private quietSince: number | null = null
  private lastHeardInputAt = Number.NEGATIVE_INFINITY
  private lastProgressAt = Number.NEGATIVE_INFINITY
  private timer: number | null = null
  private readonly progressNotes: LiveProgressNotes
  private readonly setTimer: (handler: () => void, ms: number) => number
  private readonly clearTimer: (timer: number) => void

  constructor(deps: LiveVoiceCallDeps, onChange?: (snapshot: LiveVoiceSnapshot) => void) {
    // Why a tap: the call reads its data channel itself; this hears the same
    // transcript events so a pause between Carson's words is not "quiet".
    const tap = { heard: (_data: unknown): void => undefined }
    const notes = new LiveProgressNotes()
    super(
      tapLiveMessages({ ...deps, api: notes.track(deps.api) }, (data) => tap.heard(data)),
      onChange
    )
    tap.heard = (data) => this.heard(data)
    this.progressNotes = notes
    this.setTimer = deps.setTimeout ?? ((handler, ms) => window.setTimeout(handler, ms))
    this.clearTimer = deps.clearTimeout ?? ((timer) => window.clearTimeout(timer))
  }

  override notice(notice: LiveVoiceNotice): void {
    if (notice.kind === 'adam-progress') {
      const note = this.active ? this.progressNotes.note(notice) : null
      if (note) {
        this.send(note)
      }
      return
    }
    if (notice.kind === 'reports-cleared') {
      if (notice.only === 'progress') {
        this.reports = this.reports.filter((update) => !isProgress(update))
      } else {
        this.dropReports()
      }
      return
    }
    if (notice.kind === 'adam-says') {
      this.holdAdamSays(notice.text)
      return
    }
    if (notice.kind !== 'report') {
      super.notice(notice)
      return
    }
    if (!this.active) {
      return
    }
    // Why rebuilt, not taken as text: only the event and a checked name are trusted.
    const update: ConductorSpoken = {
      event: notice.event,
      name: isSpeakableName(notice.name) ? notice.name : 'a terminal',
      ...(typeof notice.minutes === 'number' ? { minutes: Math.round(notice.minutes) } : {})
    }
    if (isProgress(update) && !this.progressWelcome()) {
      return
    }
    // Why no cap here: a long list is summarized when said, never dropped.
    this.reports = [...this.reports, update]
    if (this.timer === null) {
      this.watch()
    }
  }

  protected override teardown(): void {
    super.teardown()
    this.adamSays = []
    this.dropReports()
    this.progressNotes.reset()
  }

  private holdAdamSays(text: unknown): void {
    if (!this.active || typeof text !== 'string' || !text.trim()) {
      return
    }
    this.adamSays = [...this.adamSays, text.trim().slice(0, ADAM_NOTIFY_MAX_CHARS)].slice(
      -ADAM_SAYS_HELD_MAX
    )
    if (this.timer === null) {
      this.watch()
    }
  }

  private dropReports(): void {
    this.reports = []
    this.quietSince = null
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
    // Why: ADAM's own messages are not conductor reports; they still wait for quiet.
    if (this.adamSays.length > 0) {
      this.watch()
    }
  }

  /** A progress line now would be noise: a finish waits, Carson just spoke, or one was said lately. */
  private progressWelcome(): boolean {
    const now = this.now()
    return (
      !this.reports.some((update) => !isProgress(update)) &&
      now - this.lastHeardInputAt >= LIVE_PROGRESS_AFTER_SPEECH_MS &&
      now - this.lastProgressAt >= LIVE_PROGRESS_MIN_GAP_MS
    )
  }

  /** Any transcript, from Carson or the voice, restarts the quiet window. */
  private heard(data: unknown): void {
    const event = parseLiveEvent(data)
    if (event?.type === 'input' || event?.type === 'output') {
      this.quietSince = null
    }
    if (event?.type === 'input') {
      this.lastHeardInputAt = this.now()
    }
  }

  private looksQuiet(): boolean {
    const { state } = this.getSnapshot()
    return (
      (state === 'listening' || state === 'standby') &&
      this.getInputLevel() <= LIVE_OUTPUT_AUDIBLE_LEVEL &&
      this.getOutputLevel() <= LIVE_OUTPUT_AUDIBLE_LEVEL
    )
  }

  private watch(): void {
    this.timer = null
    if (this.reports.length === 0 && this.adamSays.length === 0) {
      return
    }
    const now = this.now()
    if (!this.looksQuiet()) {
      this.quietSince = null
    } else if (this.quietSince === null) {
      this.quietSince = now
    } else if (now - this.quietSince >= LIVE_REPORT_QUIET_MS) {
      this.sayHeld()
      return
    }
    this.timer = this.setTimer(() => this.watch(), LIVE_REPORT_POLL_MS)
  }

  private sayHeld(): void {
    const adamSays = this.adamSays
    this.adamSays = []
    for (const message of adamSays) {
      this.send(adamSaysEvent(message))
    }
    const important = this.reports.some((update) => !isProgress(update))
    // Why checked again: Carson may have spoken, or a line been said, while these waited.
    const updates = important
      ? this.reports.filter((update) => !isProgress(update))
      : this.progressWelcome()
        ? this.reports
        : []
    this.reports = []
    this.quietSince = null
    const say = conductorSpeech(updates)
    if (!say) {
      return
    }
    if (!important) {
      this.lastProgressAt = this.now()
    }
    this.send(sayNowEvent(say))
    this.send(thinkingEvent(say))
  }
}
