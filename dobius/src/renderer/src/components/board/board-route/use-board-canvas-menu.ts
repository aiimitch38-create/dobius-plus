import { useState } from 'react'
import { useAppStore } from '@/store'
import type { BoardState } from '@/store/slices/board'
import { fitBoardViewport, type BoardPoint } from '../board-canvas/board-viewport'
import type { BoardCanvasMenuAction } from '../board-chrome/BoardCanvasMenu'
import { BOARD_ZOOM_EVENT } from '../board-zoom-event'
import { duplicateBoardCards } from './board-duplicate'
import { boardInsertCard } from './board-insert-cards'
import type { BoardSelection } from './use-board-selection'

type MenuPoint = { screen: BoardPoint; world: BoardPoint }

/** Right-click canvas menu and Shift+drag marquee selection. */
export function useBoardCanvasMenu(args: {
  worktreeId: string | null
  board: BoardState
  selection: BoardSelection
  spawnAt: (at: MenuPoint, count: number) => void
  /** Four grouped consoles at a free spot (clear of cards and the Thread). */
  spawnGroup: (at: MenuPoint) => void
  pickImageAt: (world: BoardPoint) => void
  openMissionMap: () => void
}): {
  at: MenuPoint | null
  open: (screen: BoardPoint, world: BoardPoint) => void
  close: () => void
  onAction: (action: BoardCanvasMenuAction) => void
  onMarquee: (rect: { x: number; y: number; w: number; h: number }) => void
} {
  const { worktreeId, board, selection } = args
  const [at, setAt] = useState<MenuPoint | null>(null)

  const onAction = (action: BoardCanvasMenuAction): void => {
    const point = at
    setAt(null)
    if (!point || !worktreeId) {
      return
    }
    const store = useAppStore.getState()
    switch (action) {
      case 'duplicate': {
        const copies = duplicateBoardCards(worktreeId, selection.selectedIds)
        if (copies.length > 0) {
          selection.selectOnly(copies)
        }
        return
      }
      case 'bringToFront':
        store.bringToFront(worktreeId, [...selection.selectedIds])
        return
      case 'delete':
        return selection.removeSelected()
      case 'spawn':
        return args.spawnAt(point, 1)
      case 'spawnGroup':
        return args.spawnGroup(point)
      case 'missionMap':
        return args.openMissionMap()
      case 'image':
        return args.pickImageAt(point.world)
      case 'web':
      case 'todo':
      case 'kanban':
      case 'calendar':
      case 'shape':
      case 'memory':
      case 'skill':
      case 'branches':
        store.addCard(worktreeId, boardInsertCard(action, point.world))
        return
      case 'selectAll':
        return selection.selectOnly(board.cards.map((c) => c.id))
      case 'fit':
        store.setViewport(
          worktreeId,
          fitBoardViewport(
            board.cards.map((c) => ({ x: c.x, y: c.y, width: c.w, height: c.h })),
            { width: window.innerWidth, height: window.innerHeight }
          )
        )
        return
      case 'zoom100':
        window.dispatchEvent(new CustomEvent(BOARD_ZOOM_EVENT, { detail: 'reset' }))
    }
  }

  const onMarquee = (rect: { x: number; y: number; w: number; h: number }): void => {
    const hits = board.cards.filter(
      (c) =>
        c.x < rect.x + rect.w && c.x + c.w > rect.x && c.y < rect.y + rect.h && c.y + c.h > rect.y
    )
    selection.selectOnly(hits.map((c) => c.id))
  }

  return {
    at,
    // Why: open after the right-click sequence finishes, so the same mouse
    // gesture can't count as an outside click and close the menu at once.
    open: (screen, world) => {
      setTimeout(() => setAt({ screen, world }), 0)
    },
    close: () => setAt(null),
    onAction,
    onMarquee
  }
}
