import type { useAudioCapture } from '@/hooks/use-audio-capture'

/** Fixed session id of the continuous wake-word dictation session. */
export const AMBIENT_SESSION_ID = 'wake'

/** Capture surface the Jarvis session starters need from useAudioCapture. */
export type JarvisCaptureControls = Pick<
  ReturnType<typeof useAudioCapture>,
  'start' | 'stop' | 'flushBufferedAudio' | 'discardBufferedAudio'
>

/** Shared identity of the single live Jarvis dictation session. */
export type JarvisSessionRegistry = {
  kind: { current: 'turn' | 'ambient' | null }
  sessionId: { current: string | null }
  /** Manual grab over the ambient session (next final is the utterance). */
  grabActive: { current: boolean }
  runId: { current: number }
}

export function createJarvisSessionRegistry(): JarvisSessionRegistry {
  return {
    kind: { current: null },
    sessionId: { current: null },
    grabActive: { current: false },
    runId: { current: 0 }
  }
}
