import type { LiveVoiceNotice } from '../../../../shared/speech-types'
import { LiveVoiceCall } from './live-voice-call'
import {
  LIVE_OUTPUT_AUDIBLE_LEVEL,
  LIVE_REPORT_POLL_MS,
  LIVE_REPORT_QUIET_MS,
  LIVE_REPORTS_MAX,
  liveReportsText,
  type LiveVoiceCallDeps,
  type LiveVoiceSnapshot
} from './live-voice-call-types'
import { commentaryEvent } from './live-voice-wire'

/**
 * A live call that also says the conductor's reports ("Juniper says it's
 * done: ..."). Why a subclass: the call's own file holds the state machine;
 * this only adds a waiting line on top of it.
 *
 * A report is said only after the call has looked quiet for REPORT_QUIET:
 * shown as listening or standby (not speaking, not thinking on a request,
 * not connecting) and Carson's microphone below the speech level. Reports
 * that arrive meanwhile are said together.
 */
export class LiveVoiceReportingCall extends LiveVoiceCall {
  private reports: string[] = []
  private quietSince: number | null = null
  private timer: number | null = null
  private readonly setTimer: (handler: () => void, ms: number) => number
  private readonly clearTimer: (timer: number) => void

  constructor(deps: LiveVoiceCallDeps, onChange?: (snapshot: LiveVoiceSnapshot) => void) {
    super(deps, onChange)
    this.setTimer = deps.setTimeout ?? ((handler, ms) => window.setTimeout(handler, ms))
    this.clearTimer = deps.clearTimeout ?? ((timer) => window.clearTimeout(timer))
  }

  override notice(notice: LiveVoiceNotice): void {
    if (notice.kind !== 'report') {
      super.notice(notice)
      return
    }
    if (!this.active) {
      return
    }
    this.reports = [...this.reports, notice.text].slice(-LIVE_REPORTS_MAX)
    if (this.timer === null) {
      this.watch()
    }
  }

  protected override teardown(): void {
    super.teardown()
    this.reports = []
    this.quietSince = null
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
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
    } else {
      this.quietSince ??= now
      if (now - this.quietSince >= LIVE_REPORT_QUIET_MS) {
        const say = liveReportsText(this.reports)
        this.reports = []
        this.quietSince = null
        this.send(commentaryEvent(say, null))
        return
      }
    }
    this.timer = this.setTimer(() => this.watch(), LIVE_REPORT_POLL_MS)
  }
}
