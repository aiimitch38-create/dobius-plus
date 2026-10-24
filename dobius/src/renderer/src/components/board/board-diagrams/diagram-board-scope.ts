// Pure helpers for diagrams on the board: where a new diagram goes (the shared
// free-spot rule, never on top of cards) and which shapes an export covers.
import type { BoardCard, BoardConnector, BoardViewport } from '@/store/slices/board'
import { BOARD_CHROME_INSETS, revealRectViewport } from '../board-canvas/board-reveal'
import { boardFreeSpawnCenter } from '../board-canvas/board-spawn-placement'
import { screenToWorld, type BoardPoint } from '../board-canvas/board-viewport'
import type { ExcalidrawRect } from './diagram-excalidraw'

type Size = { w: number; h: number }

/**
 * Top-left for a diagram of `size`: the first clear spot in the visible area
 * (minus board chrome), the same rule new cards and spawns use, plus the pan
 * that keeps it on screen when the view is full.
 */
export function diagramPlacement(
  board: { cards: readonly BoardCard[]; viewport: BoardViewport },
  size: Size,
  screen: Size
): { origin: BoardPoint; viewport: BoardViewport } {
  const v = board.viewport
  const inset = BOARD_CHROME_INSETS
  const topLeft = screenToWorld({ x: inset.left, y: inset.top }, v)
  const bottomRight = screenToWorld({ x: screen.w - inset.right, y: screen.h - inset.bottom }, v)
  const center = boardFreeSpawnCenter(
    { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y },
    size,
    board.cards
  )
  const origin = { x: center.x - size.w / 2, y: center.y - size.h / 2 }
  return { origin, viewport: revealRectViewport(v, { ...origin, ...size }, screen) }
}

export type DiagramScope = {
  shapes: ExcalidrawRect[]
  arrows: { from: string; to: string; label?: string }[]
}

/**
 * The shapes and arrows an export covers: the given diagram's cards when any of
 * them are still on the board, otherwise every shape on the board, so a starter
 * or an older agent drawing exports too.
 */
export function diagramScope(
  cards: readonly BoardCard[],
  connectors: readonly BoardConnector[],
  diagramCardIds: ReadonlySet<string> | null
): DiagramScope {
  const shapeCards = cards.filter((c) => c.kind === 'shape')
  const fromDiagram = diagramCardIds
    ? shapeCards.filter((c) => diagramCardIds.has(c.id))
    : ([] as BoardCard[])
  const chosen = fromDiagram.length > 0 ? fromDiagram : shapeCards
  const ids = new Set(chosen.map((c) => c.id))
  const shapes = chosen.flatMap((c): ExcalidrawRect[] =>
    c.kind === 'shape'
      ? [
          {
            id: c.id,
            x: c.x,
            y: c.y,
            w: c.w,
            h: c.h,
            shape: c.shape === 'ellipse' || c.shape === 'diamond' ? c.shape : 'rect',
            label: c.label
          }
        ]
      : []
  )
  const arrows = connectors
    .filter((k) => ids.has(k.fromCardId) && ids.has(k.toCardId))
    .map((k) => ({ from: k.fromCardId, to: k.toCardId, label: k.label }))
  return { shapes, arrows }
}
