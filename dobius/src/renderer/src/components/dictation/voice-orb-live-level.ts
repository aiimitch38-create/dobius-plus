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
