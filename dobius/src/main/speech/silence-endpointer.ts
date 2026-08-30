/**
 * Pure VAD end-of-turn logic. NO imports on purpose: this module is bundled
 * into the STT worker thread, where the electron module is unavailable —
 * model download/resolution lives in vad-endpoint.ts on the main side.
 */

/**
 * Trailing NON-SPEECH (per VAD) that ends an utterance once speech was heard.
 * Kept at the tuned END_OF_SPEECH_SILENCE_S value from the old decoder-based
 * rule — the improvement is WHAT counts as silence, not how much of it.
 */
export const VAD_SILENCE_WINDOW_S = 0.6

/** Field names verified by probing the native addon (2026-08-30). */
export function buildSileroVadConfig(modelPath: string, sampleRate: number): object {
  return {
    sileroVad: {
      model: modelPath,
      threshold: 0.5,
      minSilenceDuration: 0.25,
      minSpeechDuration: 0.1,
      windowSize: 512,
      maxSpeechDuration: 20
    },
    sampleRate,
    numThreads: 1,
    provider: 'cpu',
    debug: 0
  }
}

export type EndpointDecision = { endOfTurn: boolean }

export type SilenceEndpointer = {
  feed(frame: { isSpeech: boolean; durationS: number }): EndpointDecision
  reset(): void
}

/**
 * After speech has been heard, `silenceWindowS` of consecutive VAD non-speech
 * ends the turn. Non-speech NOISE reads as non-speech here (silero's job), so
 * a fan or keyboard no longer holds the turn open the way it did under the
 * decoder's trailing-silence rule.
 */
export function createSilenceEndpointer(
  options: { silenceWindowS?: number } = {}
): SilenceEndpointer {
  const windowS = options.silenceWindowS ?? VAD_SILENCE_WINDOW_S
  let heardSpeech = false
  let trailingSilenceS = 0
  return {
    feed(frame) {
      if (frame.isSpeech) {
        heardSpeech = true
        trailingSilenceS = 0
        return { endOfTurn: false }
      }
      if (!heardSpeech) {
        return { endOfTurn: false }
      }
      trailingSilenceS += frame.durationS
      if (trailingSilenceS >= windowS) {
        heardSpeech = false
        trailingSilenceS = 0
        return { endOfTurn: true }
      }
      return { endOfTurn: false }
    },
    reset() {
      heardSpeech = false
      trailingSilenceS = 0
    }
  }
}
