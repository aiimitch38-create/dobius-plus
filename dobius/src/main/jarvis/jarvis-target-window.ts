/** Minimal shape needed to choose a target; keeps this module Electron-free. */
export type TargetableWindow = { isDestroyed(): boolean }

/**
 * Exactly one window handles a Jarvis event, and it must host the Jarvis
 * controller (the app shell's DictationIndicator).
 *
 * Why not the focused window alone: ⌘T is a GLOBAL shortcut, so it fires while
 * another app has focus and getFocusedWindow() returns null — targeting only
 * the focused window made the shortcut a no-op precisely when it mattered.
 * Why only hosts (#89): the self-edit review, torn-off terminals and the
 * floating phone mount no controller, so a focused auxiliary window swallowed
 * the event.
 * Why not every host: a broadcast would start one turn per window, all
 * fighting over the single STT worker.
 */
export function pickJarvisTargetWindow<T extends TargetableWindow>(
  focused: T | null,
  hosts: T[]
): T | null {
  const live = hosts.filter((win) => !win.isDestroyed())
  if (focused && live.includes(focused)) {
    return focused
  }
  return live[0] ?? null
}
