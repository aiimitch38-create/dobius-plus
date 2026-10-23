import { useRef } from 'react'
import type { BoardCard, BoardGroup } from '@/store/slices/board'
import { boundsOf, screenDeltaToWorld } from './card-geometry'
import { swatchEdge, swatchFill } from './card-swatch'
import { shouldStartCardDrag } from './card-drag-target'
import { GroupFrameMenu } from '../board-groups/GroupFrameMenu'

const GROUP_PADDING = 24

export type GroupFrameProps = {
  group: BoardGroup
  cards: readonly BoardCard[]
  zoom: number
  /** Enables the Ungroup / Delete group menu on the name tab. */
  worktreeId?: string
  /** World-space delta to apply to every member card. */
  onDragBy: (dx: number, dy: number) => void
}

// Why: drawn below every card (z 0) so the frame never covers a member; only
// the name tab takes pointer input, which drags the whole group.
export function GroupFrame({
  group,
  cards,
  zoom,
  worktreeId,
  onDragBy
}: GroupFrameProps): React.JSX.Element | null {
  const last = useRef<{ id: number; x: number; y: number } | null>(null)
  const members = new Set(group.cardIds)
  const bounds = boundsOf(
    cards.filter((c) => members.has(c.id)),
    GROUP_PADDING
  )
  if (!bounds) {
    return null
  }
  const edge = swatchEdge(group.color)
  return (
    <div
      className="pointer-events-none absolute rounded-[calc(var(--board-radius-card)+12px)]"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.w,
        height: bounds.h,
        zIndex: 0,
        border: `${2 / (zoom || 1)}px solid ${edge}`,
        background: `color-mix(in oklch, ${swatchFill(group.color)} 35%, transparent)`
      }}
    >
      <div
        className="pointer-events-auto absolute left-4 flex -translate-y-1/2 cursor-grab items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold text-[var(--board-text)] select-none active:cursor-grabbing"
        style={{ top: 0, background: swatchFill(group.color), border: `1px solid ${edge}` }}
        onPointerDown={(e) => {
          if (!shouldStartCardDrag(e.button, e.target as Element, e.currentTarget)) {
            return
          }
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          last.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
        }}
        onPointerMove={(e) => {
          const l = last.current
          if (!l || l.id !== e.pointerId) {
            return
          }
          const { dx, dy } = screenDeltaToWorld(e.clientX - l.x, e.clientY - l.y, zoom)
          last.current = { id: l.id, x: e.clientX, y: e.clientY }
          onDragBy(dx, dy)
        }}
        onPointerUp={() => (last.current = null)}
        onPointerCancel={() => (last.current = null)}
      >
        {group.name}
        {worktreeId && <GroupFrameMenu worktreeId={worktreeId} group={group} />}
      </div>
    </div>
  )
}
