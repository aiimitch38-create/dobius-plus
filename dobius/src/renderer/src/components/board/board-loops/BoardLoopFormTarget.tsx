import React, { useMemo } from 'react'
import { Bot, Layers, ListChecks, Users, type LucideIcon } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { BoardState } from '@/store/slices/board'
import {
  BOARD_TARGET_KEY,
  PICKED_TARGET_KEY,
  formTarget,
  loopTargetTabIds,
  type LoopFormValues
} from './loop-form'
import { targetRowOf } from './loop-form-summary'
import {
  Hint,
  IDLE_CARD_CLASS,
  SELECTED_CARD_CLASS,
  SectionLabel,
  type BoardShape,
  type SetField
} from './loop-form-ui'

// ---- TARGET ----------------------------------------------------------------

function TargetRow({
  icon: Icon,
  title,
  sub,
  selected,
  disabled = false,
  onSelect,
  children
}: {
  icon: LucideIcon
  title: string
  sub: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-[12px] border transition-colors',
        selected ? SELECTED_CARD_CLASS : IDLE_CARD_CLASS,
        disabled && 'opacity-60'
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        className="flex w-full items-center gap-3 p-3 text-left disabled:cursor-not-allowed"
      >
        <span
          aria-hidden
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full border',
            selected
              ? 'border-[var(--board-accent)] bg-[var(--board-accent)]'
              : 'border-[var(--board-text-muted)]'
          )}
        >
          {selected && <span className="size-1.5 rounded-full bg-[var(--board-accent-fg)]" />}
        </span>
        <Icon aria-hidden className="size-4 shrink-0 text-[var(--board-accent)]" />
        <span className="min-w-0 flex-1 text-[13px] text-[var(--board-text)]">
          <span className="font-semibold">{title}</span>
          <span className="text-[var(--board-text-muted)]"> · {sub}</span>
        </span>
      </button>
      {selected && children ? <div className="px-3 pb-3 pl-14">{children}</div> : null}
    </div>
  )
}

export function BoardLoopFormTarget({
  form,
  set,
  board
}: {
  form: LoopFormValues
  set: SetField
  board: BoardShape
}): React.JSX.Element {
  const full = board as BoardState
  const consoles = useMemo(
    () =>
      board.cards.flatMap((c) =>
        c.kind === 'console' ? [{ tabId: c.tabId, title: c.title }] : []
      ),
    [board]
  )
  const orchestrators = useMemo(
    () =>
      board.cards.flatMap((c) =>
        c.kind === 'orchestrator'
          ? [
              {
                cardId: c.id,
                name: c.name,
                count: loopTargetTabIds({ type: 'orchestrator', cardId: c.id }, full).length
              }
            ]
          : []
      ),
    [board, full]
  )
  const groups = useMemo(
    () =>
      board.groups.map((g) => ({
        id: g.id,
        name: g.name,
        count: loopTargetTabIds({ type: 'group', groupId: g.id }, full).length
      })),
    [board, full]
  )
  const row = targetRowOf(form.targetKey)
  // A template's single-console key shows as that console ticked under "Pick consoles".
  const picked = form.targetKey.startsWith('tab:')
    ? [form.targetKey.slice('tab:'.length)]
    : form.pickedTabIds
  const selectedOrchestrator =
    row === 'orchestrator' ? form.targetKey.slice('orchestrator:'.length) : null
  const orchestratorCount =
    orchestrators.find((o) => o.cardId === selectedOrchestrator)?.count ??
    orchestrators[0]?.count ??
    0
  const pickTab = (tabId: string, on: boolean): void => {
    set('pickedTabIds', on ? [...new Set([...picked, tabId])] : picked.filter((id) => id !== tabId))
    set('targetKey', PICKED_TARGET_KEY)
  }
  const target = formTarget(form)
  const targetCount = target ? loopTargetTabIds(target, full).length : 0

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>{translate('board.loops.section.target', 'Target')}</SectionLabel>
      <div role="radiogroup" className="flex flex-col gap-2">
        <TargetRow
          icon={Layers}
          title={translate('board.loops.target.all', 'All consoles')}
          sub={translate(
            'board.loops.target.allSub',
            '{{count}} on the board, plus any opened later',
            { count: consoles.length }
          )}
          selected={row === 'board'}
          onSelect={() => set('targetKey', BOARD_TARGET_KEY)}
        />
        <TargetRow
          icon={Bot}
          title={translate('board.loops.target.orchestratorScope', 'Orchestrator scope')}
          sub={
            orchestrators.length === 0
              ? translate(
                  'board.loops.target.orchestratorNone',
                  'No orchestrator card on this board yet'
                )
              : translate(
                  'board.loops.target.orchestratorSub',
                  'Every console wired to it ({{count}} right now)',
                  { count: orchestratorCount }
                )
          }
          selected={row === 'orchestrator'}
          disabled={orchestrators.length === 0}
          onSelect={() => set('targetKey', `orchestrator:${orchestrators[0]?.cardId ?? ''}`)}
        >
          {orchestrators.length > 1 && (
            <Select
              value={selectedOrchestrator ?? ''}
              onValueChange={(v) => set('targetKey', `orchestrator:${v}`)}
            >
              <SelectTrigger size="sm" className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {orchestrators.map((o) => (
                  <SelectItem key={o.cardId} value={o.cardId}>
                    {o.name} · {o.count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </TargetRow>
        <TargetRow
          icon={ListChecks}
          title={translate('board.loops.target.pick', 'Pick consoles')}
          sub={translate('board.loops.target.pickSub', 'Choose exactly which consoles receive it')}
          selected={row === 'picked'}
          onSelect={() => {
            set('pickedTabIds', picked)
            set('targetKey', PICKED_TARGET_KEY)
          }}
        >
          <ul className="flex flex-col gap-1.5">
            {consoles.map((c) => (
              <li key={c.tabId}>
                <label className="flex items-center gap-2 text-[12.5px] text-[var(--board-text)]">
                  <Checkbox
                    checked={picked.includes(c.tabId)}
                    onCheckedChange={(checked) => pickTab(c.tabId, checked === true)}
                  />
                  <span className="truncate">{c.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </TargetRow>
        {groups.map((g) => (
          <TargetRow
            key={g.id}
            icon={Users}
            title={`@${g.name}`}
            sub={translate('board.loops.target.groupSub', '{{count}} consoles in this group', {
              count: g.count
            })}
            selected={form.targetKey === `group:${g.id}`}
            onSelect={() => set('targetKey', `group:${g.id}`)}
          />
        ))}
      </div>
      {form.kind === 'on-idle' && targetCount > 1 && (
        <Hint>
          {translate(
            'board.loops.target.idleManyHint',
            'With several consoles, the loop fires once all of them have gone idle.'
          )}
        </Hint>
      )}
    </section>
  )
}
