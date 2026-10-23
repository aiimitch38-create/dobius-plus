import type { BoardTool } from '@/store/slices/board-state'

export type { BoardTool } from '@/store/slices/board-state'

export type BoardInsertKind =
  | 'presets'
  | 'todo'
  | 'kanban'
  | 'calendar'
  | 'orchestrator'
  | 'code'
  | 'docs'
  | 'generate-doc'
  | 'loops'

const TOOL_KEYS: Readonly<Record<string, BoardTool>> = {
  v: 'select',
  t: 'spawn',
  p: 'pen',
  e: 'eraser'
}

export const BOARD_TOOL_SHORTCUTS: Readonly<Partial<Record<BoardTool, string>>> = {
  select: 'V',
  spawn: 'T',
  pen: 'P',
  eraser: 'E'
}

/** Bare single-letter tool keys; any modifier means the key belongs to someone else. */
export function boardToolForKey(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}): BoardTool | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null
  }
  return TOOL_KEYS[event.key.toLowerCase()] ?? null
}

/**
 * Board single-key shortcuts (tool letters, hold-Space, Delete) must never fire
 * while the user types into a console card, terminal, text field, or a studio.
 */
export function isBoardShortcutBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true
  }
  return (
    target.closest(
      // Studios and menus are dialogs/poppers: their own keys (Space on a button) win.
      '[data-board-console], .xterm, input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], [role="menu"]'
    ) !== null
  )
}

/** Only the select tool drags the canvas; drawing tools claim empty-space drags. */
export function boardToolPansOnEmptyDrag(tool: BoardTool): boolean {
  return tool === 'select'
}
