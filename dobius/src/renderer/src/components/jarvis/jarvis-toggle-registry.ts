type JarvisToggleFn = () => void

let toggleHandler: JarvisToggleFn | null = null

/**
 * Lets the orb's click gesture trigger the same turn toggle as a ⌘T press.
 * Module singleton — the voice controller registers on mount; the indicator
 * calls it. Kept separate from mic-yield so either side can exist alone.
 */
export function registerJarvisToggle(fn: JarvisToggleFn | null): void {
  toggleHandler = fn
}

export function requestJarvisToggle(): boolean {
  if (!toggleHandler) {
    return false
  }
  try {
    toggleHandler()
    return true
  } catch {
    return false
  }
}
