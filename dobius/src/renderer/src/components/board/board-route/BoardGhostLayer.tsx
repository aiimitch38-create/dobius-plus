import React from 'react'
import { translate } from '@/i18n/i18n'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import type { BoardCardKind } from '@/store/slices/board'
import { useBoardGhosts, type BoardGhost } from '../board-canvas/board-ghost-store'
import { BOARD_CARD_KIND_ICON } from '../cards/board-card-kind-icon'

// Shapes and strokes have no meaningful glyph: their ghost is the plain gray outline.
const OUTLINE_ONLY: ReadonlySet<BoardCardKind> = new Set(['shape', 'stroke'])

/** Icon side in world px: reads at ~48px on a console or web tile, never swamps a text card. */
function iconSide(w: number, h: number): number {
  return Math.max(18, Math.min(48, Math.round(Math.min(w, h) * 0.12)))
}

/**
 * A dashed outline at the exact spot and size a card is about to take, with the
 * card type's glyph centered (the agent's logo and name for a console). World
 * coordinates; the border stays 1.5 screen px at any zoom like the shape draft.
 */
export function BoardPlacementGhost({
  ghost,
  zoom
}: {
  ghost: BoardGhost
  zoom: number
}): React.JSX.Element {
  const outlineOnly = OUTLINE_ONLY.has(ghost.kind)
  const side = iconSide(ghost.w, ghost.h)
  const agent = ghost.kind === 'console' ? ghost.agent : undefined
  // A console with no TUI agent is a plain shell: terminal glyph + "Terminal".
  const label =
    ghost.kind !== 'console'
      ? null
      : agent
        ? getAgentLabel(agent)
        : translate('board.presets.agent.shell', 'Terminal')
  return (
    <div
      aria-hidden
      data-board-ghost={ghost.kind}
      className={cn(
        'pointer-events-none absolute flex flex-col items-center justify-center rounded-(--board-radius-card) border-dashed bg-transparent',
        'animate-in fade-in duration-[120ms] motion-reduce:animate-none',
        outlineOnly
          ? 'border-[color-mix(in_srgb,var(--board-text-muted)_55%,transparent)]'
          : 'border-[color-mix(in_srgb,var(--board-accent)_60%,transparent)]'
      )}
      style={{
        left: ghost.x,
        top: ghost.y,
        width: ghost.w,
        height: ghost.h,
        borderWidth: 1.5 / zoom,
        gap: Math.round(side * 0.25)
      }}
    >
      {outlineOnly ? null : (
        <>
          {agent ? (
            <AgentIcon agent={agent} size={side} />
          ) : (
            <span
              className="flex items-center justify-center text-[var(--board-text-muted)] [&_svg]:size-full"
              style={{ width: side, height: side }}
            >
              {BOARD_CARD_KIND_ICON[ghost.kind]}
            </span>
          )}
          {label ? (
            <span
              className="leading-none font-medium text-[var(--board-text-muted)]"
              style={{ fontSize: Math.max(12, Math.round(side * 0.3)) }}
            >
              {label}
            </span>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * Every live ghost: timed spawn ghosts first, then the hover/pointer preview.
 * Subscribes on its own, so a ghost change re-renders this layer only, never
 * the cards.
 */
export function BoardGhostLayer({ zoom }: { zoom: number }): React.JSX.Element | null {
  const ghosts = useBoardGhosts((s) => s.ghosts)
  const preview = useBoardGhosts((s) => s.preview)
  if (ghosts.length === 0 && preview.length === 0) {
    return null
  }
  // Why: keyed by rect, so a preview that turns into a spawn ghost at the same
  // spot (pick an agent, card lands) keeps its node and does not fade in twice.
  const byRect = new Map<string, BoardGhost>()
  for (const ghost of [...preview, ...ghosts]) {
    byRect.set(`${ghost.x},${ghost.y},${ghost.w},${ghost.h}`, ghost)
  }
  return (
    <>
      {[...byRect].map(([key, ghost]) => (
        <BoardPlacementGhost key={key} ghost={ghost} zoom={zoom} />
      ))}
    </>
  )
}
