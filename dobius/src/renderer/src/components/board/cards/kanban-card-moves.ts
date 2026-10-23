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

export function defaultKanbanColumns(): BoardKanbanColumn[] {
  return [
    translate('board.kanban.todo', 'To do'),
    translate('board.kanban.doing', 'Doing'),
    translate('board.kanban.done', 'Done')
  ].map((title) => ({ id: crypto.randomUUID(), title, items: [] }))
}
