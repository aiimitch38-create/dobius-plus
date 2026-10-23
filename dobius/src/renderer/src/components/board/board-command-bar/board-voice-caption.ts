import type { DictationState } from '../../../../../shared/speech-types'

export type BoardVoiceCaptionPhase = 'listening' | 'processing' | null

/** What the caption under the command bar says about the mic right now. */
export function boardVoiceCaptionPhase(state: DictationState): BoardVoiceCaptionPhase {
  if (state === 'starting' || state === 'listening') {
    return 'listening'
  }
  return state === 'stopping' ? 'processing' : null
}

/**
 * The words heard so far this session: finished segments the dictation
 * controller already typed into the draft (everything after the draft as it
 * was when listening began) followed by the live partial transcript.
 */
export function boardVoiceCaptionText(
  draftAtStart: string,
  draft: string,
  partial: string
): string {
  const spoken = draft.startsWith(draftAtStart) ? draft.slice(draftAtStart.length) : draft
  return [spoken.trim(), partial.trim()].filter(Boolean).join(' ')
}
