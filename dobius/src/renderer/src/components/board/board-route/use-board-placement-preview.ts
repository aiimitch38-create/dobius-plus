import { useCallback, useEffect } from 'react'
import type { NewBoardCard } from '@/store/slices/board'
import type { TuiAgent } from '../../../../../shared/types'
import {
  boardGhostOf,
  setBoardGhostPreview,
  type BoardGhostSpec
} from '../board-canvas/board-ghost-store'
import { boardSafeWorldArea } from '../board-canvas/board-reveal'
import { BOARD_CONSOLE_SIZE, boardSpawnRects } from '../board-canvas/board-spawn-placement'
import type { BoardPoint, BoardViewport } from '../board-canvas/board-viewport'
import type { BoardInsertKind, BoardTool } from '../board-chrome/board-tools'
import {
  boardInsertCard,
  boardInsertCardAt,
  boardInsertCardSize,
  type BoardInsertCardKind
} from './board-insert-cards'

/** Rail items that drop a card at a free spot when clicked. */
const INSERT_CARD_KINDS: ReadonlySet<BoardInsertKind> = new Set([
  'todo',
  'kanban',
  'calendar',
  'orchestrator',
  'goal'
])
/** Tools that place a default card where the canvas is clicked. */
const CLICK_PLACE_TOOLS: ReadonlySet<BoardTool> = new Set(['text', 'web', 'shape'])

const screenSize = (): { w: number; h: number } => ({
  w: window.innerWidth,
  h: window.innerHeight
})

/** World point in the middle of the visible area not covered by board chrome. */
export function safeAreaCenter(
  viewport: BoardViewport,
  screen: { w: number; h: number } = screenSize()
): BoardPoint {
  const area = boardSafeWorldArea(viewport, screen)
  return { x: area.x + area.w / 2, y: area.y + area.h / 2 }
}

export function consoleGhosts(
  center: BoardPoint,
  count: number,
  agent: TuiAgent | undefined
): BoardGhostSpec[] {
  return boardSpawnRects(center, count).map((rect) => ({ ...rect, kind: 'console', agent }))
}

type Input = {
  viewport: BoardViewport
  tool: BoardTool
  freeCenter: (size: { w: number; h: number }) => BoardPoint
  /** Agent a console ghost shows before one is picked (the first enabled agent). */
  defaultAgent: TuiAgent | undefined
  /** Open agent picker: its consoles are ghosted at their spot until it closes. */
  picker: { world: BoardPoint; count: number } | null
}

/**
 * Placement ghosts before anything lands on the board: hovering a rail item
 * ghosts the card at the spot a click would use; with a placing tool active the
 * ghost follows the pointer; an open agent picker ghosts its consoles. Click and
 * preview share one placement function per path, so the card lands inside the ghost.
 */
export function useBoardPlacementPreview({
  viewport,
  tool,
  freeCenter,
  defaultAgent,
  picker
}: Input): {
  onToolPreview: (tool: BoardTool | null) => void
  onInsertPreview: (kind: BoardInsertKind | null) => void
  onEmptyPointerMove: ((world: BoardPoint | null) => void) | undefined
  /** The card a canvas click at `world` creates with `kind` (same rect as its ghost). */
  insertCardAt: (kind: BoardInsertCardKind, world: BoardPoint) => NewBoardCard
} {
  const insertCardAt = useCallback(
    (kind: BoardInsertCardKind, world: BoardPoint) =>
      boardInsertCardAt(kind, world, boardSafeWorldArea(viewport, screenSize())),
    [viewport]
  )

  // The same card `onInsert` creates at the free spot, as a ghost.
  const ghostAtFreeSpot = useCallback(
    (kind: BoardInsertCardKind): BoardGhostSpec =>
      boardGhostOf(boardInsertCard(kind, freeCenter(boardInsertCardSize(kind)))),
    [freeCenter]
  )

  const onToolPreview = useCallback(
    (hovered: BoardTool | null) => {
      if (hovered === 'spawn') {
        setBoardGhostPreview(consoleGhosts(freeCenter(BOARD_CONSOLE_SIZE), 1, defaultAgent))
        return
      }
      // Why: these tools place where the canvas is clicked, so the rail ghost
      // previews a click in the middle of the visible area (always on screen),
      // not the free-spot scan, whose fallback can sit past the right edge.
      setBoardGhostPreview(
        hovered && CLICK_PLACE_TOOLS.has(hovered)
          ? [boardGhostOf(insertCardAt(hovered as BoardInsertCardKind, safeAreaCenter(viewport)))]
          : []
      )
    },
    [defaultAgent, freeCenter, insertCardAt, viewport]
  )

  const onInsertPreview = useCallback(
    (hovered: BoardInsertKind | null) => {
      setBoardGhostPreview(
        hovered && INSERT_CARD_KINDS.has(hovered)
          ? [ghostAtFreeSpot(hovered as BoardInsertCardKind)]
          : []
      )
    },
    [ghostAtFreeSpot]
  )

  const tracksPointer = picker === null && (tool === 'spawn' || CLICK_PLACE_TOOLS.has(tool))
  const onEmptyPointerMove = useCallback(
    (world: BoardPoint | null) => {
      if (!world) {
        setBoardGhostPreview([])
        return
      }
      setBoardGhostPreview(
        tool === 'spawn'
          ? consoleGhosts(world, 1, defaultAgent)
          : [boardGhostOf(insertCardAt(tool as BoardInsertCardKind, world))]
      )
    },
    [defaultAgent, insertCardAt, tool]
  )

  // The picker freezes the ghosts where its consoles will land; closing it or
  // switching tools clears whatever preview was up.
  useEffect(() => {
    if (picker) {
      setBoardGhostPreview(consoleGhosts(picker.world, picker.count, defaultAgent))
    }
    return () => setBoardGhostPreview([])
  }, [defaultAgent, picker, tool])

  return {
    onToolPreview,
    onInsertPreview,
    onEmptyPointerMove: tracksPointer ? onEmptyPointerMove : undefined,
    insertCardAt
  }
}
