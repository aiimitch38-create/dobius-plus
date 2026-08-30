import type { Store } from '../persistence'
import { getLocalSpeaker, getSpeechSttService } from '../speech/speech-runtime-service'
import { createBargeIn, tapSttKeywordDetections } from './barge-in'
import { tapSttFinalTranscripts } from './jarvis-service'
import type { JarvisService } from './jarvis-service'

export function wireWakeWordObservation(store: Store, service: JarvisService): void {
  // The matcher inside the service no-ops unless voice.jarvisWakeWord is on,
  // so the tap stays permanently installed and cheap while dictation is idle.
  tapSttFinalTranscripts(getSpeechSttService(store), (text) =>
    service.handleAmbientTranscript(text)
  )
}

/**
 * Wake-keyword barge-in, half-duplex: a worker "adam" detection while local
 * TTS is speaking flushes playback (<100 ms — the afplay child is killed) and
 * resets the phase to listening. Idle-time detections are ignored here — the
 * ambient wake-word matcher owns those.
 */
export function wireBargeIn(store: Store, service: JarvisService): void {
  const bargeIn = createBargeIn({
    isTtsSpeaking: () => getLocalSpeaker(store).isSpeaking(),
    stopTts: () => getLocalSpeaker(store).stop(),
    onBargedIn: () => service.handleBargeIn()
  })
  tapSttKeywordDetections(getSpeechSttService(store), () => bargeIn.onKeywordDetected())
}
