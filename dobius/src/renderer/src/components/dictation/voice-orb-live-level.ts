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
let adamVoiceHangUp: (() => void) | null = null

/** The voice coordinator registers how to end its call; returns the unregister. */
export function setAdamVoiceHangUp(hangUp: () => void): () => void {
  adamVoiceHangUp = hangUp
  return () => {
    if (adamVoiceHangUp === hangUp) {
      adamVoiceHangUp = null
    }
  }
}

/**
 * A click on an awake Adam's orb ends the voice call. Why not pressPtt: in
 * push-to-talk mode a press mutes the call instead of hanging up.
 */
export function endAdamVoiceFromOrb(): void {
  // Why unconditional: a muted or standby call shows as idle but still bills.
  adamVoiceHangUp?.()
}

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
