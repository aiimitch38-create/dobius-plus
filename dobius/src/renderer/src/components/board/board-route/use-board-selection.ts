import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { boundsOfBoxes, snapBoardBox, type SnapBox } from '../board-canvas/board-snap'
import type { BoardTool } from '@/store/slices/board'
import { isErasableCard } from '../board-tool-panels/eraser-target'
import { removeCardsWithUndo } from './board-history-delete'
import { NO_GUIDES, setBoardSnapGuides } from './board-snap-guides'

export type BoardSelection = {
  selectedIds: ReadonlySet<string>
  onSelect: (cardId: string, additive: boolean) => void
  onDragBy: (cardId: string, dx: number, dy: number) => void
  onDragEnd: () => void
  clear: () => void
  removeSelected: () => void
  /** Replace the selection (select all, marquee). */
  selectOnly: (cardIds: readonly string[]) => void
}

const EMPTY: ReadonlySet<string> = new Set()
// Screen pixels within which a dragged block snaps to another card's edge or center.
const SNAP_SCREEN_PX = 6

// Why: callbacks stay stable (cards are memoized) and read the latest
// selection/tool through refs.
export function useBoardSelection(worktreeId: string | null, tool: BoardTool): BoardSelection {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY)
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds
  const toolRef = useRef(tool)
  toolRef.current = tool

  useEffect(() => setSelectedIds(EMPTY), [worktreeId])

  const onSelect = useCallback(
    (cardId: string, additive: boolean) => {
      if (!worktreeId) {
        return
      }
      if (toolRef.current === 'eraser') {
        const card = getBoard(useAppStore.getState(), worktreeId).cards.find((c) => c.id === cardId)
        if (card && isErasableCard(card.kind)) {
          removeCardsWithUndo(worktreeId, [cardId])
        }
        return
      }
      setSelectedIds((prev) => {
        if (!additive) {
          return prev.has(cardId) && prev.size > 1 ? prev : new Set([cardId])
        }
        const next = new Set(prev)
        if (next.has(cardId)) {
          next.delete(cardId)
        } else {
          next.add(cardId)
        }
        return next
      })
      // BoardCardRenderer already lifts the card on press; a second bringToFront
      // here doubled store writes per click (Iris review).
    },
    [worktreeId]
  )

  // Why: cards report per-frame deltas; snapping needs the whole gesture, so the
  // raw offset is accumulated and only the snapped difference is applied.
  const drag = useRef<{
    ids: string[]
    start: SnapBox
    others: SnapBox[]
    raw: { x: number; y: number }
    applied: { x: number; y: number }
  } | null>(null)
  // Alignment guides live in their own store (board-snap-guides.ts) so a drag
  // frame never re-renders the Board route; the cards layer reads them.

  const onDragBy = useCallback(
    (cardId: string, dx: number, dy: number) => {
      if (!worktreeId) {
        return
      }
      const state = useAppStore.getState()
      const board = getBoard(state, worktreeId)
      if (!drag.current) {
        const selected = selectedRef.current
        const ids = selected.has(cardId) ? [...selected] : [cardId]
        const idSet = new Set(ids)
        const start = boundsOfBoxes(board.cards.filter((c) => idSet.has(c.id)))
        if (!start) {
          return
        }
        drag.current = {
          ids,
          start,
          others: board.cards.filter((c) => !idSet.has(c.id)),
          raw: { x: 0, y: 0 },
          applied: { x: 0, y: 0 }
        }
      }
      const d = drag.current
      d.raw = { x: d.raw.x + dx, y: d.raw.y + dy }
      const moved = { ...d.start, x: d.start.x + d.raw.x, y: d.start.y + d.raw.y }
      const snap = snapBoardBox(moved, d.others, SNAP_SCREEN_PX / board.viewport.zoom)
      const target = { x: d.raw.x + snap.dx, y: d.raw.y + snap.dy }
      state.moveCards(worktreeId, d.ids, target.x - d.applied.x, target.y - d.applied.y)
      d.applied = target
      setBoardSnapGuides(snap.guides.length ? snap.guides : NO_GUIDES)
    },
    [worktreeId]
  )

  const onDragEnd = useCallback(() => {
    drag.current = null
    setBoardSnapGuides(NO_GUIDES)
  }, [])

  const clear = useCallback(() => setSelectedIds(EMPTY), [])
  const selectOnly = useCallback(
    (cardIds: readonly string[]) => setSelectedIds(cardIds.length ? new Set(cardIds) : EMPTY),
    []
  )

  const removeSelected = useCallback(() => {
    const ids = [...selectedRef.current]
    if (!worktreeId || ids.length === 0) {
      return
    }
    removeCardsWithUndo(worktreeId, ids)
    setSelectedIds(EMPTY)
  }, [worktreeId])

  return useMemo(
    () => ({
      selectedIds,
      onSelect,
      onDragBy,
      onDragEnd,
      clear,
      removeSelected,
      selectOnly
    }),
    [clear, onDragBy, onDragEnd, onSelect, removeSelected, selectOnly, selectedIds]
  )
}
