import type { BoardCardKind } from '@/store/slices/board'

// Why: the eraser rubs out ink (pen strokes and drawn shapes). Panels like a
// kanban, a to-do list or a console are deleted from their menu, never by a
// stray eraser click.
const ERASABLE: ReadonlySet<BoardCardKind> = new Set(['stroke', 'shape'])

export function isErasableCard(kind: BoardCardKind): boolean {
  return ERASABLE.has(kind)
}
