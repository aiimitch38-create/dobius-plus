import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { Checkbox } from '@/components/ui/checkbox'
import type { LoopFormValues, LoopKind } from './loop-form'
import { loopEstimateLine } from './loop-form-estimate'

type Target = { key: string; label: string }

const TEXTAREA_CLASS =
  'min-h-16 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring'

function kindLabel(kind: LoopKind): string {
  switch (kind) {
    case 'on-idle':
      return translate('board.loops.kind.idle', 'When it goes idle')
    case 'on-output-match':
      return translate('board.loops.kind.match', 'When output matches')
    case 'goal':
      return translate('board.loops.kind.goal', 'Until a goal is met')
    case 'schedule':
      return translate('board.loops.kind.schedule', 'On a schedule')
  }
}

function NumberField({
  label,
  value,
  min = 1,
  onChange
}: {
  label: string
  value: number
  /** 0 for the "0 = never" stop fields; the browser blocks Save below this. */
  min?: number
  onChange: (n: number) => void
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <Label className="text-[12px]">{label}</Label>
      <Input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-8"
      />
    </div>
  )
}

type SetField = <K extends keyof LoopFormValues>(key: K, value: LoopFormValues[K]) => void

function GoalFields({ form, set }: { form: LoopFormValues; set: SetField }): React.JSX.Element {
  return (
    <>
      <div className="space-y-1">
        <Label className="text-[12px]">{translate('board.loops.field.goal', 'Goal')}</Label>
        <textarea
          className={TEXTAREA_CLASS}
          value={form.goal}
          placeholder={translate(
            'board.loops.field.goalHint',
            'e.g. All tests pass and the README documents the new flag'
          )}
          onChange={(e) => set('goal', e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[12px]">
          {translate('board.loops.field.judge', 'Who decides the goal is met')}
        </Label>
        <Select value={form.judge} onValueChange={(v) => set('judge', v as 'agent' | 'self')}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="agent">
              {translate('board.loops.judge.agent', 'An agent judges (separate Claude session)')}
            </SelectItem>
            <SelectItem value="self">
              {translate('board.loops.judge.self', 'The console reports it')}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[12px] text-[var(--board-text-muted)]">
          {form.judge === 'agent'
            ? translate(
                'board.loops.judge.agentHint',
                'A throwaway, read-only Claude session reads the latest console output and gives a verdict. It has no tools and never types into a console. Checked after the targeted agent settles.'
              )
            : translate(
                'board.loops.judge.selfHint',
                'The console is asked to print whether the goal is met when it stops.'
              )}
        </p>
      </div>
      {form.judge === 'agent' && (
        <div className="space-y-1">
          <Label className="text-[12px]">
            {translate('board.loops.field.goalInstruction', 'Tell the console (optional)')}
          </Label>
          <textarea
            className={TEXTAREA_CLASS}
            value={form.instruction}
            onChange={(e) => set('instruction', e.target.value)}
          />
        </div>
      )}
    </>
  )
}

export function BoardLoopForm({
  initial,
  targets,
  consoleCountFor,
  busy,
  onCancel,
  onSubmit
}: {
  initial: LoopFormValues
  targets: readonly Target[]
  /** How many consoles a target key reaches right now (for the prompts/hour estimate). */
  consoleCountFor: (targetKey: string) => number
  busy: boolean
  onCancel: () => void
  onSubmit: (form: LoopFormValues) => void
}): React.JSX.Element {
  const [form, setForm] = useState(initial)
  const set = <K extends keyof LoopFormValues>(key: K, value: LoopFormValues[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))
  const estimate = loopEstimateLine(form, consoleCountFor(form.targetKey))

  return (
    <form
      className="space-y-3 rounded-xl border border-[var(--board-panel-border)] bg-[var(--board-panel)] p-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(form)
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <div className="space-y-1">
        <Label className="text-[12px]">{translate('board.loops.field.name', 'Name')}</Label>
        <Input
          autoFocus
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          className="h-8"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[12px]">{translate('board.loops.field.trigger', 'Trigger')}</Label>
          <Select value={form.kind} onValueChange={(v) => set('kind', v as LoopKind)}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['schedule', 'on-idle', 'on-output-match', 'goal'] as const).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kindLabel(kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[12px]">
            {translate('board.loops.field.target', 'Console or group')}
          </Label>
          <Select value={form.targetKey} onValueChange={(v) => set('targetKey', v)}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {form.kind === 'goal' ? (
        <GoalFields form={form} set={set} />
      ) : (
        <div className="space-y-1">
          <Label className="text-[12px]">
            {translate('board.loops.field.instruction', 'Tell the console')}
          </Label>
          <textarea
            className={TEXTAREA_CLASS}
            value={form.instruction}
            onChange={(e) => set('instruction', e.target.value)}
          />
        </div>
      )}
      {form.kind === 'schedule' && (
        <NumberField
          label={translate('board.loops.field.everyMin', 'Every (minutes)')}
          value={form.everyMin}
          onChange={(n) => set('everyMin', n)}
        />
      )}
      {form.kind === 'on-idle' && (
        <NumberField
          label={translate('board.loops.field.debounce', 'Wait after idle (seconds)')}
          value={form.debounceSec}
          onChange={(n) => set('debounceSec', n)}
        />
      )}
      {form.kind === 'on-output-match' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[12px]">
              {translate('board.loops.field.pattern', 'Pattern (regex)')}
            </Label>
            <Input
              value={form.pattern}
              maxLength={200}
              onChange={(e) => set('pattern', e.target.value)}
              className="h-8 font-mono"
            />
          </div>
          <NumberField
            label={translate('board.loops.field.cooldown', 'Cooldown (seconds)')}
            value={form.cooldownSec}
            onChange={(n) => set('cooldownSec', n)}
          />
        </div>
      )}
      {form.kind === 'goal' && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={translate('board.loops.field.checkEvery', 'Check every (seconds)')}
            value={form.checkEverySec}
            onChange={(n) => set('checkEverySec', n)}
          />
          <NumberField
            label={translate('board.loops.field.maxRuns', 'Max runs')}
            value={form.maxRuns}
            onChange={(n) => set('maxRuns', n)}
          />
        </div>
      )}
      {form.kind !== 'goal' && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={translate('board.loops.field.stopAfter', 'Stop after (minutes, 0 = never)')}
            min={0}
            value={form.stopAfterMin}
            onChange={(n) => set('stopAfterMin', n)}
          />
          <NumberField
            label={translate('board.loops.field.stopAfterRuns', 'Stop after runs (0 = never)')}
            min={0}
            value={form.stopAfterRuns}
            onChange={(n) => set('stopAfterRuns', n)}
          />
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-[12px]">
          {translate('board.loops.field.stopCommand', 'Stop when this command passes (optional)')}
        </Label>
        <Input
          value={form.stopCommand}
          maxLength={200}
          placeholder={translate('board.loops.field.stopCommandHint', 'e.g. pnpm run build')}
          onChange={(e) => set('stopCommand', e.target.value)}
          className="h-8 font-mono"
        />
      </div>
      <label className="flex items-start gap-2 text-[12px]">
        <Checkbox
          checked={form.background}
          onCheckedChange={(checked) => set('background', checked === true)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">
            {translate('board.loops.field.background', 'Keep running behind other tabs')}
          </span>
          <span className="block text-[var(--board-text-muted)]">
            {translate(
              'board.loops.field.backgroundHint',
              'On: the loop keeps firing while you look at something else. Off: it waits while the Board is hidden and catches up when you come back.'
            )}
          </span>
        </span>
      </label>
      <p className="font-mono text-[11px] text-[var(--board-text-muted)]">{estimate}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {translate('board.common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {translate('board.loops.create', 'Create loop')}
        </Button>
      </div>
    </form>
  )
}
