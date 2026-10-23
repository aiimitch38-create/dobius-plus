// "Belongs to" section of the Mission Map console inspector.
import React from 'react'
import { ChevronRight } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  COMMAND_CENTER_NODE_ID,
  groupNodeId,
  missionMapCommandersOf,
  type MissionMapLayout,
  type MissionMapNode
} from './mission-map-layout'

export const MISSION_MAP_SECTION_TITLE =
  'text-[11px] font-semibold tracking-[0.05em] text-[var(--board-text-muted)] uppercase'

function BelongsToRow({
  title,
  detail,
  onClick
}: {
  title: string
  detail: string
  onClick: (() => void) | null
}): React.JSX.Element {
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-[var(--board-text)]">
          {title}
        </span>
        <span className="block truncate text-[11px] text-[var(--board-text-muted)]">{detail}</span>
      </span>
      {onClick ? (
        <ChevronRight className="size-3.5 shrink-0 text-[var(--board-text-muted)]" />
      ) : null}
    </>
  )
  const row = 'flex w-full items-center gap-2 px-2.5 py-1.5 text-left'
  return onClick ? (
    <button type="button" className={`${row} hover:bg-[var(--board-panel-2)]`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={row}>{content}</div>
  )
}

/** Where a console takes orders from: always the command center, plus any orchestrator wiring. */
export function MissionMapBelongsTo({
  node,
  layout,
  groupName,
  onSelect
}: {
  node: Extract<MissionMapNode, { kind: 'console' }>
  layout: MissionMapLayout
  groupName: string | null
  onSelect: (node: MissionMapNode) => void
}): React.JSX.Element {
  const commanders = missionMapCommandersOf(layout, node.id)
  const nodeById = (id: string): MissionMapNode | undefined => layout.nodes.find((n) => n.id === id)
  const center = nodeById(COMMAND_CENTER_NODE_ID)
  const group = node.groupId ? nodeById(groupNodeId(node.groupId)) : undefined
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={MISSION_MAP_SECTION_TITLE}>
        {translate('board.studio.missionMap.inspector.belongsTo', 'Belongs to')}
      </h3>
      <div className="flex flex-col divide-y divide-[var(--board-panel-border)] overflow-hidden rounded-lg border border-[var(--board-panel-border)]">
        <BelongsToRow
          title={translate('board.studio.missionMap.commandCenter', 'Command center')}
          detail={
            commanders.length === 0
              ? translate(
                  'board.studio.missionMap.inspector.notWired',
                  'Not wired to any orchestrator'
                )
              : translate(
                  'board.studio.missionMap.inspector.commandBar',
                  'Reachable from the command bar'
                )
          }
          onClick={center ? () => onSelect(center) : null}
        />
        {group && groupName ? (
          <BelongsToRow
            title={groupName}
            detail={translate('board.studio.missionMap.kind.group', 'Group')}
            onClick={() => onSelect(group)}
          />
        ) : null}
        {commanders.map(({ node: commander, viaGroup }) => (
          <BelongsToRow
            key={commander.id}
            title={commander.label}
            detail={
              viaGroup
                ? translate('board.studio.missionMap.inspector.viaGroup', 'Through the group')
                : translate('board.studio.missionMap.inspector.direct', 'Wired directly')
            }
            onClick={() => onSelect(commander)}
          />
        ))}
      </div>
    </section>
  )
}
