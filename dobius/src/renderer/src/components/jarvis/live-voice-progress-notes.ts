import { ADAM_PROGRESS_PHRASES, isAdamProgressStep } from '../../../../shared/adam-progress'
import type { LiveVoiceNotice } from '../../../../shared/speech-types'
import type { LiveVoiceApi } from './live-voice-call-types'
import { progressNoteEvent } from './live-voice-wire'

type ProgressNotice = Extract<LiveVoiceNotice, { kind: 'adam-progress' }>

/**
 * ADAM's progress on the request the voice handed him, as quiet notes tied to
 * that delegation (7.13). Why rebuilt from the step: main sends only a step
 * name, and the phrase comes from a fixed table, so no tool text reaches the
 * voice model.
 *
 * Why outstanding requests: a second delegation that main refuses (ADAM is
 * busy) must not inherit the first one's notes. A note is accepted only for
 * a delegation this window sent to main, under the same call, that has not
 * answered yet. Main already throttles; this drops repeats per delegation.
 */
export class LiveProgressNotes {
  private readonly outstanding = new Map<string, { callToken: string; last: string | null }>()

  /** The call's api, with every named delegate request known until main answers it. */
  track(api: LiveVoiceApi): LiveVoiceApi {
    return {
      ...api,
      liveDelegate: (request) => {
        const id = request.delegationId
        if (!id) {
          return api.liveDelegate(request)
        }
        const entry = { callToken: request.callToken, last: null }
        this.outstanding.set(id, entry)
        return api.liveDelegate(request).finally(() => {
          if (this.outstanding.get(id) === entry) {
            this.outstanding.delete(id)
          }
        })
      }
    }
  }

  /** The thinking.append to send for this notice, or null to send nothing. */
  note(notice: ProgressNotice): string | null {
    const entry = this.outstanding.get(notice.delegationId)
    if (!entry || entry.callToken !== notice.callToken) {
      return null
    }
    if (!isAdamProgressStep(notice.step) || notice.step === entry.last) {
      return null
    }
    entry.last = notice.step
    return progressNoteEvent(ADAM_PROGRESS_PHRASES[notice.step], notice.delegationId)
  }

  reset(): void {
    this.outstanding.clear()
  }
}
