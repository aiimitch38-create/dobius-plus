import type { SttEventSink } from '../speech/stt-service'

export type BargeInDeps = {
  isTtsSpeaking: () => boolean
  /** Flushes the TTS queue and kills current playback (LocalSpeaker.stop). */
  stopTts: () => void
  /** Fires AFTER a real barge-in — broadcast a listening state, etc. */
  onBargedIn: () => void
}

export type BargeIn = {
  /** Returns true when a barge-in actually happened. */
  onKeywordDetected(): boolean
}

/**
 * Half-duplex, keyword-gated interruption. Electron's AEC is broken, so
 * speaker output bleeds into the mic — gating on the wake keyword while TTS
 * is SPEAKING is the designed mitigation, NOT open-mic interruption, and no
 * AEC is attempted. When TTS is idle a detection is ignored here (the normal
 * wake-word flow owns it).
 */
export function createBargeIn(deps: BargeInDeps): BargeIn {
  return {
    onKeywordDetected(): boolean {
      if (!deps.isTtsSpeaking()) {
        return false
      }
      deps.stopTts()
      deps.onBargedIn()
      return true
    }
  }
}

type SttDictationStarter = (
  modelId: string,
  sink: SttEventSink,
  hotwordsFilePath?: string,
  owner?: string
) => Promise<void>

const tappedForKeywords = new WeakSet<object>()

/**
 * Observes worker keyword detections without touching sink ownership — the
 * same wrap-startDictation pattern as `tapSttFinalTranscripts`, for the same
 * reason: SttService keeps exactly one sink and offers no subscribe API.
 */
export function tapSttKeywordDetections(
  stt: { startDictation: SttDictationStarter },
  onKeyword: (keyword: string) => void
): () => void {
  if (tappedForKeywords.has(stt)) {
    return () => undefined
  }
  tappedForKeywords.add(stt)
  const original = stt.startDictation.bind(stt)
  stt.startDictation = async (...args: Parameters<SttDictationStarter>) => {
    const [modelId, sink, ...rest] = args
    const tappedSink: SttEventSink = (event) => {
      if (event.type === 'keyword') {
        onKeyword(event.keyword ?? '')
      }
      sink(event)
    }
    return original(modelId, tappedSink, ...rest)
  }
  return () => {
    stt.startDictation = original
  }
}
