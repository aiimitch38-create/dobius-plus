import { translate } from '@/i18n/i18n'
import type { BoardState } from '@/store/slices/board'
import {
  BOARD_TARGET_KEY,
  DEFAULT_LOOP_FORM,
  buildLoopTrigger,
  loopStopFields,
  type LoopFormValues,
  type LoopStopFields
} from '../board-loops/loop-form'
import type { AutomationLoopTrigger } from '../../../../../shared/automations-types'
import type { ResolvedTarget } from './plan-target'

// Turns a planner "loop" step into the same form the Loops studio saves, so a
// loop made by voice gets exactly the studio's validation and stop-command
// safety rules.

export type PlannedLoop = {
  form: LoopFormValues
  trigger: AutomationLoopTrigger
  stop: LoopStopFields
  /** Agent kind of a single targeted console, for the automation's agent. */
  agentKind: string | null
  /** Plain words for the confirmation dialog. */
  targetLabel: string
}

/** Loop target key for a resolved planner target, or an error for targets a loop cannot address. */
export function loopTargetKey(
  target: ResolvedTarget | null,
  board: Pick<BoardState, 'cards' | 'groups'>
): { ok: true; key: string; label: string; agentKind: string | null } | { ok: false } {
  if (target === null || (target.kind === 'consoles' && target.via === 'all')) {
    return {
      ok: true,
      key: BOARD_TARGET_KEY,
      label: translate('board.plan.loop.everyConsole', 'every console'),
      agentKind: null
    }
  }
  if (target.kind === 'group') {
    const group = board.groups.find((g) => g.name.toLowerCase() === target.name.toLowerCase())
    return group
      ? { ok: true, key: `group:${group.id}`, label: `@${group.name}`, agentKind: null }
      : { ok: false }
  }
  if (target.names.length !== 1) {
    return { ok: false }
  }
  const name = target.names[0].toLowerCase()
  const card = board.cards.find((c) => c.kind === 'console' && c.title.toLowerCase() === name)
  return card && card.kind === 'console'
    ? { ok: true, key: `tab:${card.tabId}`, label: card.title, agentKind: card.agentKind }
    : { ok: false }
}

export function planLoop(
  input: {
    text: string
    intervalMinutes: number
    target: ResolvedTarget | null
    stopCommand: string | null
  },
  board: Pick<BoardState, 'cards' | 'groups'>
): { ok: true; loop: PlannedLoop } | { ok: false; error: string } {
  const target = loopTargetKey(input.target, board)
  if (!target.ok) {
    return {
      ok: false,
      error: translate(
        'board.plan.loop.badTarget',
        'A loop runs on one console, one group, or every console. Name one of those.'
      )
    }
  }
  const form: LoopFormValues = {
    ...DEFAULT_LOOP_FORM,
    name: input.text.slice(0, 60),
    instruction: input.text,
    kind: 'schedule',
    targetKey: target.key,
    everyMin: input.intervalMinutes,
    stopCommand: input.stopCommand ?? ''
  }
  const built = buildLoopTrigger(form)
  if (!built.ok) {
    return { ok: false, error: built.error }
  }
  const stop = loopStopFields(form)
  if (!stop.ok) {
    return { ok: false, error: stop.error }
  }
  return {
    ok: true,
    loop: {
      form,
      trigger: built.trigger,
      stop: stop.fields,
      agentKind: target.agentKind,
      targetLabel: target.label
    }
  }
}

/** The confirmation text for a planned loop: when, who, what, and how it stops. */
export function plannedLoopSummary(loop: PlannedLoop): string {
  const lines = [
    translate('board.plan.loop.summary', 'Every {{minutes}} min, tell {{target}}: “{{text}}”', {
      minutes: loop.form.everyMin,
      target: loop.targetLabel,
      text: loop.form.instruction.slice(0, 160)
    })
  ]
  lines.push(
    loop.stop.stopCommand
      ? translate('board.plan.loop.stopsWhen', 'Stops once `{{command}}` succeeds.', {
          command: loop.stop.stopCommand
        })
      : translate('board.plan.loop.noStop', 'Runs until you pause or delete it in Loops.')
  )
  return lines.join('\n')
}
