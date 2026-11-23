import type { LiveVoiceNotice } from '../../../../shared/speech-types'
import { LiveVoiceCall } from './live-voice-call'
import {
  LIVE_OUTPUT_AUDIBLE_LEVEL,
  LIVE_REPORT_POLL_MS,
  LIVE_REPORT_QUIET_MS,
  LIVE_REPORTS_MAX,
  liveReportsText,
  type LiveReport,
  type LiveVoiceCallDeps,
  type LiveVoiceSnapshot
} from './live-voice-call-types'
import { tapLiveMessages } from './live-voice-tap'
import { parseLiveEvent, sayNowEvent, thinkingEvent } from './live-voice-wire'

/**
 * A live call that also says the conductor's reports ("Juniper says it's
 * done: ..."). Why a subclass: the call's own file holds the state machine;
 * this only adds a waiting line on top of it.
 *
 * A report is said only after the call has been quiet for REPORT_QUIET:
 * shown as listening or standby (not speaking, not thinking on a request,
 * not connecting), no transcript of either side in that time, and Carson's
 * microphone never above the speech level at any sample. Reports that
 * arrive meanwhile are said together; past five, the rest are summarized.
 */
export class LiveVoiceReportingCall extends LiveVoiceCall {
  private reports: LiveReport[] = []
  private quietSince: number | null = null
  private timer: number | null = null
  private readonly setTimer: (handler: () => void, ms: number) => number
  private readonly clearTimer: (timer: number) => void

  constructor(deps: LiveVoiceCallDeps, onChange?: (snapshot: LiveVoiceSnapshot) => void) {
    // Why a tap: the call reads its data channel itself; this hears the same
    // transcript events so a pause between Carson's words is not "quiet".
    const tap = { heard: (_data: unknown): void => undefined }
    super(tapLiveMessages(deps, (data) => tap.heard(data)), onChange)
    tap.heard = (data) => this.heard(data)
    this.setTimer = deps.setTimeout ?? ((handler, ms) => window.setTimeout(handler, ms))
    this.clearTimer = deps.clearTimeout ?? ((timer) => window.clearTimeout(timer))
  }

  override notice(notice: LiveVoiceNotice): void {
    if (notice.kind === 'reports-cleared') {
      this.dropReports()
      return
    }
    if (notice.kind !== 'report') {
      super.notice(notice)
      return
    }
    if (!this.active) {
      return
    }
    // Why no cap here: a long list is summarized when said, never dropped.
    this.reports = [...this.reports, { text: notice.text, label: notice.label }]
    if (this.timer === null) {
      this.watch()
    }
  }

  protected override teardown(): void {
    super.teardown()
    this.dropReports()
  }

  private dropReports(): void {
    this.reports = []
    this.quietSince = null
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }

  /** Any transcript, from Carson or the voice, restarts the quiet window. */
  private heard(data: unknown): void {
    const event = parseLiveEvent(data)
    if (event?.type === 'input' || event?.type === 'output') {
      this.quietSince = null
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
    if (this.reports.length === 0) {
      return
    }
    const now = this.now()
    if (!this.looksQuiet()) {
      this.quietSince = null
    } else if (this.quietSince === null) {
      this.quietSince = now
    } else if (now - this.quietSince >= LIVE_REPORT_QUIET_MS) {
      const say = liveReportsText(this.reports, LIVE_REPORTS_MAX)
      this.reports = []
      this.quietSince = null
      this.send(sayNowEvent(say))
      this.send(thinkingEvent(say))
      return
    }
    this.timer = this.setTimer(() => this.watch(), LIVE_REPORT_POLL_MS)
  }
}
