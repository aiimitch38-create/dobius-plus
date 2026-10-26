import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { BoardLoopTemplate } from './board-loop-templates'
import { BoardLoopFormStop } from './BoardLoopFormStop'
import { BoardLoopFormTarget } from './BoardLoopFormTarget'
import { BoardLoopFormWhen } from './BoardLoopFormWhen'
import { BoardLoopTemplatePills } from './BoardLoopTemplatesGrid'
import type { LoopFormValues } from './loop-form'
import { loopEstimateLine } from './loop-form-estimate'
import { describeFormTarget, loopSummarySentence } from './loop-form-summary'
import {
  Hint,
  INPUT_CLASS,
  SECTION_LABEL_CLASS,
  SectionLabel,
  TEXTAREA_CLASS,
  type BoardShape,
  type SetField
} from './loop-form-ui'
import { LoopToggle } from './LoopToggle'

// Layout mirrors the reference loop form (sym-loops-form-*.png): section labels,
// WHEN option cards, TARGET radio rows, a bordered STOP box with toggles, and a
// sticky footer with the accent summary sentence and the prompts/hour estimate.

export function BoardLoopForm({
  initial,
  board,
  templateId,
  onPickTemplate,
  busy,
  onCancel,
  onSubmit
}: {
  initial: LoopFormValues
  board: BoardShape
  /** Template the form started from (highlights its pill); null = from scratch. */
  templateId: string | null
  onPickTemplate: (template: BoardLoopTemplate) => void
  busy: boolean
  onCancel: () => void
  onSubmit: (form: LoopFormValues) => void
}): React.JSX.Element {
  const [form, setForm] = useState(initial)
  const set: SetField = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const targetSummary = describeFormTarget(form, board)
  const consoleCount = targetSummary.kind === 'none' ? 0 : targetSummary.count
  const estimate = loopEstimateLine(form, consoleCount)
  const sentence = loopSummarySentence(form, targetSummary)

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(form)
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <section className="flex flex-col gap-2">
        <SectionLabel>{translate('board.loops.templates', 'Templates')}</SectionLabel>
        <BoardLoopTemplatePills selectedId={templateId} onPick={onPickTemplate} />
      </section>

      <section className="flex flex-col gap-2">
        <Label htmlFor="board-loop-name" className={SECTION_LABEL_CLASS}>
          {translate('board.loops.field.name', 'Name')}
        </Label>
        <Input
          id="board-loop-name"
          autoFocus
          value={form.name}
          placeholder={translate('board.loops.field.namePlaceholder', 'e.g. Progress check')}
          onChange={(e) => set('name', e.target.value)}
          className={INPUT_CLASS}
        />
      </section>

      <section className="flex flex-col gap-2">
        <Label htmlFor="board-loop-instruction" className={SECTION_LABEL_CLASS}>
          {translate('board.loops.section.instruction', 'Instruction')}
        </Label>
        <textarea
          id="board-loop-instruction"
          className={TEXTAREA_CLASS}
          value={form.instruction}
          placeholder={translate(
            'board.loops.field.instructionPlaceholder',
            'What every targeted console should be told.'
          )}
          onChange={(e) => set('instruction', e.target.value)}
        />
        <Hint>
          {translate(
            'board.loops.field.instructionHint',
            'Typed into each targeted console exactly as written.'
          )}
        </Hint>
      </section>

      <BoardLoopFormWhen form={form} set={set} />
      <BoardLoopFormTarget form={form} set={set} board={board} />
      <BoardLoopFormStop form={form} set={set} board={board} />

      <section className="flex flex-col gap-3">
        <SectionLabel>{translate('board.loops.section.behavior', 'Behavior')}</SectionLabel>
        <div className="flex items-start gap-3">
          <LoopToggle
            checked={form.background}
            onChange={(on) => set('background', on)}
            label={translate('board.loops.field.background', 'Keep running behind other tabs')}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[13px] font-medium text-[var(--board-text)]">
              {translate('board.loops.field.background', 'Keep running behind other tabs')}
            </span>
            <Hint>
              {translate(
                'board.loops.field.backgroundHint',
                'This board’s consoles stay live when you switch repos. With this on, the loop keeps firing into them too. Off, it pauses with the tab and catches up when you return.'
              )}
            </Hint>
          </div>
        </div>
        <Hint>
          {translate(
            'board.loops.behavior.note',
            'Loops run while Dobius+ is open and your Mac is awake. An instruction is only typed into a console with a live agent, never into a bare shell, and never while that agent is waiting on a permission prompt: the loop holds and retries once you answer.'
          )}
        </Hint>
      </section>

      <footer className="sticky bottom-0 z-10 -mx-6 -mb-5 flex flex-wrap items-center gap-3 border-t border-[var(--board-panel-border)] bg-[var(--board-panel)] px-6 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[var(--board-accent)]">{sentence}</p>
          <p className="font-mono text-[11px] text-[var(--board-text-muted)]">{estimate}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-[var(--board-text)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]"
          >
            {translate('board.common.cancel', 'Cancel')}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={busy}
            className="rounded-full bg-[var(--board-accent)] px-4 text-[var(--board-accent-fg)] hover:bg-[var(--board-accent)]"
          >
            {translate('board.loops.create', 'Create loop')}
          </Button>
        </div>
      </footer>
    </form>
  )
}
