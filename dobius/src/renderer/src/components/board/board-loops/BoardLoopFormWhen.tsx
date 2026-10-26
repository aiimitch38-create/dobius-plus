import React from 'react'
import { ChevronDown, ChevronUp, Clock, Moon, TextSearch, type LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { LoopFormValues, LoopKind } from './loop-form'
import { formatInterval } from './loop-form-summary'
import {
  IDLE_CARD_CLASS,
  INPUT_CLASS,
  PILL_CLASS,
  PILL_OFF_CLASS,
  PILL_ON_CLASS,
  SELECTED_CARD_CLASS,
  SectionLabel,
  SmallNumber,
  type SetField
} from './loop-form-ui'

const INTERVAL_PRESETS_MIN = [5, 10, 15, 30, 60, 120] as const
const MAX_INTERVAL_MIN = 24 * 60

// ---- WHEN ------------------------------------------------------------------

const WHEN_OPTIONS: {
  kind: LoopKind
  icon: LucideIcon
  title: () => string
  sub: () => string
}[] = [
  {
    kind: 'schedule',
    icon: Clock,
    title: () => translate('board.loops.when.schedule', 'On a schedule'),
    sub: () => translate('board.loops.when.scheduleSub', 'Repeats at a fixed interval.')
  },
  {
    kind: 'on-idle',
    icon: Moon,
    title: () => translate('board.loops.when.idle', 'When an agent goes idle'),
    sub: () =>
      translate('board.loops.when.idleSub', 'Fires the moment a targeted console finishes.')
  },
  {
    kind: 'on-output-match',
    icon: TextSearch,
    title: () => translate('board.loops.when.match', 'When output contains…'),
    sub: () => translate('board.loops.when.matchSub', 'Fires when a console prints matching text.')
  }
]

function IntervalPicker({
  everyMin,
  onChange
}: {
  everyMin: number
  onChange: (n: number) => void
}): React.JSX.Element {
  const clamp = (n: number): number => Math.min(MAX_INTERVAL_MIN, Math.max(1, Math.round(n)))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5">
        {INTERVAL_PRESETS_MIN.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={everyMin === preset}
            onClick={() => onChange(preset)}
            className={cn(PILL_CLASS, everyMin === preset ? PILL_ON_CLASS : PILL_OFF_CLASS)}
          >
            {formatInterval(preset)}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1 rounded-[10px] border border-[var(--board-panel-border)] bg-[var(--board-panel)] py-1 pr-1 pl-3">
        <span className="font-mono text-[12.5px] text-[var(--board-text)]">
          {translate('board.loops.when.every', 'every {{interval}}', {
            interval: formatInterval(everyMin)
          })}
        </span>
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={translate('board.loops.when.longer', 'One minute longer')}
            onClick={() => onChange(clamp(everyMin + 1))}
            className="flex h-3.5 w-5 items-center justify-center rounded-sm text-[var(--board-text-muted)] hover:text-[var(--board-text)]"
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            type="button"
            aria-label={translate('board.loops.when.shorter', 'One minute shorter')}
            onClick={() => onChange(clamp(everyMin - 1))}
            className="flex h-3.5 w-5 items-center justify-center rounded-sm text-[var(--board-text-muted)] hover:text-[var(--board-text)]"
          >
            <ChevronDown className="size-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function BoardLoopFormWhen({
  form,
  set
}: {
  form: LoopFormValues
  set: SetField
}): React.JSX.Element {
  // Why: a saved goal loop is not re-edited here; a goal-kind form shows as its schedule.
  const kind: LoopKind = form.kind === 'goal' ? 'schedule' : form.kind
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>{translate('board.loops.section.when', 'When')}</SectionLabel>
      <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {WHEN_OPTIONS.map((option) => {
          const selected = kind === option.kind
          const Icon = option.icon
          return (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => set('kind', option.kind)}
              className={cn(
                'flex flex-col gap-1.5 rounded-[12px] border p-3 text-left transition-colors',
                selected ? SELECTED_CARD_CLASS : IDLE_CARD_CLASS
              )}
            >
              <Icon aria-hidden className="size-4 text-[var(--board-accent)]" />
              <span className="text-[13px] font-semibold text-[var(--board-text)]">
                {option.title()}
              </span>
              <span className="text-[12px] leading-snug text-[var(--board-text-muted)]">
                {option.sub()}
              </span>
            </button>
          )
        })}
      </div>
      {kind === 'schedule' && (
        <IntervalPicker everyMin={form.everyMin} onChange={(n) => set('everyMin', n)} />
      )}
      {kind === 'on-idle' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] text-[var(--board-text)]">
            {translate('board.loops.when.idleWait', 'Wait after it goes idle')}
          </span>
          <SmallNumber
            value={form.debounceSec}
            min={1}
            suffix={translate('board.loops.unit.seconds', 'seconds')}
            label={translate('board.loops.field.debounce', 'Wait after idle (seconds)')}
            onChange={(n) => set('debounceSec', n)}
          />
        </div>
      )}
      {kind === 'on-output-match' && (
        <div className="flex flex-col gap-2">
          <Input
            value={form.pattern}
            maxLength={200}
            placeholder={translate(
              'board.loops.when.patternHint',
              'Text or regular expression, e.g. FAILED'
            )}
            aria-label={translate('board.loops.field.pattern', 'Pattern (regex)')}
            onChange={(e) => set('pattern', e.target.value)}
            className={cn(INPUT_CLASS, 'font-mono')}
          />
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12.5px] text-[var(--board-text)]">
              {translate('board.loops.when.cooldown', 'Then wait at least')}
            </span>
            <SmallNumber
              value={form.cooldownSec}
              min={5}
              suffix={translate(
                'board.loops.when.cooldownSuffix',
                'seconds before that console is told again'
              )}
              label={translate('board.loops.field.cooldown', 'Cooldown (seconds)')}
              onChange={(n) => set('cooldownSec', n)}
            />
          </div>
        </div>
      )}
    </section>
  )
}
