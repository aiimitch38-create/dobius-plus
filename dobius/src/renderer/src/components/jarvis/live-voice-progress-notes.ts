import { ADAM_PROGRESS_PHRASES, isAdamProgressStep } from '../../../../shared/adam-progress'
import type { LiveEvent } from './live-voice-wire'
import { progressNoteEvent } from './live-voice-wire'

/**
 * ADAM's progress on the request the voice handed him, as quiet notes tied to
 * that delegation (7.13). Why rebuilt from the step: main sends only a step
 * name, and the phrase comes from a fixed table, so no tool text reaches the
 * voice model. Main already throttles; this drops repeats within a request.
 */
export class LiveProgressNotes {
  private delegationId: string | null = null
  private last: string | null = null

  /** Every data-channel event the call sees: a new delegation starts fresh. */
  seen(event: LiveEvent | null): void {
    if (event?.type === 'delegation') {
      this.delegationId = event.id
      this.last = null
    }
  }

  /** The thinking.append to send for this step, or null to send nothing. */
  note(step: unknown): string | null {
    if (!isAdamProgressStep(step) || step === this.last) {
      return null
    }
    this.last = step
    return progressNoteEvent(ADAM_PROGRESS_PHRASES[step], this.delegationId)
  }

  reset(): void {
    this.delegationId = null
    this.last = null
  }
}
