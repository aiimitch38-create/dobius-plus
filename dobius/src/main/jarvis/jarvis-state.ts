import type { JarvisConversationPhase } from '../../shared/speech-types'

/**
 * Electron's globalShortcut fires once per full press with no keyup event, so
 * the renderer cannot derive hold semantics from it. The main process therefore
 * synthesizes a released signal a fixed moment after every activation; the
 * renderer's gesture layer (which has real keyboard listeners when focused)
 * decides actual hold behavior.
 */
export const JARVIS_PTT_AUTO_RELEASE_MS = 50

export type JarvisSignal =
  | { type: 'mode-on' }
  | { type: 'mode-off' }
  | { type: 'listening-started' }
  | { type: 'ask-started' }
  | { type: 'speak-started' }
  | { type: 'turn-finished' }
  | { type: 'error'; reason?: string }

const NEXT_PHASE: Record<JarvisSignal['type'], JarvisConversationPhase> = {
  'mode-on': 'idle',
  'mode-off': 'idle',
  'listening-started': 'listening',
  'ask-started': 'thinking',
  'speak-started': 'speaking',
  'turn-finished': 'idle',
  error: 'error'
}

export function applyJarvisSignal(
  _current: JarvisConversationPhase,
  signal: JarvisSignal
): JarvisConversationPhase {
  return NEXT_PHASE[signal.type]
}
