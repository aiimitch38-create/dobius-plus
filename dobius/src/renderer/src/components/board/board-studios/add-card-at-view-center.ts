import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { screenToWorld } from '../board-canvas/board-viewport'
import { boardInsertCard, type BoardInsertCardKind } from '../board-route/board-insert-cards'

// Studios have no canvas ref; the Board is a full-window layer, so the window
// center is the visible canvas center.
export function addCardAtViewCenter(worktreeId: string, kind: BoardInsertCardKind): string {
  const { viewport } = getBoard(useAppStore.getState(), worktreeId)
  const center = screenToWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, viewport)
  return useAppStore.getState().addCard(worktreeId, boardInsertCard(kind, center))
}
