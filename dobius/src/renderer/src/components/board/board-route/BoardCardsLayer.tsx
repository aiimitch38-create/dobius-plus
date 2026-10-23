import React, { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { BoardState } from '@/store/slices/board'
import { BoardCardRenderer } from '../cards/BoardCardRenderer'
import { GroupFrame } from '../cards/GroupFrame'
import { BoardLinksLayer } from '../board-links/BoardLinksLayer'
import { strokePathData } from '../cards/stroke-path'
import type { BoardPoint } from '../board-canvas/board-viewport'
import type { SnapGuide } from '../board-canvas/board-snap'

type BoardCardsLayerProps = {
  worktreeId: string
  board: BoardState
  selectedIds: ReadonlySet<string>
  onSelect: (cardId: string, additive: boolean) => void
  onDragBy: (cardId: string, dx: number, dy: number) => void
  onDragEnd: () => void
  /** Alignment guides for the card drag in progress (world coords). */
  guides: readonly SnapGuide[]
  /** In-progress pen stroke (world coords), drawn until the card is created. */
  penPoints: readonly BoardPoint[]
}

export function BoardCardsLayer({
  worktreeId,
  board,
  selectedIds,
  onSelect,
  onDragBy,
  onDragEnd,
  guides,
  penPoints
}: BoardCardsLayerProps): React.JSX.Element {
  const zoom = board.viewport.zoom
  const cards = useMemo(() => [...board.cards].sort((a, b) => a.z - b.z), [board.cards])

  return (
    <>
      {board.groups.map((group) => (
        <GroupFrame
          key={group.id}
          group={group}
          cards={board.cards}
          zoom={zoom}
          onDragBy={(dx, dy) => useAppStore.getState().moveCards(worktreeId, group.cardIds, dx, dy)}
        />
      ))}
      <BoardLinksLayer worktreeId={worktreeId} board={board} />
      {cards.map((card) => (
        <BoardCardRenderer
          key={card.id}
          worktreeId={worktreeId}
          card={card}
          zoom={zoom}
          selected={selectedIds.has(card.id)}
          onSelect={onSelect}
          onDragBy={onDragBy}
          onDragEnd={onDragEnd}
        />
      ))}
      {guides.length > 0 ? (
        <svg
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          width={1}
          height={1}
          aria-hidden
        >
          {guides.map((g, i) =>
            g.axis === 'x' ? (
              <line
                key={i}
                x1={g.at}
                x2={g.at}
                y1={g.from}
                y2={g.to}
                stroke="var(--board-accent)"
                strokeWidth={1 / zoom}
              />
            ) : (
              <line
                key={i}
                x1={g.from}
                x2={g.to}
                y1={g.at}
                y2={g.at}
                stroke="var(--board-accent)"
                strokeWidth={1 / zoom}
              />
            )
          )}
        </svg>
      ) : null}
      {penPoints.length > 0 ? (
        <svg
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          width={1}
          height={1}
        >
          <path
            d={strokePathData(penPoints.map((p) => [p.x, p.y]))}
            fill="none"
            stroke="var(--board-text)"
            strokeWidth={3 / zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </>
  )
}
