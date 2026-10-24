import { translate } from '@/i18n/i18n'
import type { BoardKanbanColumn } from '@/store/slices/board'

// Moves one item to (toColumnId, toIndex). Index is measured after removal.
export function moveKanbanItem(
  columns: readonly BoardKanbanColumn[],
  itemId: string,
  toColumnId: string,
  toIndex: number
): BoardKanbanColumn[] {
  const item = columns.flatMap((c) => c.items).find((i) => i.id === itemId)
  if (!item || !columns.some((c) => c.id === toColumnId)) {
    return [...columns]
  }
  return columns.map((c) => {
    const items = c.items.filter((i) => i.id !== itemId)
    if (c.id !== toColumnId) {
      return items.length === c.items.length ? c : { ...c, items }
    }
    const at = Math.max(0, Math.min(toIndex, items.length))
    return { ...c, items: [...items.slice(0, at), item, ...items.slice(at)] }
  })
}

export const KANBAN_COLUMN_ATTR = 'data-kanban-column'

/**
 * The column a drop landed in, only if it belongs to this kanban (`root`).
 * Why: the preload's capture-phase `drop` listener stops propagation for every
 * drag that is not an OS file or an internal file drag, so React's onDrop never
 * runs; the card listens on document (capture) and resolves the column itself.
 */
export function kanbanColumnAt(
  target: EventTarget | null,
  root: Pick<Node, 'contains'> | null
): string | null {
  if (!root || !target || typeof (target as Element).closest !== 'function') {
    return null
  }
  const column = (target as Element).closest(`[${KANBAN_COLUMN_ATTR}]`)
  if (!column || !root.contains(column)) {
    return null
  }
  return column.getAttribute(KANBAN_COLUMN_ATTR)
}

/** Columns an item can move to from its menu: every column but its own. */
export function kanbanMoveTargets(
  columns: readonly BoardKanbanColumn[],
  itemId: string
): BoardKanbanColumn[] {
  return columns.filter((c) => !c.items.some((i) => i.id === itemId))
}

export function defaultKanbanColumns(): BoardKanbanColumn[] {
  return [
    translate('board.kanban.todo', 'To do'),
    translate('board.kanban.doing', 'Doing'),
    translate('board.kanban.done', 'Done')
  ].map((title) => ({ id: crypto.randomUUID(), title, items: [] }))
}
