// SVG nodes and shared drawing rules for the Mission Map studio.
import React, { useEffect, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import { swatchEdge, swatchFill } from '../cards/card-swatch'
import { consoleStatusLabel, type ConsoleCardStatus } from '../console-card/console-card-status'
import { useConsoleCardStatus } from '../console-card/use-console-card-status'
import {
  MISSION_MAP_NODE_H,
  MISSION_MAP_NODE_W,
  type MissionMapEdge,
  type MissionMapNode
} from './mission-map-layout'

const LABEL_MAX_CHARS = 20
export const DIMMED_OPACITY = 0.25
/** How long a click waits for a second click before it opens the inspector. */
export const MISSION_MAP_DOUBLE_CLICK_MS = 250

// Why: the map is read at a glance, so each live state gets one Board token.
export function statusColor(status: ConsoleCardStatus): string {
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

export function edgeDash(kind: MissionMapEdge['kind']): string | undefined {
  switch (kind) {
    case 'wire':
      return undefined
    case 'member':
      return '4 4'
    case 'command':
      return '2 4'
  }
}

function clipLabel(label: string): string {
  return label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label
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
  // Why: opening the inspector on the first click shrinks the graph, so the
  // node slid out from under the second click and double-click never fired.
  // The first click now waits briefly; a second click jumps instead.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
      }
    },
    []
  )
  const handleClick = (event: React.MouseEvent): void => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    if (event.detail >= 2) {
      onFocus(node)
      return
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null
      onSelect(node)
    }, MISSION_MAP_DOUBLE_CLICK_MS)
  }
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
      onClick={handleClick}
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

export function StaticNode({
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

export function CommandCenterNode({
  node,
  ...interaction
}: NodeInteraction & {
  node: Extract<MissionMapNode, { kind: 'command-center' }>
}): React.JSX.Element {
  const detail = translate(
    'board.studio.missionMap.commandOnlyCount',
    '{{count}} only via command bar',
    { count: node.unwiredCount }
  )
  return (
    <NodeFrame
      {...interaction}
      node={node}
      fill="var(--board-panel-2)"
      stroke="var(--board-chip-border-alt)"
      label={node.label}
    >
      <title>{`${node.label} · ${detail}`}</title>
      <text
        x={16}
        y={MISSION_MAP_NODE_H / 2 + 5}
        fontSize={14}
        textAnchor="middle"
        fill="var(--board-accent)"
      >
        ⌘
      </text>
      <text x={30} y={19} fontSize={13} fontWeight={600} fill="var(--board-text)">
        {clipLabel(node.label)}
      </text>
      <text x={30} y={34} fontSize={11} fill="var(--board-text-muted)">
        {detail}
      </text>
    </NodeFrame>
  )
}

export function ConsoleNode({
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
