import React from 'react'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import type { BoardPoint } from '../board-canvas/board-viewport'
import { BoardCardsLayer } from './BoardCardsLayer'
import { useBoardSnapGuides } from './board-snap-guides'

type BoardLiveCardsLayerProps = {
  worktreeId: string
  selectedIds: ReadonlySet<string>
  onSelect: (cardId: string, additive: boolean) => void
  onDragBy: (cardId: string, dx: number, dy: number) => void
  onDragEnd: () => void
  penPoints: readonly BoardPoint[]
  shapeDraft?: { x: number; y: number; w: number; h: number } | null
}

/**
 * The cards layer with its own store subscriptions: the live board (card
 * positions change on every drag frame) and the snap guides. The Board route
 * above reads a geometry-insensitive board (board-shape.ts), so a drag
 * re-renders this subtree only.
 */
export function BoardLiveCardsLayer({
  worktreeId,
  ...rest
}: BoardLiveCardsLayerProps): React.JSX.Element {
  const board = useAppStore((s) => getBoard(s, worktreeId))
  const guides = useBoardSnapGuides((s) => s.guides)
  return <BoardCardsLayer worktreeId={worktreeId} board={board} guides={guides} {...rest} />
}
