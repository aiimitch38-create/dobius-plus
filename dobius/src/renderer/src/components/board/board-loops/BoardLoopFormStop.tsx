import React, { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { LoopFormValues, LoopStopGoalMode } from './loop-form'
import { loopStopSummary } from './loop-form-summary'
import {
  Hint,
  INPUT_CLASS,
  PILL_CLASS,
  PILL_OFF_CLASS,
  PILL_ON_CLASS,
  SectionLabel,
  SmallNumber,
  TEXTAREA_CLASS,
  type BoardShape,
  type SetField
} from './loop-form-ui'
import { LoopToggle } from './LoopToggle'

const DEFAULT_STOP_RUNS = 10
const DEFAULT_STOP_MINUTES = 120

// ---- STOP ------------------------------------------------------------------

function StopRow({
  title,
  sub,
  on,
  onToggle,
  children
}: {
  title: string
  sub?: string
  on: boolean
  onToggle: (on: boolean) => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <LoopToggle checked={on} onChange={onToggle} label={title} />
        <span className="min-w-0 flex-1 text-[13px] text-[var(--board-text)]">
          <span className="font-medium">{title}</span>
          {sub ? <span className="text-[var(--board-text-muted)]"> · {sub}</span> : null}
        </span>
      </div>
      {on && children ? <div className="pl-[50px]">{children}</div> : null}
    </div>
  )
}

function GoalModePills({ form, set }: { form: LoopFormValues; set: SetField }): React.JSX.Element {
  const judgeAllowed = form.kind === 'schedule'
  const modes: { mode: LoopStopGoalMode; label: string; disabledWhy: string | null }[] = [
    {
      mode: 'card',
      label: translate('board.loops.stop.mode.card', 'A goal card is complete'),
      disabledWhy: null
    },
    {
      mode: 'command',
      label: translate('board.loops.stop.mode.command', 'A command passes'),
      disabledWhy: null
    },
    {
      mode: 'judge',
      label: translate('board.loops.stop.mode.judge', 'An agent judges a goal'),
      disabledWhy: judgeAllowed
        ? null
        : translate(
            'board.loops.stop.mode.judgeNeedsSchedule',
            'Needs "On a schedule": a separate read-only agent checks after each run.'
          )
    }
  ]
  return (
    <div role="radiogroup" className="flex flex-wrap gap-1.5">
      {modes.map(({ mode, label, disabledWhy }) => {
        const pill = (
          <button
            type="button"
            role="radio"
            aria-checked={form.stopGoalMode === mode}
            disabled={disabledWhy !== null}
            onClick={() => set('stopGoalMode', mode)}
            className={cn(
              PILL_CLASS,
              'h-7 px-3 text-[12px]',
              form.stopGoalMode === mode ? PILL_ON_CLASS : PILL_OFF_CLASS
            )}
          >
            {label}
          </button>
        )
        return disabledWhy === null ? (
          <React.Fragment key={mode}>{pill}</React.Fragment>
        ) : (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{pill}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{disabledWhy}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

export function BoardLoopFormStop({
  form,
  set,
  board
}: {
  form: LoopFormValues
  set: SetField
  board: BoardShape
}): React.JSX.Element {
  const goalCards = useMemo(
    () =>
      board.cards.flatMap((c) =>
        c.kind === 'goal'
          ? [
              {
                id: c.id,
                title: c.title || c.goal,
                done: c.criteria.filter((i) => i.done).length,
                total: c.criteria.length
              }
            ]
          : []
      ),
    [board]
  )
  const goalCardTitle = goalCards.find((g) => g.id === form.stopGoalCardId)?.title ?? null

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>{translate('board.loops.section.stop', 'Stop')}</SectionLabel>
      <div className="divide-y divide-[var(--board-panel-border)] rounded-[12px] border border-[var(--board-panel-border)] bg-[var(--board-panel)]">
        <StopRow
          title={translate('board.loops.stop.runs', 'After a number of runs')}
          on={form.stopAfterRuns > 0}
          onToggle={(on) => set('stopAfterRuns', on ? DEFAULT_STOP_RUNS : 0)}
        >
          <SmallNumber
            value={form.stopAfterRuns}
            min={1}
            suffix={translate('board.loops.unit.runs', 'runs')}
            label={translate('board.loops.stop.runs', 'After a number of runs')}
            onChange={(n) => set('stopAfterRuns', n)}
          />
        </StopRow>
        <StopRow
          title={translate('board.loops.stop.time', 'After a time limit')}
          on={form.stopAfterMin > 0}
          onToggle={(on) => set('stopAfterMin', on ? DEFAULT_STOP_MINUTES : 0)}
        >
          <SmallNumber
            value={form.stopAfterMin}
            min={1}
            suffix={translate('board.loops.unit.minutesFromNow', 'minutes from now')}
            label={translate('board.loops.stop.time', 'After a time limit')}
            onChange={(n) => set('stopAfterMin', n)}
          />
        </StopRow>
        <StopRow
          title={translate('board.loops.stop.goal', 'When a goal is met')}
          sub={translate('board.loops.stop.goalSub', 'Stop by outcome, not by count')}
          on={form.stopGoalOn}
          onToggle={(on) => {
            set('stopGoalOn', on)
            if (on && form.stopGoalMode === 'card' && goalCards.length === 0) {
              set('stopGoalMode', 'command')
            }
          }}
        >
          <div className="flex flex-col gap-2">
            <GoalModePills form={form} set={set} />
            {form.stopGoalMode === 'card' &&
              (goalCards.length === 0 ? (
                <Hint>
                  {translate(
                    'board.loops.stop.noGoalCards',
                    'Add a Goal card to the board first; the loop stops once every item on it is checked.'
                  )}
                </Hint>
              ) : (
                <Select value={form.stopGoalCardId} onValueChange={(v) => set('stopGoalCardId', v)}>
                  <SelectTrigger size="sm" className="w-full max-w-sm">
                    <SelectValue
                      placeholder={translate('board.loops.stop.pickGoalCard', 'Pick a goal card')}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {goalCards.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.title} · {g.done}/{g.total}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
            {form.stopGoalMode === 'command' && (
              <div className="flex flex-col gap-1">
                <Input
                  value={form.stopCommand}
                  maxLength={200}
                  placeholder={translate(
                    'board.loops.field.stopCommandHint',
                    'e.g. pnpm run build'
                  )}
                  aria-label={translate('board.loops.stop.mode.command', 'A command passes')}
                  onChange={(e) => set('stopCommand', e.target.value)}
                  className={cn(INPUT_CLASS, 'max-w-sm font-mono')}
                />
                <Hint>
                  {translate(
                    'board.loops.stop.commandHint',
                    'Runs in this workspace after each run, once the agents settle. Exit 0 ends the loop. One plain command, nothing that changes files.'
                  )}
                </Hint>
              </div>
            )}
            {form.stopGoalMode === 'judge' && (
              <div className="flex flex-col gap-1">
                <textarea
                  className={TEXTAREA_CLASS}
                  value={form.goal}
                  placeholder={translate(
                    'board.loops.field.goalHint',
                    'e.g. All tests pass and the README documents the new flag'
                  )}
                  aria-label={translate('board.loops.field.goal', 'Goal')}
                  onChange={(e) => set('goal', e.target.value)}
                />
                <Hint>
                  {translate(
                    'board.loops.judge.agentHint',
                    'A throwaway, read-only Claude session reads the latest console output and gives a verdict. It has no tools and never types into a console. Checked after the targeted agent settles.'
                  )}
                </Hint>
              </div>
            )}
          </div>
        </StopRow>
        <p className="px-3 py-2.5 text-[12px] text-[var(--board-text-muted)]">
          {loopStopSummary(form, goalCardTitle)}
        </p>
      </div>
    </section>
  )
}
