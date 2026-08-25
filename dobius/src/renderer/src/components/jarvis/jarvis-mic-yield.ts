type MicYieldFn = () => void

let yieldHandler: MicYieldFn | null = null

/**
 * Handshake between the Jarvis voice controller and ordinary dictation: both
 * need the single STT session, so ⌘E asks Jarvis to step aside first. Module
 * singleton — both sides render in the same main-window renderer.
 */
export function registerJarvisMicYield(fn: MicYieldFn | null): void {
  yieldHandler = fn
}

export function yieldJarvisMic(): void {
  try {
    yieldHandler?.()
  } catch {
    // Never let a yield failure block the user's dictation.
  }
}
