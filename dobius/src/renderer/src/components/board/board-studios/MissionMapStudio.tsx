import React, { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { translate } from '@/i18n/i18n'
import { fitViewportToRects } from '../board-canvas/board-viewport'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import { swatchEdge, swatchFill } from '../cards/card-swatch'
import {
  consoleCardStatus,
  consoleStatusLabel,
  type ConsoleCardStatus
} from '../console-card/console-card-status'
import { useConsolePane } from '../console-card/use-console-pane'
import { useConsoleForeground, useConsolePaused } from '../console-card/use-console-runtime'
import {
  MISSION_MAP_NODE_H,
  MISSION_MAP_NODE_W,
  layoutMissionMap,
  missionMapEdgePath,
  missionMapNodeCardIds,
  type MissionMapNode
} from './mission-map-layout'
import { StudioEmptyState } from './StudioEmptyState'

const LEGEND_STATUSES: readonly ConsoleCardStatus[] = [
  'working',
  'waiting',
  'done',
  'idle',
  'paused',
  'shell',
  'gone'
]
const LABEL_MAX_CHARS = 20

// Why: the map is read at a glance, so each live state gets one Board token.
function statusColor(status: ConsoleCardStatus): string {
  switch (status) {
    case 'working':
      return 'var(--board-live)'
    case 'waiting':
      return 'var(--board-accent)'
    case 'done':
      return 'var(--board-chip-border-alt)'
    case 'paused':
      return 'var(--board-text-muted)'
    case 'idle':
      return 'var(--board-chip-border)'
    case 'shell':
      return 'var(--board-text-muted)'
    case 'gone':
      return 'var(--board-danger-text)'
  }
}

function clipLabel(label: string): string {
  return label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label
}

// Frames the node's cards on the Board, raises them, and closes the studio so
// the user lands on what they clicked.
function focusNodeOnBoard(worktreeId: string, node: MissionMapNode): void {
  const state = useAppStore.getState()
  const board = getBoard(state, worktreeId)
  const ids = new Set(missionMapNodeCardIds(node, board.groups))
  const cards = board.cards.filter((c) => ids.has(c.id))
  if (cards.length === 0) {
    return
  }
  state.bringToFront(
    worktreeId,
    cards.map((c) => c.id)
  )
  state.setViewport(
    worktreeId,
    fitViewportToRects(
      cards.map((c) => ({ x: c.x, y: c.y, width: c.w, height: c.h })),
      { width: window.innerWidth, height: window.innerHeight }
    )
  )
}

// Live graph of orchestrators → groups → consoles for the active board.
export function MissionMapStudio({
  worktreeId,
  onClose
}: {
  worktreeId: string | null
  onClose: () => void
}): React.JSX.Element {
  const board = useAppStore((s) => getBoard(s, worktreeId))
  const layout = useMemo(() => layoutMissionMap(board.cards, board.groups), [board])
  const hasConsoles = layout.nodes.some((n) => n.kind === 'console')

  if (!worktreeId || !hasConsoles) {
    return (
      <StudioEmptyState
        title={translate('board.studio.missionMap.empty', 'No consoles on this board yet.')}
        detail={translate(
          'board.studio.missionMap.emptyDetail',
          'Spawn a console and the map will show how orchestrators, groups and consoles connect.'
        )}
      />
    )
  }

  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]))
  const focus = (node: MissionMapNode): void => {
    focusNodeOnBoard(worktreeId, node)
    onClose()
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-4">
        <svg
          role="img"
          aria-label={translate('board.studio.missionMap.graphLabel', 'Mission map graph')}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          className="block"
        >
          <defs>
            <marker
              id="mission-map-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" />
            </marker>
          </defs>
          {layout.edges.map((edge) => {
            const from = nodeById.get(edge.from)
            const to = nodeById.get(edge.to)
            if (!from || !to) {
              return null
            }
            return (
              <path
                key={edge.id}
                d={missionMapEdgePath(from, to)}
                fill="none"
                stroke={edge.kind === 'wire' ? 'var(--board-accent)' : 'var(--board-text-muted)'}
                strokeWidth={edge.kind === 'wire' ? 1.75 : 1.25}
                strokeDasharray={edge.kind === 'member' ? '4 4' : undefined}
                markerEnd="url(#mission-map-arrow)"
                opacity={0.9}
              />
            )
          })}
          {layout.ungroupedBucketY !== null ? (
            <text
              x={layout.nodes.find((n) => n.kind === 'console' && n.groupId === null)?.x ?? 0}
              y={layout.ungroupedBucketY - 8}
              fontSize={11}
              fontWeight={600}
              letterSpacing="0.05em"
              fill="var(--board-text-muted)"
            >
              {translate('board.studio.missionMap.ungrouped', 'UNGROUPED')}
            </text>
          ) : null}
          {layout.nodes.map((node) =>
            node.kind === 'console' ? (
              <ConsoleNode key={node.id} node={node} worktreeId={worktreeId} onFocus={focus} />
            ) : (
              <StaticNode key={node.id} node={node} onFocus={focus} />
            )
          )}
        </svg>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--board-panel-border)] px-4 py-2 text-[11px] text-[var(--board-text-muted)]">
        {LEGEND_STATUSES.map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ background: statusColor(status) }}
            />
            {consoleStatusLabel(status)}
          </span>
        ))}
      </footer>
    </div>
  )
}

function NodeFrame({
  node,
  fill,
  stroke,
  label,
  onFocus,
  children
}: {
  node: MissionMapNode
  fill: string
  stroke: string
  label: string
  onFocus: (node: MissionMapNode) => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      role="button"
      tabIndex={0}
      aria-label={translate('board.studio.missionMap.focus', 'Show {{name}} on the board', {
        name: label
      })}
      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-[var(--board-accent)] [&:hover>rect]:opacity-90"
      onClick={() => onFocus(node)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onFocus(node)
        }
      }}
    >
      <rect
        width={MISSION_MAP_NODE_W}
        height={MISSION_MAP_NODE_H}
        rx={10}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
      />
      {children}
    </g>
  )
}

function StaticNode({
  node,
  onFocus
}: {
  node: Extract<MissionMapNode, { kind: 'orchestrator' | 'group' }>
  onFocus: (node: MissionMapNode) => void
}): React.JSX.Element {
  const fill = node.kind === 'group' ? swatchFill(node.color) : 'var(--board-accent-tint)'
  const stroke = node.kind === 'group' ? swatchEdge(node.color) : 'var(--board-accent)'
  const kindLabel =
    node.kind === 'group'
      ? translate('board.studio.missionMap.kind.group', 'Group')
      : translate('board.studio.missionMap.kind.orchestrator', 'Orchestrator')
  return (
    <NodeFrame node={node} fill={fill} stroke={stroke} label={node.label} onFocus={onFocus}>
      <title>{node.label}</title>
      <text x={12} y={19} fontSize={13} fontWeight={600} fill="var(--board-text)">
        {clipLabel(node.label)}
      </text>
      <text x={12} y={34} fontSize={11} fill="var(--board-text-muted)">
        {kindLabel}
      </text>
    </NodeFrame>
  )
}

function ConsoleNode({
  node,
  worktreeId,
  onFocus
}: {
  node: Extract<MissionMapNode, { kind: 'console' }>
  worktreeId: string
  onFocus: (node: MissionMapNode) => void
}): React.JSX.Element {
  const { tabExists, paneKey } = useConsolePane(worktreeId, node.tabId)
  const entry = useAppStore((s) => (paneKey ? s.agentStatusByPaneKey[paneKey] : undefined))
  const sleeping = useAppStore((s) =>
    paneKey ? Boolean(s.sleepingAgentSessionsByPaneKey[paneKey]) : false
  )
  const boardPaused = useConsolePaused(node.tabId)
  const foreground = useConsoleForeground(node.tabId)
  // Why: subscribing to the epoch re-evaluates staleness when the feed ticks.
  useAppStore((s) => s.agentStatusEpoch)
  const status = consoleCardStatus({
    tabExists,
    paused: sleeping || boardPaused,
    foreground,
    entry,
    now: Date.now(),
    staleAfterMs: AGENT_STATUS_STALE_AFTER_MS
  })
  const color = statusColor(status)
  return (
    <NodeFrame
      node={node}
      fill="var(--board-panel-2)"
      stroke={color}
      label={node.label}
      onFocus={onFocus}
    >
      <title>{`${node.label} · ${consoleStatusLabel(status)}`}</title>
      <circle cx={16} cy={MISSION_MAP_NODE_H / 2} r={4.5} fill={color} />
      <text x={30} y={19} fontSize={13} fontWeight={600} fill="var(--board-text)">
        {clipLabel(node.label)}
      </text>
      <text x={30} y={34} fontSize={11} fill="var(--board-text-muted)">
        {`${node.agentKind} · ${consoleStatusLabel(status)}`}
      </text>
    </NodeFrame>
  )
}
