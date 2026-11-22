import type { VoiceOrbPresentation } from './voice-orb-state'

/** Only the app-wide coordinator publishes audio; the dock never owns capture. */
export const voiceOrbLevelSource: { current: () => number } = { current: () => 0 }

let presentation: VoiceOrbPresentation = { state: 'idle', activitySource: 'preview' }
const listeners = new Set<() => void>()

export function getVoiceOrbPresentation(): VoiceOrbPresentation {
  return presentation
}

export function subscribeVoiceOrbPresentation(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishVoiceOrbPresentation(next: VoiceOrbPresentation): void {
  if (presentation.state === next.state && presentation.activitySource === next.activitySource) {
    return
  }
  presentation = next
  // Captions can stay identical across voice owners, so phase updates need their own subscription.
  listeners.forEach((listener) => listener())
}

/**
 * Starts an Adam listen-then-speak turn from an orb click, only when no voice
 * activity is showing. Why: pressPtt is a toggle (a second press cancels
 * thinking, stops capture or ends a live call), and waking the body is not
 * the same as the voice being idle.
 */
export function startAdamVoiceTurnFromOrb(pressPtt: () => Promise<unknown>): boolean {
  if (presentation.state !== 'idle') {
    return false
  }
  try {
    void pressPtt().catch((error: unknown) => console.error('pressPtt failed', error))
  } catch (error) {
    console.error('pressPtt failed', error)
  }
  return true
}
