import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { BoardState } from '@/store/slices/board'
import {
  DEFAULT_BOARD_CARD_STYLE,
  boardInkCss,
  boardStrokeDashArray,
  boardStrokePx
} from '../board-tool-panels/board-tool-style'
import type { Rect } from '../cards/card-geometry'
import {
  connectorArrows,
  goalCables,
  groupFrameRect,
  linkEndpoints,
  linkPath,
  orchestratorCables,
  toggleWired
} from './board-link-geometry'
import { useBoardLinkMode, type BoardLinkMode } from './board-link-mode'
import { OrchestratorCables } from './OrchestratorCables'

// Why: above every card (card z grows from 1) so connect-mode clicks never reach a card.
const TARGET_Z = 1_000_000

function LinkSvg({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={1}
      height={1}
      style={{ zIndex: 0 }}
    >
      {children}
    </svg>
  )
}

function ArrowHead({ id, color }: { id: string; color: string }): React.JSX.Element {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="8"
      markerHeight="8"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
    </marker>
  )
}

function TargetRect({
  rect,
  zoom,
  label,
  active,
  onPick
}: {
  rect: Rect
  zoom: number
  label: string
  active: boolean
  onPick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onPick()
      }}
      className="absolute cursor-crosshair rounded-[var(--board-radius-card)] bg-[var(--board-accent-tint)]/30 hover:bg-[var(--board-accent-tint)]/60 aria-pressed:bg-[var(--board-accent-tint)]/50"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: TARGET_Z,
        outline: `${2 / zoom}px dashed var(--board-accent)`
      }}
    />
  )
}

function WireTargets({
  board,
  mode,
  zoom
}: {
  board: BoardState
  mode: Extract<BoardLinkMode, { kind: 'wire' }>
  zoom: number
}): React.JSX.Element | null {
  const source = board.cards.find((c) => c.id === mode.orchestratorId)
  if (source?.kind !== 'orchestrator' && source?.kind !== 'goal') {
    return null
  }
  const isGoal = source.kind === 'goal'
  const wired = new Set(source.wiredCardIds)
  const wire = (targetIds: string[]): void =>
    useAppStore.getState().updateCard(mode.worktreeId, source.id, {
      wiredCardIds: toggleWired(source.wiredCardIds, targetIds)
    })
  const consoleIds = new Set(board.cards.filter((c) => c.kind === 'console').map((c) => c.id))
  // Why: a goal also reaches orchestrators, and wires a group by its id so later members get it.
  const targets = board.cards.filter(
    (c) => c.kind === 'console' || (isGoal && c.kind === 'orchestrator')
  )
  return (
    <>
      {board.groups.map((group) => {
        const members = group.cardIds.filter((id) => consoleIds.has(id))
        const rect = groupFrameRect(group, board.cards)
        if (!rect || members.length === 0) {
          return null
        }
        // Why: only the group's name strip is a target; the members below stay clickable one by one.
        const tab = { x: rect.x, y: rect.y - 28 / zoom, w: rect.w, h: 28 / zoom }
        const all = isGoal ? wired.has(group.id) : members.every((id) => wired.has(id))
        return (
          <TargetRect
            key={group.id}
            rect={tab}
            zoom={zoom}
            active={all}
            label={
              all
                ? translate('board.links.disconnectGroup', 'Disconnect group {{name}}', {
                    name: group.name
                  })
                : translate('board.links.wireGroup', 'Wire group {{name}}', { name: group.name })
            }
            onPick={() => wire(isGoal ? [group.id] : members)}
          />
        )
      })}
      {targets.map((c) => (
        <TargetRect
          key={c.id}
          rect={c}
          zoom={zoom}
          active={wired.has(c.id)}
          label={
            wired.has(c.id)
              ? translate('board.links.unwire', 'Unwire {{name}}', { name: c.title })
              : translate('board.links.wire', 'Wire {{name}}', { name: c.title })
          }
          onPick={() => wire([c.id])}
        />
      ))}
    </>
  )
}

function ArrowTargets({
  board,
  mode,
  zoom
}: {
  board: BoardState
  mode: Extract<BoardLinkMode, { kind: 'arrow' }>
  zoom: number
}): React.JSX.Element {
  return (
    <>
      {board.cards
        .filter((c) => c.id !== mode.fromCardId)
        .map((c) => (
          <TargetRect
            key={c.id}
            rect={c}
            zoom={zoom}
            active={false}
            label={translate('board.links.arrowTo', 'Draw the arrow to {{name}}', {
              name: c.title || c.kind
            })}
            onPick={() => {
              useAppStore
                .getState()
                .addConnector(mode.worktreeId, { fromCardId: mode.fromCardId, toCardId: c.id })
              useBoardLinkMode.getState().stop()
            }}
          />
        ))}
    </>
  )
}

/** Cables, card-to-card arrows, and connect-mode targets, in world coordinates. */
export function BoardLinksLayer({
  worktreeId,
  board
}: {
  worktreeId: string
  board: BoardState
}): React.JSX.Element {
  const zoom = board.viewport.zoom
  const rawMode = useBoardLinkMode((s) => s.mode)
  const mode = rawMode?.worktreeId === worktreeId ? rawMode : null
  const cables = [...orchestratorCables(board), ...goalCables(board)]
  const arrows = connectorArrows(board)

  // Esc leaves connect mode (capture so the Board's own Esc handlers don't also fire).
  useEffect(() => {
    if (!mode) {
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        useBoardLinkMode.getState().stop()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [mode])

  return (
    <>
      <LinkSvg>
        <OrchestratorCables
          cables={cables}
          worktreeId={worktreeId}
          zoom={zoom}
          emphasizedOrchestratorId={mode?.kind === 'wire' ? mode.orchestratorId : undefined}
        />
        {arrows.map((arrow) => {
          const style = arrow.connector.style ?? DEFAULT_BOARD_CARD_STYLE
          const color = boardInkCss(style.stroke)
          const px = boardStrokePx(style.strokeWidth)
          const { start, end } = linkEndpoints(arrow.from, arrow.to)
          const markerId = `board-arrow-head-${arrow.id}`
          return (
            <g key={arrow.id} opacity={style.opacity / 100}>
              <defs>
                <ArrowHead id={markerId} color={color} />
              </defs>
              <path
                d={linkPath(start, end)}
                fill="none"
                stroke={color}
                strokeWidth={px}
                strokeLinecap="round"
                strokeDasharray={boardStrokeDashArray(style.strokeStyle, px)}
                markerEnd={`url(#${markerId})`}
              />
              {arrow.connector.label ? (
                <text
                  x={(start.x + end.x) / 2}
                  y={(start.y + end.y) / 2 - 6}
                  textAnchor="middle"
                  fontSize={12}
                  fill="var(--board-text-muted)"
                >
                  {arrow.connector.label}
                </text>
              ) : null}
            </g>
          )
        })}
      </LinkSvg>
      {arrows.map((arrow) => {
        const { start, end } = linkEndpoints(arrow.from, arrow.to)
        const size = 20 / zoom
        return (
          <button
            key={arrow.id}
            type="button"
            aria-label={translate('board.links.removeArrow', 'Remove arrow')}
            title={translate('board.links.removeArrow', 'Remove arrow')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => useAppStore.getState().removeConnectors(worktreeId, [arrow.id])}
            className="absolute flex items-center justify-center rounded-full border border-[var(--board-panel-border)] bg-[var(--board-panel)] text-[var(--board-text-muted)] opacity-0 hover:opacity-100 focus-visible:opacity-100"
            style={{
              left: (start.x + end.x) / 2 - size / 2,
              top: (start.y + end.y) / 2 - size / 2,
              width: size,
              height: size,
              zIndex: 1
            }}
          >
            <X style={{ width: 12 / zoom, height: 12 / zoom }} />
          </button>
        )
      })}
      {mode?.kind === 'wire' ? <WireTargets board={board} mode={mode} zoom={zoom} /> : null}
      {mode?.kind === 'arrow' ? <ArrowTargets board={board} mode={mode} zoom={zoom} /> : null}
    </>
  )
}
