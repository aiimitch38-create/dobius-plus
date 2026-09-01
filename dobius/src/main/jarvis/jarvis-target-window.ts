/** Minimal shape needed to choose a target; keeps this module Electron-free. */
export type TargetableWindow = { isDestroyed(): boolean }

/**
 * Exactly one window handles a Jarvis event.
 *
 * Why not the focused window alone: ⌥Space is a GLOBAL shortcut, so it fires while
 * another app has focus and getFocusedWindow() returns null — targeting only
 * the focused window made the shortcut a no-op precisely when it mattered.
 * Why not every window: each app window mounts the orb, and a broadcast would
 * start one turn per window, all fighting over the single STT worker.
 */
export function pickJarvisTargetWindow<T extends TargetableWindow>(
  focused: T | null,
  all: T[]
): T | null {
  if (focused && !focused.isDestroyed()) {
    return focused
  }
  return all.find((win) => !win.isDestroyed()) ?? null
}
