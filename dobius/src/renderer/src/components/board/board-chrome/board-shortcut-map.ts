import { translate } from '@/i18n/i18n'
import { BOARD_TOOL_SHORTCUTS, isBoardShortcutBlockedTarget } from './board-tools'

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
  | 'focusSelected'
  | 'nextNeedsYou'
  | 'showShortcuts'

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
  g: 'openGitHub',
  f: 'focusSelected',
  enter: 'focusSelected',
  n: 'nextNeedsYou'
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

  // Why: "?" is Shift+/ on most layouts, so it is matched before the Shift bail-out.
  if (event.key === '?') {
    return 'showShortcuts'
  }

  if (event.shiftKey) {
    return null
  }

  return BARE_ACTIONS[key] ?? null
}

export type BoardShortcutSheetRow = { keys: string[]; label: string }
export type BoardShortcutSheetSection = { title: string; rows: BoardShortcutSheetRow[] }

/** Everything the "?" sheet lists; keep in step with the maps above and the canvas/camera keys. */
export function boardShortcutSheet(isMac: boolean): BoardShortcutSheetSection[] {
  const mod = isMac ? '⌘' : 'Ctrl'
  const tool = (t: keyof typeof BOARD_TOOL_SHORTCUTS): string[] => [BOARD_TOOL_SHORTCUTS[t] ?? '']
  return [
    {
      title: translate('board.shortcuts.tools', 'Tools'),
      rows: [
        { keys: tool('select'), label: translate('board.tools.select', 'Select') },
        { keys: tool('spawn'), label: translate('board.tools.spawn', 'Spawn agent') },
        { keys: tool('text'), label: translate('board.tools.text', 'Text') },
        { keys: tool('pen'), label: translate('board.tools.pen', 'Pen') },
        { keys: tool('eraser'), label: translate('board.tools.eraser', 'Eraser') },
        { keys: ['Space'], label: translate('board.shortcuts.spacePan', 'Hold to pan (or talk)') }
      ]
    },
    {
      title: translate('board.shortcuts.focusSection', 'Focus'),
      rows: [
        {
          keys: ['F'],
          label: translate(
            'board.shortcuts.focusAny',
            'Zoom to the selected card or group (or Enter)'
          )
        },
        {
          keys: [translate('board.shortcuts.click', 'Click title')],
          label: translate(
            'board.shortcuts.focusClickAny',
            'Zoom to any card or group tab (double-click works on consoles, images and lists)'
          )
        },
        {
          keys: ['Esc'],
          label: translate(
            'board.shortcuts.overviewAny',
            'Back to overview (Shift+Esc while typing)'
          )
        },
        {
          keys: ['⌥←', '⌥→'],
          label: translate(
            'board.shortcuts.stepAny',
            'Previous / next card (add Shift while typing in a console)'
          )
        },
        { keys: ['N'], label: translate('board.shortcuts.needsYou', 'Next console that needs you') }
      ]
    },
    {
      title: translate('board.shortcuts.view', 'View'),
      rows: [
        { keys: [mod, '+'], label: translate('board.shortcuts.zoomIn', 'Zoom in') },
        { keys: [mod, '-'], label: translate('board.shortcuts.zoomOut', 'Zoom out') },
        { keys: [mod, '0'], label: translate('board.shortcuts.zoomReset', 'Zoom to 100%') },
        {
          keys: [mod, 'K'],
          label: translate('board.shortcuts.commandBar', 'Focus the command bar')
        },
        { keys: ['?'], label: translate('board.shortcuts.sheet', 'Show this sheet') }
      ]
    },
    {
      title: translate('board.shortcuts.cards', 'Cards'),
      rows: [
        { keys: [mod, 'A'], label: translate('board.shortcuts.selectAll', 'Select all') },
        { keys: [mod, 'D'], label: translate('board.shortcuts.duplicate', 'Duplicate') },
        { keys: [mod, 'G'], label: translate('board.shortcuts.group', 'Group') },
        { keys: [mod, 'Z'], label: translate('board.shortcuts.undo', 'Undo') },
        { keys: [mod, '⇧', 'Z'], label: translate('board.shortcuts.redo', 'Redo') },
        { keys: ['Delete'], label: translate('board.shortcuts.delete', 'Delete the selection') }
      ]
    },
    {
      title: translate('board.shortcuts.open', 'Open'),
      rows: [
        { keys: ['X'], label: translate('board.shortcuts.missionMap', 'Mission Map') },
        { keys: ['L'], label: translate('board.shortcuts.loops', 'Loops') },
        { keys: ['D'], label: translate('board.shortcuts.docs', 'Docs') },
        { keys: ['S'], label: translate('board.shortcuts.skills', 'Skills') },
        { keys: ['M'], label: translate('board.shortcuts.memory', 'Memory') },
        { keys: ['G'], label: translate('board.shortcuts.github', 'GitHub') }
      ]
    }
  ]
}
