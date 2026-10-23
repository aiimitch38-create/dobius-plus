import { useMemo, useState } from 'react'
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
import { BoardLoopForm } from './BoardLoopForm'
import { BoardLoopTemplatesGrid } from './BoardLoopTemplatesGrid'
import { loopFormFromTemplate } from './loop-form-template'
import {
  BOARD_TARGET_KEY,
  DEFAULT_LOOP_FORM,
  buildLoopTrigger,
  describeNextFire,
  loopStopFields,
  loopTargetTabIds,
  parseTargetKey,
  type LoopFormValues
} from './loop-form'

export function BoardLoopsPanel({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const { loops, refresh } = useBoardLoops(worktreeId)
  const board = useAppStore((s) => getBoard(s, worktreeId))
  const [creating, setCreating] = useState<LoopFormValues | null>(null)
  const [busy, setBusy] = useState(false)
  const consoleCount = board.cards.filter((c) => c.kind === 'console').length
  const targets = useMemo(
    () => [
      {
        key: BOARD_TARGET_KEY,
        label: translate('board.loops.target.board', 'Every console (and new ones)'),
        agentKind: null
      },
      ...board.cards.flatMap((c) =>
        c.kind === 'console'
          ? [{ key: `tab:${c.tabId}`, label: c.title, agentKind: c.agentKind }]
          : []
      ),
      ...board.groups.map((g) => ({ key: `group:${g.id}`, label: `@${g.name}`, agentKind: null })),
      ...board.cards.flatMap((c) =>
        c.kind === 'orchestrator'
          ? [
              {
                key: `orchestrator:${c.id}`,
                label: translate('board.loops.target.orchestrator', 'Wired to {{name}}', {
                  name: c.name
                }),
                agentKind: null
              }
            ]
          : []
      )
    ],
    [board]
  )

  const consoleCountFor = (key: string): number => {
    const target = parseTargetKey(key)
    return target ? loopTargetTabIds(target, board).length : 0
  }

  const firstConsoleKey =
    targets.find((t) => t.key.startsWith('tab:'))?.key ?? targets[0]?.key ?? ''
  const startFromScratch = (): void =>
    setCreating({ ...DEFAULT_LOOP_FORM, targetKey: targets[0]?.key ?? '' })

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
    const agentKind = targets.find((t) => t.key === form.targetKey)?.agentKind
    setBusy(true)
    try {
      // Why: created disabled, then given its loop, so no scheduler tick can see
      // it as a plain scheduled automation in between.
      const created = await window.api.automations.create({
        name: form.name.trim() || translate('board.loops.untitled', 'Board loop'),
        prompt:
          form.kind === 'goal'
            ? (form.judge === 'agent' && form.instruction.trim()) || form.goal.trim()
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
      setCreating(null)
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
  return (
    <div className="flex flex-col gap-3 text-[var(--board-text)]">
      <div className="flex items-center justify-between">
        {/* The studio header already says Loops; keep this heading for screen readers only until a loop exists. */}
        <h2 className={cn('text-[15px] font-semibold', loops.length === 0 && 'sr-only')}>
          {translate('board.loops.title', 'Loops')}
        </h2>
        {!creating && loops.length > 0 && (
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
      {creating && (
        <BoardLoopForm
          initial={creating}
          targets={targets}
          consoleCountFor={consoleCountFor}
          busy={busy}
          onCancel={() => setCreating(null)}
          onSubmit={(form) => void create(form)}
        />
      )}
      {!creating && loops.length === 0 && (
        <div className="mx-auto max-w-2xl pt-3 pb-2 text-center">
          <h3 className="text-[20px] font-bold tracking-[-0.01em]">
            {translate('board.loops.heroTitle', 'Keep your agents working on their own')}
          </h3>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--board-text-muted)]">
            {translate(
              'board.loops.empty',
              'A loop sends one instruction to your consoles on a schedule, when an agent finishes and goes idle, or when a console prints something you care about. Give it a goal or a time limit and it stops by itself.'
            )}
          </p>
        </div>
      )}
      {!creating && (
        <BoardLoopTemplatesGrid
          disabled={consoleCount === 0}
          onPick={(template) => setCreating(loopFormFromTemplate(template, firstConsoleKey))}
        />
      )}
      {!creating && loops.length === 0 && (
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
