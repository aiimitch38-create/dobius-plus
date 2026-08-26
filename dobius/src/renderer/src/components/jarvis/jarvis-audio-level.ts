type AudioLevelFn = () => number

let levelGetter: AudioLevelFn | null = null

/**
 * Bridges the Jarvis turn/ambient capture's live mic level to the orb.
 * Module singleton like the mic-yield handshake: the voice controller
 * registers its capture's getter on mount; the indicator reads it as a
 * fallback when ordinary dictation isn't the thing capturing.
 */
export function registerJarvisAudioLevel(fn: AudioLevelFn | null): void {
  levelGetter = fn
}

export function getJarvisAudioLevel(): number {
  if (!levelGetter) {
    return 0
  }
  try {
    return levelGetter() || 0
  } catch {
    return 0
  }
}
