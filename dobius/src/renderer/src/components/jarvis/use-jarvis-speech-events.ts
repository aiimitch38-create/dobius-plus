import { useEffect } from 'react'
import type {
  SpeechErrorEvent,
  SpeechTranscriptEvent
} from '../../../../shared/speech-types'
import { AMBIENT_SESSION_ID, type JarvisSessionRegistry } from './jarvis-capture-controls'
import type { StoppedSessionTracker } from './jarvis-stopped-sessions-tracker'

// Same anchored shape as main's wake-word-matcher: the phrase must START the
// transcript so mid-sentence mentions of Adam never arm the hint.
const WAKE_PHRASE_ECHO = /^\s*hey[, ]*adam\b/i

export function matchesWakePhrase(text: string): boolean {
  return WAKE_PHRASE_ECHO.test(text)
}

type JarvisSpeechEventsOptions = {
  registry: JarvisSessionRegistry
  tracker: StoppedSessionTracker
  onTurnFinal: (text: string) => void
  /** Final landed on the ambient session while a manual grab was open. */
  onAmbientGrabbedFinal: (text: string) => void
  onWakeEcho: () => void
  onSessionError: () => void
}

/**
 * Registers the shared speech-IPC transcript listeners once and routes every
 * final by which session currently owns the mic. Main taps these same finals
 * for its wake matcher, so ambient routing here is HUD-side echo only.
 */
export function useJarvisSpeechEvents(options: JarvisSpeechEventsOptions): void {
  const { registry, tracker, onTurnFinal, onAmbientGrabbedFinal, onWakeEcho, onSessionError } =
    options

  useEffect(() => {
    // Partials stay HUD noise for now; finals drive everything.
    const removePartial = window.api.speech.onPartialTranscript(() => undefined)

    const cleanupFinal = window.api.speech.onFinalTranscript((data: SpeechTranscriptEvent) => {
      const text = typeof data.text === 'string' ? data.text : ''
      const kind = registry.kind.current

      if (kind === 'turn' && data.sessionId === registry.sessionId.current) {
        onTurnFinal(text)
        return
      }

      if (kind !== 'ambient' || data.sessionId !== AMBIENT_SESSION_ID) {
        return
      }

      if (registry.grabActive.current) {
        // Let main's wake matcher own wake-phrase finals even mid-grab so a
        // spoken "Hey Adam …" during a grab cannot double-fire ADAM.
        registry.grabActive.current = false
        onAmbientGrabbedFinal(text.trim() && !matchesWakePhrase(text) ? text.trim() : '')
        return
      }

      if (text.trim() && matchesWakePhrase(text)) {
        onWakeEcho()
      }
    })

    const cleanupStopped = window.api.speech.onStopped((data) => {
      tracker.record(data.sessionId)
    })

    const cleanupError = window.api.speech.onError((data: SpeechErrorEvent) => {
      if (data.sessionId === registry.sessionId.current) {
        onSessionError()
      }
    })

    return () => {
      removePartial()
      cleanupFinal()
      cleanupStopped()
      cleanupError()
    }
  }, [
    onAmbientGrabbedFinal,
    onSessionError,
    onTurnFinal,
    onWakeEcho,
    registry,
    tracker
  ])
}
