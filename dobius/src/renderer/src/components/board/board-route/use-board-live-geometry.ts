import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { boardFreeSpawnCenter } from '../board-canvas/board-spawn-placement'
import { boardSafeWorldArea } from '../board-canvas/board-reveal'
import {
  screenToWorld,
  type BoardPoint,
  type BoardRect,
  type BoardViewport
} from '../board-canvas/board-viewport'

// The expanded thread (560x~602, 28px above the bottom, centered) is treated as
// occupied even when collapsed, so a card never lands where the thread opens.
function threadWorldRect(v: BoardViewport): { x: number; y: number; w: number; h: number } {
  const tl = screenToWorld({ x: window.innerWidth / 2 - 280, y: window.innerHeight - 630 }, v)
  const br = screenToWorld({ x: window.innerWidth / 2 + 280, y: window.innerHeight - 28 }, v)
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
}

/**
 * Card geometry readers for the Board route. The route's own `board` ignores
 * card positions (board-shape.ts) so a drag never re-renders the chrome; these
 * read the live store at call time instead, and stay stable per worktree so the
 * chrome's callbacks built on them stay stable too.
 */
export function useBoardLiveGeometry(worktreeId: string | null): {
  /** Free spot for a block, clear of every card (live positions) and the Thread. */
  freeCenter: (block: { w: number; h: number }) => BoardPoint
  /** World-space rects of every card, for Fit view. */
  getContentRects: () => readonly BoardRect[]
} {
  // Chrome insets (rails, top bar, collapsed command bar) bound the visible area
  // new consoles may use, so they never land hidden under the composer.
  const freeCenter = useCallback(
    (block: { w: number; h: number }): BoardPoint => {
      const live = getBoard(useAppStore.getState(), worktreeId)
      const v = live.viewport
      return boardFreeSpawnCenter(
        boardSafeWorldArea(v, { w: window.innerWidth, h: window.innerHeight }),
        block,
        [...live.cards, threadWorldRect(v)]
      )
    },
    [worktreeId]
  )
  const getContentRects = useCallback(
    () =>
      getBoard(useAppStore.getState(), worktreeId).cards.map((c) => ({
        x: c.x,
        y: c.y,
        width: c.w,
        height: c.h
      })),
    [worktreeId]
  )
  return { freeCenter, getContentRects }
}
