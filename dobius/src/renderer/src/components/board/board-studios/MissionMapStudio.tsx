import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { swatchEdge, swatchFill } from '../cards/card-swatch'
import { focusBoardCards } from '../console-card/console-actions'
import { consoleStatusLabel, type ConsoleCardStatus } from '../console-card/console-card-status'
import { useConsoleCardStatus } from '../console-card/use-console-card-status'
import {
  MISSION_MAP_FILTERS,
  missionMapFilterCounts,
  missionMapVisibleNodeIds,
  type MissionMapFilter
} from './mission-map-filter'
import { MissionMapInspector } from './MissionMapInspector'
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
const DIMMED_OPACITY = 0.25

function filterLabel(filter: MissionMapFilter): string {
  switch (filter) {
    case 'all':
      return translate('board.studio.missionMap.filter.all', 'All')
    case 'working':
      return translate('board.studio.missionMap.filter.working', 'Working')
    case 'waiting':
      return translate('board.studio.missionMap.filter.waiting', 'Needs you')
    case 'idle':
      return translate('board.studio.missionMap.filter.idle', 'Idle')
    case 'done':
      return translate('board.studio.missionMap.filter.done', 'Done')
  }
}

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

// Frames the node's cards on the Board and raises them.
function focusNodeOnBoard(worktreeId: string, node: MissionMapNode): void {
  const board = getBoard(useAppStore.getState(), worktreeId)
  focusBoardCards(worktreeId, missionMapNodeCardIds(node, board.groups))
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
  const [filter, setFilter] = useState<MissionMapFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Keyed by console node id; each ConsoleNode reports its own live status.
  const [statuses, setStatuses] = useState<Record<string, ConsoleCardStatus>>({})
  const onStatus = useCallback((nodeId: string, status: ConsoleCardStatus) => {
    setStatuses((prev) => (prev[nodeId] === status ? prev : { ...prev, [nodeId]: status }))
  }, [])
  const consoleIds = useMemo(
    () => new Set(layout.nodes.filter((n) => n.kind === 'console').map((n) => n.id)),
    [layout]
  )
  // Why: a removed console must not keep counting under a chip.
  const liveStatuses = useMemo(
    () => Object.fromEntries(Object.entries(statuses).filter(([id]) => consoleIds.has(id))),
    [statuses, consoleIds]
  )
  const counts = useMemo(() => missionMapFilterCounts(liveStatuses), [liveStatuses])
  const visible = useMemo(
    () => missionMapVisibleNodeIds(layout.nodes, layout.edges, liveStatuses, filter),
    [layout, liveStatuses, filter]
  )

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
  const selected = selectedId ? (nodeById.get(selectedId) ?? null) : null
  // Lands the user on what they picked: frame it on the Board, close the studio.
  const focus = (node: MissionMapNode): void => {
    focusNodeOnBoard(worktreeId, node)
    onClose()
  }
  const select = (node: MissionMapNode): void => setSelectedId(node.id)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="toolbar"
        aria-label={translate('board.studio.missionMap.filterLabel', 'Filter consoles')}
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--board-panel-border)] px-4 py-2"
      >
        {MISSION_MAP_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium',
              filter === option
                ? 'border-[var(--board-accent)] bg-[var(--board-accent-tint)] text-[var(--board-text)]'
                : 'border-[var(--board-chip-border)] bg-[var(--board-chip)] text-[var(--board-text-muted)] hover:text-[var(--board-text)]'
            )}
          >
            {filterLabel(option)}
            <span className="tabular-nums opacity-70">{counts[option]}</span>
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-sleek min-h-0 min-w-0 flex-1 overflow-auto p-4">
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
                  opacity={visible.has(edge.from) && visible.has(edge.to) ? 0.9 : DIMMED_OPACITY}
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
                <ConsoleNode
                  key={node.id}
                  node={node}
                  worktreeId={worktreeId}
                  dimmed={!visible.has(node.id)}
                  selected={node.id === selectedId}
                  onSelect={select}
                  onFocus={focus}
                  onStatus={onStatus}
                />
              ) : (
                <StaticNode
                  key={node.id}
                  node={node}
                  dimmed={!visible.has(node.id)}
                  selected={node.id === selectedId}
                  onSelect={select}
                  onFocus={focus}
                />
              )
            )}
          </svg>
        </div>
        {selected ? (
          <MissionMapInspector
            worktreeId={worktreeId}
            node={selected}
            statuses={liveStatuses}
            statusColor={statusColor}
            onFocus={focus}
            onClose={() => setSelectedId(null)}
          />
        ) : null}
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

type NodeInteraction = {
  dimmed: boolean
  selected: boolean
  /** Click / Enter: open the inspector. */
  onSelect: (node: MissionMapNode) => void
  /** Double-click: jump to it on the Board. */
  onFocus: (node: MissionMapNode) => void
}

function NodeFrame({
  node,
  fill,
  stroke,
  label,
  dimmed,
  selected,
  onSelect,
  onFocus,
  children
}: NodeInteraction & {
  node: MissionMapNode
  fill: string
  stroke: string
  label: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={translate(
        'board.studio.missionMap.inspect',
        'Inspect {{name}}; double-click to show it on the board',
        { name: label }
      )}
      opacity={dimmed ? DIMMED_OPACITY : 1}
      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-[var(--board-accent)] [&:hover>rect]:opacity-90"
      onClick={() => onSelect(node)}
      onDoubleClick={() => onFocus(node)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(node)
        }
      }}
    >
      <rect
        width={MISSION_MAP_NODE_W}
        height={MISSION_MAP_NODE_H}
        rx={10}
        fill={fill}
        stroke={selected ? 'var(--board-accent)' : stroke}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      {children}
    </g>
  )
}

function StaticNode({
  node,
  ...interaction
}: NodeInteraction & {
  node: Extract<MissionMapNode, { kind: 'orchestrator' | 'group' }>
}): React.JSX.Element {
  const fill = node.kind === 'group' ? swatchFill(node.color) : 'var(--board-accent-tint)'
  const stroke = node.kind === 'group' ? swatchEdge(node.color) : 'var(--board-accent)'
  const kindLabel =
    node.kind === 'group'
      ? translate('board.studio.missionMap.kind.group', 'Group')
      : translate('board.studio.missionMap.kind.orchestrator', 'Orchestrator')
  return (
    <NodeFrame {...interaction} node={node} fill={fill} stroke={stroke} label={node.label}>
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
  onStatus,
  ...interaction
}: NodeInteraction & {
  node: Extract<MissionMapNode, { kind: 'console' }>
  worktreeId: string
  onStatus: (nodeId: string, status: ConsoleCardStatus) => void
}): React.JSX.Element {
  const { status } = useConsoleCardStatus(worktreeId, node.tabId)
  useEffect(() => {
    onStatus(node.id, status)
  }, [node.id, status, onStatus])
  const color = statusColor(status)
  return (
    <NodeFrame
      {...interaction}
      node={node}
      fill="var(--board-panel-2)"
      stroke={color}
      label={node.label}
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
