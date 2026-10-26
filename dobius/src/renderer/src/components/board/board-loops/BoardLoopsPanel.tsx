import { useState } from 'react'
import { Pause, Play, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import type { Automation } from '../../../../../shared/automations-types'
import { LOOP_PLACEHOLDER_RRULE, newLoopState } from '../../../../../shared/automation-loops'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree-id'
import { notifyAutomationsChanged, useBoardLoops } from './board-loop-list'
import type { BoardLoopTemplate } from './board-loop-templates'
import { BoardLoopForm } from './BoardLoopForm'
import { BoardLoopTemplatesGrid } from './BoardLoopTemplatesGrid'
import { loopFormFromTemplate } from './loop-form-template'
import {
  BOARD_TARGET_KEY,
  DEFAULT_LOOP_FORM,
  buildLoopTrigger,
  describeNextFire,
  formTarget,
  loopStopFields,
  loopTargetTabIds,
  type LoopFormValues
} from './loop-form'

type Draft = { form: LoopFormValues; templateId: string | null }

export function BoardLoopsPanel({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const { loops, refresh } = useBoardLoops(worktreeId)
  const board = useAppStore((s) => getBoard(s, worktreeId))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const consoles = board.cards.flatMap((c) => (c.kind === 'console' ? [c] : []))
  const consoleCount = consoles.length

  const firstConsoleKey = consoles[0] ? `tab:${consoles[0].tabId}` : BOARD_TARGET_KEY
  const startFromScratch = (): void =>
    setDraft({
      form: { ...DEFAULT_LOOP_FORM, kind: 'schedule', targetKey: BOARD_TARGET_KEY },
      templateId: null
    })
  const startFromTemplate = (template: BoardLoopTemplate): void =>
    setDraft({ form: loopFormFromTemplate(template, firstConsoleKey), templateId: template.id })

  const after = (): void => {
    notifyAutomationsChanged()
    refresh()
  }

  const create = async (form: LoopFormValues): Promise<void> => {
    const built = buildLoopTrigger(form)
    if (!built.ok) {
      toast.error(built.error)
      return
    }
    const stop = loopStopFields(form)
    if (!stop.ok) {
      toast.error(stop.error)
      return
    }
    // The automation's agent follows the first targeted console (TUI agents keep their own).
    const target = formTarget(form)
    const [firstTabId] = target ? loopTargetTabIds(target, board) : []
    const agentKind = consoles.find((c) => c.tabId === firstTabId)?.agentKind
    setBusy(true)
    try {
      // Why: created disabled, then given its loop, so no scheduler tick can see
      // it as a plain scheduled automation in between.
      const created = await window.api.automations.create({
        name: form.name.trim() || translate('board.loops.untitled', 'Board loop'),
        prompt:
          built.trigger.kind === 'goal'
            ? form.instruction.trim() || form.goal.trim()
            : form.instruction.trim(),
        agentId: agentKind && isTuiAgent(agentKind) ? agentKind : 'claude',
        projectId: getRepoIdFromWorktreeId(worktreeId),
        workspaceMode: 'existing',
        workspaceId: worktreeId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        rrule: LOOP_PLACEHOLDER_RRULE,
        dtstart: Date.now(),
        enabled: false
      })
      await window.api.automations.update({
        id: created.id,
        updates: {
          loop: {
            worktreeId,
            trigger: built.trigger,
            state: newLoopState(),
            background: form.background,
            ...stop.fields
          },
          enabled: true
        }
      })
      setDraft(null)
      after()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const togglePause = (loop: Automation): void => {
    window.api.automations
      .update({ id: loop.id, updates: { enabled: !loop.enabled } })
      .then(after)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
  }

  const remove = (loop: Automation): void => {
    window.api.automations
      .delete({ id: loop.id })
      .then(after)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
  }

  const now = Date.now()
  if (draft) {
    return (
      <BoardLoopForm
        // Why: a new template or "from scratch" replaces the whole draft; remount so
        // the form's local state starts from the new values.
        key={draft.templateId ?? 'scratch'}
        initial={draft.form}
        board={board}
        templateId={draft.templateId}
        onPickTemplate={startFromTemplate}
        busy={busy}
        onCancel={() => setDraft(null)}
        onSubmit={(form) => void create(form)}
      />
    )
  }
  return (
    <div className="flex flex-col gap-5 text-[var(--board-text)]">
      <div className="flex items-center justify-between">
        {/* The studio header already says Loops; keep this heading for screen readers only until a loop exists. */}
        <h2 className={cn('text-[15px] font-semibold', loops.length === 0 && 'sr-only')}>
          {translate('board.loops.title', 'Loops')}
        </h2>
        {loops.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={startFromScratch}
            disabled={consoleCount === 0}
          >
            <Plus />
            {translate('board.loops.new', 'New loop')}
          </Button>
        )}
      </div>
      {consoleCount === 0 && (
        <p className="text-[13px] text-[var(--board-text-muted)]">
          {translate('board.loops.needConsole', 'Add a console to the board to loop on it.')}
        </p>
      )}
      {loops.length === 0 && (
        <div className="mx-auto max-w-2xl pt-3 pb-1 text-center">
          <h3 className="text-[22px] font-bold tracking-[-0.01em]">
            {translate('board.loops.heroTitle', 'Put your agents on autopilot')}
          </h3>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--board-text-muted)]">
            {translate(
              'board.loops.empty',
              'A loop sends one instruction to your consoles at a fixed interval, whenever an agent finishes and goes idle, or the moment a console prints something you care about. Give it a goal and it retires itself the instant the job is actually done.'
            )}
          </p>
        </div>
      )}
      <BoardLoopTemplatesGrid disabled={consoleCount === 0} onPick={startFromTemplate} />
      {loops.length === 0 && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={startFromScratch}
            disabled={consoleCount === 0}
            className="h-9 rounded-full border-[var(--board-panel-border)] bg-[var(--board-panel-2)] px-5 font-semibold text-[var(--board-text)]"
          >
            {translate('board.loops.fromScratch', 'Start from scratch')}
          </Button>
        </div>
      )}
      {loops.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {loops.map((loop) => (
            <li
              key={loop.id}
              className="flex items-start gap-3 rounded-xl border border-[var(--board-panel-border)] bg-[var(--board-panel)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{loop.name}</div>
                <div className="text-[12px] text-[var(--board-text-muted)]">
                  {loop.loop ? describeNextFire(loop.loop, loop.enabled, now) : null}
                </div>
                {loop.loop?.state.lastResult && (
                  <div className="truncate text-[12px] text-[var(--board-text-muted)]">
                    {translate('board.loops.last', 'Last: {{result}}', {
                      result: loop.loop.state.lastResult
                    })}
                  </div>
                )}
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={
                  loop.enabled
                    ? translate('board.loops.pause', 'Pause loop')
                    : translate('board.loops.resume', 'Resume loop')
                }
                onClick={() => togglePause(loop)}
              >
                {loop.enabled ? <Pause /> : <Play />}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={translate('board.loops.delete', 'Delete loop')}
                onClick={() => remove(loop)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
