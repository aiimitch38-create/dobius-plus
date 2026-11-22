import type { LiveDelegateResult } from '../../../../shared/speech-types'
import type { LiveTranscriptLine, LiveVoiceApi } from './live-voice-call-types'

/**
 * The window's side of one call as main knows it: every message carries
 * the token main issued at connect, so a late message from an earlier call
 * never touches the call that replaced it. Without a token nothing is sent.
 */
export class LiveSessionLink {
  private token: string | null = null

  constructor(private readonly api: LiveVoiceApi) {}

  adopt(token: string | null): void {
    this.token = token
  }

  /** `token`: report for a call this link never adopted (a stale connect). */
  report(type: 'paused' | 'resumed' | 'closed', token = this.token): void {
    if (token) {
      void this.api.liveSessionReport({ type, callToken: token }).catch(() => undefined)
    }
  }

  /** Reports the call closed and forgets it. */
  close(): void {
    this.report('closed')
    this.token = null
  }

  transcript(line: LiveTranscriptLine): void {
    if (this.token) {
      void this.api.liveTranscript({ ...line, callToken: this.token }).catch(() => undefined)
    }
  }

  delegate(request: string, callLines: string[]): Promise<LiveDelegateResult> {
    if (!this.token) {
      return Promise.resolve({ ok: false, error: 'no call' })
    }
    return this.api
      .liveDelegate({ request, callLines, callToken: this.token })
      .catch((): LiveDelegateResult => ({ ok: false, error: 'unreachable' }))
  }

  cancel(): void {
    if (this.token) {
      void this.api.liveCancel({ callToken: this.token }).catch(() => undefined)
    }
  }
}
