import { isBoardShortcutBlockedTarget } from './board-tools'

export type BoardShortcutAction =
  | 'group'
  | 'selectAll'
  | 'duplicate'
  | 'resetZoom'
  | 'undo'
  | 'redo'
  | 'openLoops'
  | 'openDocs'
  | 'openSkills'
  | 'openMemory'
  | 'openMissionMap'
  | 'openGitHub'

/** With platform modifier (metaKey on Mac, ctrlKey elsewhere). */
const MODIFIER_ACTIONS: Readonly<Record<string, BoardShortcutAction>> = {
  g: 'group',
  a: 'selectAll',
  d: 'duplicate',
  '0': 'resetZoom',
  z: 'undo'
}

/** shift+z with the platform modifier. Checked before plain undo. */
const SHIFT_MODIFIER_ACTIONS: Readonly<Record<string, BoardShortcutAction>> = {
  z: 'redo'
}

/** Bare keys, no modifier at all. */
const BARE_ACTIONS: Readonly<Record<string, BoardShortcutAction>> = {
  l: 'openLoops',
  d: 'openDocs',
  s: 'openSkills',
  m: 'openMemory',
  x: 'openMissionMap',
  g: 'openGitHub'
}

export type BoardShortcutEvent = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: EventTarget | null
}

export function resolveBoardShortcut(
  event: BoardShortcutEvent,
  isMac: boolean
): BoardShortcutAction | null {
  // Why: typing in a terminal or text field must not trigger board actions.
  if (isBoardShortcutBlockedTarget(event.target)) {
    return null
  }
  if (event.altKey) {
    return null
  }

  const key = event.key.toLowerCase()
  const platformModifier = isMac ? event.metaKey : event.ctrlKey
  const wrongPlatformModifier = isMac ? event.ctrlKey : event.metaKey

  if (wrongPlatformModifier) {
    return null
  }

  if (platformModifier) {
    if (event.shiftKey) {
      return SHIFT_MODIFIER_ACTIONS[key] ?? null
    }
    return MODIFIER_ACTIONS[key] ?? null
  }

  if (event.shiftKey) {
    return null
  }

  return BARE_ACTIONS[key] ?? null
}
