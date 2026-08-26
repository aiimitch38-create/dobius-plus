import { useEffect } from 'react'
import { useJarvisTurn } from './use-jarvis-turn'
import { registerJarvisMicYield } from './jarvis-mic-yield'
import { registerJarvisToggle } from './jarvis-toggle-registry'

/**
 * Headless owner of the Jarvis voice loop in the main window: ⌘T turns, the
 * wake-word ambient session, and mic handoff to ordinary ⌘E dictation. There
 * is deliberately no second orb — the existing dictation orb renders all
 * Jarvis phases (see DictationIndicator).
 */
export function JarvisVoiceController(): null {
  const { micRequest, toggleTurn } = useJarvisTurn()

  useEffect(() => {
    registerJarvisMicYield(micRequest)
    return () => registerJarvisMicYield(null)
  }, [micRequest])

  useEffect(() => {
    registerJarvisToggle(toggleTurn)
    return () => registerJarvisToggle(null)
  }, [toggleTurn])

  return null
}
