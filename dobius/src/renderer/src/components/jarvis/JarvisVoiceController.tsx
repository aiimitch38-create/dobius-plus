import { useEffect } from 'react'
import { useJarvisTurn } from './use-jarvis-turn'
import { registerJarvisMicYield } from './jarvis-mic-yield'

/**
 * Headless owner of the Jarvis voice loop in the main window: ⌘T turns, the
 * wake-word ambient session, and mic handoff to ordinary ⌘E dictation. There
 * is deliberately no second orb — the existing dictation orb renders all
 * Jarvis phases (see DictationIndicator).
 */
export function JarvisVoiceController(): null {
  const { micRequest } = useJarvisTurn()

  useEffect(() => {
    registerJarvisMicYield(micRequest)
    return () => registerJarvisMicYield(null)
  }, [micRequest])

  return null
}
