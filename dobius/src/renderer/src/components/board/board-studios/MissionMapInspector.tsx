import React, { useState } from 'react'
import { Crosshair, FileText, Pause, Play, RotateCcw, X } from 'lucide-react'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import { BoardOutputViewer } from '../board-command-bar/BoardOutputViewer'
import { replyExcerpt } from '../board-delivery/mission-state'
import {
  restartConsoleConfirmed,
  setConsolesPausedWithToast
} from '../console-card/console-actions'
import { consoleStatusLabel, type ConsoleCardStatus } from '../console-card/console-card-status'
import { useConsoleCardStatus } from '../console-card/use-console-card-status'
import { missionMapCanPause as canPause } from './mission-map-filter'
import {
  MISSION_MAP_SECTION_TITLE as SECTION_TITLE,
  MissionMapBelongsTo as BelongsTo
} from './MissionMapBelongsTo'
import {
  consoleNodeId,
  missionMapNodeCardIds,
  type MissionMapLayout,
  type MissionMapNode
} from './mission-map-layout'

type Console = BoardCardOf<'console'>

const ACTION =
  'flex h-7 items-center gap-1.5 rounded-full border border-[var(--board-panel-border)] px-2.5 text-[12px] font-medium text-[var(--board-text)] hover:bg-[var(--board-panel-2)] disabled:opacity-40 [&_svg]:size-3.5'

function agentName(kind: string): string {
  return isTuiAgent(kind) ? getAgentLabel(kind) : kind
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <dt className="w-16 shrink-0 text-[var(--board-text-muted)]">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-[var(--board-text)]">{children}</dd>
    </div>
  )
}

function StatusChip({
  status,
  color
}: {
  status: ConsoleCardStatus
  color: string
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block size-2 rounded-full"
        style={{ background: color }}
      />
      {consoleStatusLabel(status)}
    </span>
  )
}

function ConsoleInspector({
  worktreeId,
  card,
  groupName,
  statusColor,
  onFocus,
  belongsTo
}: {
  worktreeId: string
  card: Console
  groupName: string | null
  statusColor: (status: ConsoleCardStatus) => string
  onFocus: () => void
  belongsTo: React.ReactNode
}): React.JSX.Element {
  const confirm = useConfirmationDialog()
  const { status, lastReply } = useConsoleCardStatus(worktreeId, card.tabId)
  const [outputOpen, setOutputOpen] = useState(false)
  return (
    <>
      <dl className="flex flex-col gap-1.5">
        <Field label={translate('board.studio.missionMap.inspector.status', 'Status')}>
          <StatusChip status={status} color={statusColor(status)} />
        </Field>
        <Field label={translate('board.studio.missionMap.inspector.agent', 'Agent')}>
          {agentName(card.agentKind)}
        </Field>
        <Field label={translate('board.studio.missionMap.inspector.role', 'Role')}>
          {card.role || translate('board.studio.missionMap.inspector.none', 'None')}
        </Field>
        <Field label={translate('board.studio.missionMap.inspector.group', 'Group')}>
          {groupName ?? translate('board.studio.missionMap.inspector.ungrouped', 'Ungrouped')}
        </Field>
      </dl>
      {belongsTo}
      <section className="flex flex-col gap-1.5">
        <h3 className={SECTION_TITLE}>
          {translate('board.studio.missionMap.inspector.lastReport', 'Last report')}
        </h3>
        {lastReply ? (
          <>
            <p className="line-clamp-6 text-[12px] leading-relaxed text-[var(--board-text)]">
              {replyExcerpt(lastReply.text)}
            </p>
            <button
              type="button"
              className={`${ACTION} self-start`}
              onClick={() => setOutputOpen(true)}
            >
              <FileText />
              {translate('board.console.seeOutput', 'See output')}
            </button>
            <BoardOutputViewer
              report={{
                agent: agentName(card.agentKind),
                consoleTitle: card.title,
                excerpt: replyExcerpt(lastReply.text),
                full: lastReply.text,
                at: lastReply.at
              }}
              open={outputOpen}
              onOpenChange={setOutputOpen}
            />
          </>
        ) : (
          <p className="text-[12px] text-[var(--board-text-muted)]">
            {translate('board.studio.missionMap.inspector.noReport', 'No finished reply yet.')}
          </p>
        )}
      </section>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={ACTION} onClick={onFocus}>
          <Crosshair />
          {translate('board.studio.missionMap.inspector.focus', 'Focus')}
        </button>
        {status === 'paused' ? (
          <button
            type="button"
            className={ACTION}
            onClick={() => void setConsolesPausedWithToast([card], false)}
          >
            <Play />
            {translate('board.studio.missionMap.inspector.resume', 'Resume')}
          </button>
        ) : (
          <button
            type="button"
            className={ACTION}
            disabled={!canPause(status)}
            onClick={() => void setConsolesPausedWithToast([card], true)}
          >
            <Pause />
            {translate('board.studio.missionMap.inspector.pause', 'Pause')}
          </button>
        )}
        <button
          type="button"
          className={ACTION}
          onClick={() => restartConsoleConfirmed(worktreeId, card, confirm)}
        >
          <RotateCcw />
          {translate('board.console.restart', 'Restart')}
        </button>
      </div>
    </>
  )
}

function TeamInspector({
  members,
  statuses,
  statusColor,
  onFocus
}: {
  members: readonly Console[]
  statuses: Readonly<Record<string, ConsoleCardStatus>>
  statusColor: (status: ConsoleCardStatus) => string
  onFocus: () => void
}): React.JSX.Element {
  const statusOf = (c: Console): ConsoleCardStatus => statuses[consoleNodeId(c.id)] ?? 'idle'
  const pausable = members.filter((c) => canPause(statusOf(c)))
  const paused = members.filter((c) => statusOf(c) === 'paused')
  return (
    <>
      <section className="flex flex-col gap-1.5">
        <h3 className={SECTION_TITLE}>
          {translate('board.studio.missionMap.inspector.consoles', 'Consoles ({{count}})', {
            count: members.length
          })}
        </h3>
        {members.length === 0 ? (
          <p className="text-[12px] text-[var(--board-text-muted)]">
            {translate('board.studio.missionMap.inspector.noConsoles', 'No consoles yet.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {members.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-[var(--board-text)]">{c.title}</span>
                <span className="shrink-0 text-[var(--board-text-muted)]">
                  <StatusChip status={statusOf(c)} color={statusColor(statusOf(c))} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={ACTION} onClick={onFocus} disabled={members.length === 0}>
          <Crosshair />
          {translate('board.studio.missionMap.inspector.focus', 'Focus')}
        </button>
        <button
          type="button"
          className={ACTION}
          disabled={pausable.length === 0}
          onClick={() => void setConsolesPausedWithToast(pausable, true)}
        >
          <Pause />
          {translate('board.studio.missionMap.inspector.pause', 'Pause')}
        </button>
        <button
          type="button"
          className={ACTION}
          disabled={paused.length === 0}
          onClick={() => void setConsolesPausedWithToast(paused, false)}
        >
          <Play />
          {translate('board.studio.missionMap.inspector.resume', 'Resume')}
        </button>
      </div>
    </>
  )
}

/** Side panel for the selected Mission Map node: what it is, how it is doing, what to do. */
export function MissionMapInspector({
  worktreeId,
  node,
  layout,
  onSelect,
  statuses,
  statusColor,
  onFocus,
  onClose
}: {
  worktreeId: string
  node: MissionMapNode
  layout: MissionMapLayout
  /** Opens another node in this inspector (the "Belongs to" rows). */
  onSelect: (node: MissionMapNode) => void
  statuses: Readonly<Record<string, ConsoleCardStatus>>
  statusColor: (status: ConsoleCardStatus) => string
  onFocus: (node: MissionMapNode) => void
  onClose: () => void
}): React.JSX.Element {
  const board = useAppStore((s) => getBoard(s, worktreeId))
  const consoles = board.cards.filter((c): c is Console => c.kind === 'console')
  const kindLabel =
    node.kind === 'console'
      ? translate('board.studio.missionMap.kind.console', 'Console')
      : node.kind === 'group'
        ? translate('board.studio.missionMap.kind.group', 'Group')
        : node.kind === 'command-center'
          ? translate('board.studio.missionMap.kind.commandBar', 'Command bar')
          : translate('board.studio.missionMap.kind.orchestrator', 'Orchestrator')

  let body: React.ReactNode = null
  if (node.kind === 'console') {
    const card = consoles.find((c) => c.id === node.cardId)
    const groupName = board.groups.find((g) => g.id === node.groupId)?.name ?? null
    body = card ? (
      <ConsoleInspector
        key={card.id}
        worktreeId={worktreeId}
        card={card}
        groupName={groupName}
        statusColor={statusColor}
        onFocus={() => onFocus(node)}
        belongsTo={
          <BelongsTo node={node} layout={layout} groupName={groupName} onSelect={onSelect} />
        }
      />
    ) : null
  } else if (node.kind === 'command-center') {
    body = (
      <>
        <p className="text-[12px] leading-relaxed text-[var(--board-text-muted)]">
          {translate(
            'board.studio.missionMap.inspector.commandCenterDetail',
            'Every console takes orders from the command bar. {{count}} of {{total}} are not wired to any orchestrator.',
            { count: node.unwiredCount, total: node.cardIds.length }
          )}
        </p>
        <TeamInspector
          members={consoles.filter((c) => node.cardIds.includes(c.id))}
          statuses={statuses}
          statusColor={statusColor}
          onFocus={() => onFocus(node)}
        />
      </>
    )
  } else {
    const ids =
      node.kind === 'group'
        ? new Set(missionMapNodeCardIds(node, board.groups))
        : new Set(
            board.cards.find(
              (c): c is BoardCardOf<'orchestrator'> =>
                c.id === node.cardId && c.kind === 'orchestrator'
            )?.wiredCardIds ?? []
          )
    body = (
      <TeamInspector
        members={consoles.filter((c) => ids.has(c.id))}
        statuses={statuses}
        statusColor={statusColor}
        onFocus={() => onFocus(node)}
      />
    )
  }

  return (
    <aside
      aria-label={translate('board.studio.missionMap.inspector.label', 'Inspector')}
      className="scrollbar-sleek flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-[var(--board-panel-border)] p-4"
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-[var(--board-text)]">
            {node.label}
          </div>
          <div className="text-[11px] text-[var(--board-text-muted)]">{kindLabel}</div>
        </div>
        <button
          type="button"
          aria-label={translate('board.studio.missionMap.inspector.close', 'Close inspector')}
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]"
        >
          <X className="size-3.5" />
        </button>
      </header>
      {body}
    </aside>
  )
}
