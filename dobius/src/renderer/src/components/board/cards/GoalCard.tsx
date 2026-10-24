import { useEffect } from 'react'
import { BellRing, Cable, Check, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Checkbox } from '@/components/ui/checkbox'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard, type BoardGoalReminders } from '@/store/slices/board'
import { useBoardLinkMode } from '../board-links/board-link-mode'
import { goalProgress } from '../board-goal/goal-block'
import { useGoalDriftFlags } from '../board-goal/goal-drift'
import { ensureGoalReminders, remindGoalNow } from '../board-goal/goal-reminders'
import { goalTargetConsoles } from '../board-goal/goal-targets'
import type { CardBodyProps } from './card-body-props'
import { GoalCriteriaList, GoalDontList, GoalSectionLabel } from './GoalCardLists'

type GoalCardProps = CardBodyProps<'goal'> & { worktreeId: string }

const PILL_CLASS =
  'flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap'
const NO_DRIFT_FLAGS: never[] = []

function WirePicker({ worktreeId, card, onChange }: GoalCardProps): React.JSX.Element {
  const board = useAppStore((s) => getBoard(s, worktreeId))
  const options = [
    ...board.cards.flatMap((c) =>
      c.kind === 'console' || c.kind === 'orchestrator' ? [{ id: c.id, label: c.title }] : []
    ),
    ...board.groups.map((g) => ({ id: g.id, label: `@${g.name}` }))
  ]
  const wired = new Set(card.wiredCardIds)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`${PILL_CLASS} bg-[var(--board-accent-tint)] text-[var(--board-accent)]`}
        >
          {translate('board.orchestrator.wired', '{{count}} wired', {
            count: card.wiredCardIds.length
          })}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          {translate('board.goal.wireTo', 'Keep these on the goal')}
        </DropdownMenuLabel>
        {options.length === 0 ? (
          <div className="px-2 py-1 text-[12px] text-muted-foreground">
            {translate('board.orchestrator.noConsoles', 'No consoles on this board.')}
          </div>
        ) : (
          options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.id}
              checked={wired.has(o.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) =>
                onChange({
                  wiredCardIds: checked
                    ? [...card.wiredCardIds, o.id]
                    : card.wiredCardIds.filter((id) => id !== o.id)
                })
              }
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ConnectButton({ worktreeId, cardId }: { worktreeId: string; cardId: string }) {
  const connecting = useBoardLinkMode(
    (s) => s.mode?.kind === 'wire' && s.mode.orchestratorId === cardId
  )
  return (
    <button
      type="button"
      aria-pressed={connecting}
      onClick={() =>
        connecting
          ? useBoardLinkMode.getState().stop()
          : useBoardLinkMode.getState().start({ kind: 'wire', worktreeId, orchestratorId: cardId })
      }
      className={
        connecting
          ? `${PILL_CLASS} bg-[var(--board-accent)] text-[var(--board-accent-fg)]`
          : `${PILL_CLASS} border border-[var(--board-accent)] bg-[var(--board-accent-tint)] text-[var(--board-accent)] hover:opacity-90`
      }
    >
      {connecting ? <Check className="size-3" /> : <Cable className="size-3" />}
      {connecting
        ? translate('board.orchestrator.done', 'Done')
        : translate('board.orchestrator.connect', 'Connect')}
    </button>
  )
}

function ReminderSettings({
  reminders,
  driftCheck,
  onChange
}: {
  reminders: BoardGoalReminders
  driftCheck: boolean
  onChange: GoalCardProps['onChange']
}): React.JSX.Element {
  const set = (patch: Partial<BoardGoalReminders>): void =>
    onChange({ reminders: { ...reminders, ...patch } })
  const row = (
    checked: boolean,
    label: string,
    onToggle: (checked: boolean) => void,
    hint?: string
  ): React.JSX.Element => (
    <label className="flex items-center gap-2 text-[12px] text-[var(--board-text)]" title={hint}>
      <Checkbox checked={checked} onCheckedChange={(v) => onToggle(v === true)} />
      {label}
    </label>
  )
  return (
    <div className="flex flex-col gap-1.5 px-1">
      {row(
        reminders.afterCompaction,
        translate('board.goal.afterCompaction', 'After the agent compacts its context'),
        (v) => set({ afterCompaction: v }),
        translate(
          'board.goal.compactionGap',
          'Dobius does not receive a compaction signal from agents yet, so this trigger cannot fire today.'
        )
      )}
      <label className="flex items-center gap-2 text-[12px] text-[var(--board-text)]">
        <Checkbox
          checked={reminders.everyTurns > 0}
          onCheckedChange={(v) => set({ everyTurns: v === true ? 5 : 0 })}
        />
        {translate('board.goal.everyTurnsPrefix', 'Every')}
        <input
          type="number"
          min={1}
          max={100}
          value={reminders.everyTurns > 0 ? reminders.everyTurns : ''}
          disabled={reminders.everyTurns === 0}
          aria-label={translate('board.goal.everyTurnsCount', 'Turns between reminders')}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value))
            if (Number.isFinite(n) && n >= 1) {
              set({ everyTurns: Math.min(100, n) })
            }
          }}
          className="h-6 w-12 rounded-md border border-[var(--board-panel-border)] bg-transparent px-1 text-[12px] text-[var(--board-text)] outline-none disabled:opacity-40"
        />
        {translate('board.goal.everyTurnsSuffix', 'finished turns')}
      </label>
      {row(
        reminders.onNewTask,
        translate('board.goal.onNewTask', 'With every new task the orchestrator or planner sends'),
        (v) => set({ onNewTask: v })
      )}
      {row(
        driftCheck,
        translate('board.goal.driftCheck', 'Drift check: ask a read-only judge after each report'),
        (v) => onChange({ driftCheck: v })
      )}
    </div>
  )
}

function DriftFlags({ cardId }: { cardId: string }): React.JSX.Element | null {
  const flags = useGoalDriftFlags((s) => s.byGoal[cardId] ?? NO_DRIFT_FLAGS)
  if (flags.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1">
      {flags.map((f) => (
        <div
          key={f.tabId}
          role="status"
          className="flex items-start gap-1.5 rounded-md bg-[var(--board-danger-tint)] px-2 py-1 text-[12px] text-[var(--board-text)]"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--board-danger-text)]" />
          <span className="min-w-0 flex-1">
            {translate('board.goal.offGoal', '{{name}} may be off-goal: {{line}}', {
              name: f.consoleName,
              line: f.line
            })}
          </span>
          <button
            type="button"
            aria-label={translate('board.goal.dismissDrift', 'Dismiss')}
            onClick={() => useGoalDriftFlags.getState().clear(cardId, f.tabId)}
            className="text-[var(--board-text-muted)]"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

/** The main goal its wired agents (and orchestrators) are reminded of. */
export function GoalCard({ worktreeId, card, onChange }: GoalCardProps): React.JSX.Element {
  useEffect(ensureGoalReminders, [])
  const targetCount = useAppStore(
    (s) => goalTargetConsoles(getBoard(s, worktreeId), card.wiredCardIds).length
  )
  const { done, total } = goalProgress(card)

  const remindNow = (): void => {
    const { queued, waiting, noAgent } = remindGoalNow(worktreeId, card.id)
    toast.message(
      translate(
        'board.goal.remindResult',
        'Reminding {{queued}} now · {{waiting}} when free · {{noAgent}} without an agent',
        { queued, waiting, noAgent }
      )
    )
  }

  return (
    <div className="scrollbar-sleek flex size-full flex-col gap-1.5 overflow-y-auto p-3 text-[var(--board-text)]">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold tracking-[0.05em] text-[var(--board-text-muted)] uppercase">
          {total > 0
            ? translate('board.checklist.progress', '{{done}}/{{total}} done', { done, total })
            : translate('board.goal.noCriteria', 'No done-means yet')}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <WirePicker worktreeId={worktreeId} card={card} onChange={onChange} />
          <ConnectButton worktreeId={worktreeId} cardId={card.id} />
        </span>
      </div>
      <textarea
        value={card.goal}
        rows={3}
        placeholder={translate('board.goal.placeholder', 'The main goal, in 1 to 3 sentences')}
        aria-label={translate('board.goal.goalText', 'Main goal')}
        onChange={(e) => onChange({ goal: e.target.value })}
        className="min-h-[60px] resize-none rounded-md border border-[var(--board-panel-border)] bg-transparent px-2 py-1.5 text-[13px] leading-snug text-[var(--board-text)] outline-none placeholder:text-[var(--board-text-muted)] focus:border-[var(--board-accent)]"
      />
      <DriftFlags cardId={card.id} />
      <GoalSectionLabel>{translate('board.goal.doneMeans', 'Done means…')}</GoalSectionLabel>
      <GoalCriteriaList criteria={card.criteria} onChange={(criteria) => onChange({ criteria })} />
      <GoalSectionLabel>{translate('board.goal.dont', "Out of scope / don't")}</GoalSectionLabel>
      <GoalDontList items={card.dont} onChange={(dont) => onChange({ dont })} />
      <GoalSectionLabel>
        {translate('board.goal.remindWhen', 'Remind wired agents')}
      </GoalSectionLabel>
      <ReminderSettings
        reminders={card.reminders}
        driftCheck={card.driftCheck}
        onChange={onChange}
      />
      {targetCount === 0 ? (
        <p className="text-[12px] text-[var(--board-text-muted)]">
          {translate(
            'board.goal.nothingWired',
            'Nothing wired yet. Connect consoles, orchestrators or groups.'
          )}
        </p>
      ) : null}
      <button
        type="button"
        disabled={targetCount === 0 || !card.goal.trim()}
        onClick={remindNow}
        className="mt-auto flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[var(--board-accent)] text-[12px] font-semibold text-[var(--board-accent-fg)] disabled:opacity-40"
      >
        <BellRing className="size-3.5" />
        {translate('board.goal.remindNow', 'Remind now')}
      </button>
    </div>
  )
}
