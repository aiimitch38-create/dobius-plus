import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioCapture } from '@/hooks/use-audio-capture'
import { useAppStore } from '@/store'
import {
  AMBIENT_SESSION_ID,
  createJarvisSessionRegistry,
  type JarvisCaptureControls
} from './jarvis-capture-controls'
import { createStoppedSessionTracker } from './jarvis-stopped-sessions-tracker'
import { useJarvisVoiceSettings } from './use-jarvis-voice-settings'
import { useJarvisSpeechEvents } from './use-jarvis-speech-events'
import { startJarvisTurnSession } from './start-jarvis-turn-session'
import { startJarvisAmbientSession, type JarvisAmbientSessionHandle } from './start-jarvis-ambient-session'

export type OrbHudState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

// Why duplicated: mirrors WAKE_WORD_WINDOW_MS in main's wake-word-matcher so
// the renderer-side armed hint expires on the same schedule without extra IPC.
const WAKE_WORD_WINDOW_MS = 12_000
const ERROR_STATE_CLEAR_MS = 4_000
// Cadence for re-attempting the ambient wake session after a failed start
// (mic busy with dictation). Matches the old post-dictation grace period.
const AMBIENT_RETRY_MS = 8_000

type TurnSubPhase = 'idle' | 'starting' | 'listening'

export type JarvisTurn = {
  hudState: OrbHudState
  /** True after a bare "Hey Adam" final, until the matcher window lapses. */
  wakeArmed: boolean
  /** True while the continuous wake-word dictation session is capturing. */
  ambientActive: boolean
  /** Click handler for the orb: same toggle as a ⌘T press. */
  toggleTurn: () => void
  /** Called when plain dictation needs the mic; Jarvis steps aside. */
  micRequest: () => void
}

/**
 * Self-contained turn orchestration for the Jarvis orb: mic capture + STT via
 * the shared speech IPC (exactly as DictationController drives it), then the
 * ADAM round-trip through window.api.jarvis. At most ONE dictation session is
 * alive at a time; when the experimental wake word is on, that session is a
 * continuous ambient one and a manual click/⌘T "grab" marks the next final as
 * the utterance instead of starting a competing session.
 */
export function useJarvisTurn(): JarvisTurn {
  const [hudState, setHudState] = useState<OrbHudState>('idle')
  const [wakeArmed, setWakeArmed] = useState(false)
  const [ambientActive, setAmbientActive] = useState(false)

  const capture: JarvisCaptureControls = useAudioCapture()
  const { flags, flagsRef } = useJarvisVoiceSettings()
  const registryRef = useRef(createJarvisSessionRegistry())
  const trackerRef = useRef(createStoppedSessionTracker())
  const turnPhaseRef = useRef<TurnSubPhase>('idle')
  // Why mirrored: toggleTurn needs the current HUD phase synchronously (a ⌘T
  // press during thinking/speaking must not open a mic that would hear ADAM's
  // own reply), and state updates are not readable in the same tick.
  const hudStateRef = useRef<OrbHudState>('idle')
  // Why: main's error broadcasts carry a human reason ("ADAM unreachable");
  // keep the latest so the store can render it on the orb label.
  const lastErrorReasonRef = useRef<string | undefined>(undefined)
  const turnCancelRef = useRef<(() => void) | null>(null)
  const ambientHandleRef = useRef<JarvisAmbientSessionHandle | null>(null)
  const armedTimerRef = useRef<number | null>(null)
  const errorTimerRef = useRef<number | null>(null)
  const ambientRestartTimerRef = useRef<number | null>(null)
  // Why bumped: after a manual turn ends, the ambient session may need to be
  // restarted (it was deferred while the turn owned the mic).
  const [sessionEpoch, setSessionEpoch] = useState(0)

  const registry = registryRef.current
  const tracker = trackerRef.current

  // Why mirrored to the store: the orb (DictationIndicator) must render the
  // SAME phase this controller computes — including manual ⌘T listening,
  // which main never broadcasts. reason rides along for error labels.
  const setPhase = useCallback((phase: OrbHudState): void => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current)
      errorTimerRef.current = null
    }
    if (phase === 'error') {
      errorTimerRef.current = window.setTimeout(() => {
        errorTimerRef.current = null
        hudStateRef.current = 'idle'
        useAppStore.getState().setJarvisHud('idle')
        setHudState('idle')
      }, ERROR_STATE_CLEAR_MS)
    }
    hudStateRef.current = phase
    useAppStore.getState().setJarvisHud(phase, phase === 'error' ? lastErrorReasonRef.current : undefined)
    setHudState(phase)
  }, [])

  const markWakeArmed = useCallback((): void => {
    setWakeArmed(true)
    if (armedTimerRef.current !== null) {
      window.clearTimeout(armedTimerRef.current)
    }
    armedTimerRef.current = window.setTimeout(() => {
      armedTimerRef.current = null
      setWakeArmed(false)
    }, WAKE_WORD_WINDOW_MS)
  }, [])

  /** Cleanly stops whichever dictation session currently owns the mic. */
  const stopSessionCleanly = useCallback(async (): Promise<void> => {
    const sessionId = registry.sessionId.current
    const wasAmbient = registry.kind.current === 'ambient'
    turnPhaseRef.current = 'idle'
    turnCancelRef.current = null
    registry.kind.current = null
    registry.sessionId.current = null
    registry.grabActive.current = false
    if (!sessionId) {
      return
    }
    capture.stop()
    try {
      await window.api.speech.stopDictation(sessionId)
    } catch {
      // Swallow stop errors — the worker may already be torn down.
    }
    await tracker.wait(sessionId)
    if (wasAmbient) {
      setAmbientActive(false)
    } else {
      capture.discardBufferedAudio()
    }
  }, [capture, registry, tracker])

  const runAskFlow = useCallback(
    async (utterance: string): Promise<void> => {
      setPhase('thinking')
      try {
        const result = await window.api.jarvis.ask(utterance)
        // Why only errors: main's ask() already speaks answer/job replies
        // internally (jarvis-service.ts), so speaking those again here would
        // duplicate the audio. Error results are never spoken by main.
        if (result.kind === 'error') {
          setPhase('speaking')
          await window.api.jarvis.speak(result.text)
        }
      } catch {
        setPhase('error')
        return
      }
      setPhase('idle')
    },
    [setPhase]
  )

  /** Ends a manual turn on its first final: stop mic cleanly, then ask. */
  const finishTurnWithFinal = useCallback(
    (text: string): void => {
      void (async () => {
        await stopSessionCleanly()
        setSessionEpoch((epoch) => epoch + 1)
        if (!text.trim()) {
          // Empty finals end the turn gracefully — no ask, no spoken error.
          setPhase('idle')
          return
        }
        await runAskFlow(text.trim())
      })()
    },
    [runAskFlow, setPhase, stopSessionCleanly]
  )

  const onTurnFinal = finishTurnWithFinal

  const onAmbientGrabbedFinal = useCallback(
    (text: string): void => {
      if (!text) {
        setPhase('idle')
        return
      }
      void runAskFlow(text)
    },
    [runAskFlow, setPhase]
  )

  const onSessionError = useCallback((): void => {
    void (async () => {
      await stopSessionCleanly()
      setSessionEpoch((epoch) => epoch + 1)
      setPhase('error')
    })()
  }, [setPhase, stopSessionCleanly])

  useJarvisSpeechEvents({
    registry,
    tracker,
    onTurnFinal,
    onAmbientGrabbedFinal,
    onWakeEcho: markWakeArmed,
    onSessionError
  })

  const startTurn = useCallback((): void => {
    const modelId = flagsRef.current.sttModel
    if (!modelId) {
      setPhase('error')
      return
    }
    turnPhaseRef.current = 'starting'
    startJarvisTurnSession({
      modelId,
      registry,
      capture,
      waitForStopped: tracker.wait,
      register: (handle) => {
        turnCancelRef.current = handle.cancel
      },
      onListening: () => {
        turnPhaseRef.current = 'listening'
        setPhase('listening')
      },
      onError: () => {
        turnPhaseRef.current = 'idle'
        setPhase('error')
      },
      onSettled: () => {
        turnPhaseRef.current = 'idle'
        turnCancelRef.current = null
        setSessionEpoch((epoch) => epoch + 1)
        setPhase('idle')
      }
    })
  }, [capture, flagsRef, registry, setPhase, tracker])

  /**
   * Called when ordinary dictation (⌘E) wants the mic: step aside completely.
   * Ambient restarts on a delay via the session-epoch effect once the mic is
   * free again — if dictation still holds it, start fails benignly and the
   * next epoch retries.
   */
  const micRequest = useCallback((): void => {
    if (registry.kind.current === 'turn') {
      if (turnPhaseRef.current === 'starting') {
        turnCancelRef.current?.()
        return
      }
      void stopSessionCleanly().then(() => {
        setSessionEpoch((epoch) => epoch + 1)
        setPhase('idle')
      })
      return
    }
    if (registry.kind.current === 'ambient' && ambientHandleRef.current) {
      ambientHandleRef.current.dispose()
      ambientHandleRef.current = null
      setAmbientActive(false)
      setPhase('idle')
      if (ambientRestartTimerRef.current !== null) {
        window.clearTimeout(ambientRestartTimerRef.current)
      }
      ambientRestartTimerRef.current = window.setTimeout(() => {
        ambientRestartTimerRef.current = null
        setSessionEpoch((epoch) => epoch + 1)
      }, 8_000)
    }
  }, [registry, setPhase, stopSessionCleanly])

  /**
   * Press/click behavior. Main synthesizes `released` ~50ms after every press
   * (JARVIS_PTT_AUTO_RELEASE_MS), so release cannot carry hold-to-talk
   * semantics: press toggles, and an active press cancels the open turn.
   */
  const toggleTurn = useCallback((): void => {
    // Why: while ADAM is thinking/speaking, ⌘T means "stop talking" — cancel
    // the in-flight reply's audio and drop back to idle. (Before this, the
    // press was ignored and there was no way to silence a long answer.)
    if (hudStateRef.current === 'thinking' || hudStateRef.current === 'speaking') {
      void window.api.jarvis.cancelSpeak().catch(() => undefined)
      setPhase('idle')
      return
    }
    if (registry.kind.current === 'turn') {
      if (turnPhaseRef.current === 'starting') {
        turnCancelRef.current?.()
        return
      }
      void stopSessionCleanly().then(() => {
        setSessionEpoch((epoch) => epoch + 1)
        setPhase('idle')
      })
      return
    }
    if (registry.kind.current === 'ambient') {
      // Ambient capture already feeds the STT worker — mark the next final as
      // ours rather than starting a competing session.
      registry.grabActive.current = !registry.grabActive.current
      setPhase(registry.grabActive.current ? 'listening' : 'idle')
      return
    }
    startTurn()
  }, [registry, setPhase, startTurn, stopSessionCleanly])

  // Main-process state events own their phases verbatim (including idle):
  // wake-word turns are fired entirely by main, so its idle broadcast is the
  // only signal that such a turn finished speaking.
  // Why the guard: main's phase machine is stateless (every signal wins), so
  // a STALE turn-finished/idle from a previous reply can arrive after a fresh
  // manual turn started listening and would snap the orb back to idle
  // mid-listen. While a local turn session is live, only non-idle phases pass.
  useEffect(
    () =>
      window.api.jarvis.onState((event) => {
        if (event.reason) {
          lastErrorReasonRef.current = event.reason
        }
        const localTurnLive =
          registry.kind.current === 'turn' || turnPhaseRef.current !== 'idle'
        if (localTurnLive && event.state === 'idle') {
          return
        }
        setPhase(event.state)
      }),
    [registry, setPhase]
  )

  // Global ⌘T push-to-talk: press starts or cancels a turn.
  useEffect(() => {
    if (!flags.jarvisEnabled) {
      return
    }
    const cleanupPressed = window.api.jarvis.onPttPressed(() => toggleTurn())
    // Released carries no hold information (synthesized ~50ms later by main),
    // so subscribing to it for control would cancel every turn instantly.
    const cleanupReleased = window.api.jarvis.onPttReleased(() => undefined)
    return () => {
      cleanupPressed()
      cleanupReleased()
    }
  }, [flags.jarvisEnabled, toggleTurn])

  const ambientDesired =
    flags.jarvisEnabled && flags.jarvisWakeWord && flags.sttModel !== ''
  useEffect(() => {
    if (!ambientDesired || registry.kind.current !== null || ambientHandleRef.current) {
      return
    }
    ambientHandleRef.current = startJarvisAmbientSession({
      modelId: flagsRef.current.sttModel,
      sessionId: AMBIENT_SESSION_ID,
      registry,
      capture,
      waitForStopped: tracker.wait,
      onActive: () => setAmbientActive(true),
      onFailed: () => setAmbientActive(false)
    })
    return () => {
      ambientHandleRef.current?.dispose()
      ambientHandleRef.current = null
    }
    // Why sessionEpoch: re-check after a manual turn released the mic.
  }, [ambientDesired, capture, flagsRef, registry, sessionEpoch, tracker])

  // Why the retry loop: a failed ambient start (mic held by ⌘E dictation —
  // same window via yield or another window via main's eviction) used to leave
  // the wake word dead until an unrelated epoch bump happened to run. While
  // wake word is desired but not capturing, re-attempt on a slow cadence; each
  // failed attempt is benign (starter cleans up after itself).
  useEffect(() => {
    if (!ambientDesired || ambientActive) {
      return
    }
    const timer = window.setTimeout(() => {
      setSessionEpoch((epoch) => epoch + 1)
    }, AMBIENT_RETRY_MS)
    return () => window.clearTimeout(timer)
  }, [ambientDesired, ambientActive, sessionEpoch])

  // Why: flipping Jarvis off (Settings toggle) must also kill any live mic
  // session. The ambient handle is disposed by the desired-effect cleanup, but
  // a manual turn in 'starting'/'listening' would otherwise keep capturing.
  const jarvisEnabledRef = useRef(flags.jarvisEnabled)
  useEffect(() => {
    const wasEnabled = jarvisEnabledRef.current
    jarvisEnabledRef.current = flags.jarvisEnabled
    if (wasEnabled && !flags.jarvisEnabled && registry.kind.current !== null) {
      void stopSessionCleanly()
    }
  }, [flags.jarvisEnabled, registry, stopSessionCleanly])

  useEffect(
    () => () => {
      if (armedTimerRef.current !== null) {
        window.clearTimeout(armedTimerRef.current)
      }
      if (errorTimerRef.current !== null) {
        window.clearTimeout(errorTimerRef.current)
      }
      if (ambientRestartTimerRef.current !== null) {
        window.clearTimeout(ambientRestartTimerRef.current)
      }
      ambientHandleRef.current?.dispose()
      ambientHandleRef.current = null
      void stopSessionCleanly()
    },
    [stopSessionCleanly]
  )

  return { hudState, wakeArmed, ambientActive, toggleTurn, micRequest }
}
