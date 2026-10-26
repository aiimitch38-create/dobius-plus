import { translate } from '@/i18n/i18n'
import type { AutomationLoop } from '../../../../../shared/automations-types'
import {
  LOOP_STOP_RUNS_LIMIT,
  stopCommandProblem
} from '../../../../../shared/automation-loop-stop'
import type { LoopFormValues } from './loop-form'

// The STOP box of the loop form: time limit, run cap, goal card, stop command.

/** Time-limit stop for the saved loop, or undefined for "no limit". */
export function loopStopAfterMs(form: Pick<LoopFormValues, 'stopAfterMin'>): number | undefined {
  const minutes = Math.round(form.stopAfterMin)
  return Number.isFinite(minutes) && minutes > 0 ? Math.max(1, minutes) * 60_000 : undefined
}

export type LoopStopFields = Pick<
  AutomationLoop,
  'stopAfterMs' | 'stopAfterRuns' | 'stopCommand' | 'stopGoalCardId'
>

type StopForm = Pick<LoopFormValues, 'kind' | 'stopAfterMin' | 'stopAfterRuns' | 'stopCommand'> &
  Partial<Pick<LoopFormValues, 'stopGoalOn' | 'stopGoalMode' | 'stopGoalCardId'>>

/** Every stop rule for the saved loop; an error when the stop command is unsafe to run unattended. */
export function loopStopFields(
  form: StopForm
): { ok: true; fields: LoopStopFields } | { ok: false; error: string } {
  const stopAfterMs = loopStopAfterMs(form)
  const runs = Math.round(form.stopAfterRuns)
  const goalOn = form.stopGoalOn === true
  const mode = form.stopGoalMode ?? 'card'
  // Goal loops (including schedule + judged goal) carry their own max runs on the trigger.
  const judged = form.kind === 'goal' || (form.kind === 'schedule' && goalOn && mode === 'judge')
  const stopAfterRuns =
    !judged && Number.isFinite(runs) && runs > 0 ? Math.min(LOOP_STOP_RUNS_LIMIT, runs) : undefined
  // Why: with the goal toggle on, only its chosen mode's field is saved, so
  // switching modes never keeps a leftover command or card from the other one.
  const goalCardId = goalOn && mode === 'card' ? (form.stopGoalCardId ?? '').trim() : ''
  const command = goalOn && mode !== 'command' ? '' : form.stopCommand.trim()
  if (goalOn && mode === 'card' && !goalCardId) {
    return {
      ok: false,
      error: translate('board.loops.error.goalCard', 'Pick the goal card that ends this loop.')
    }
  }
  if (goalOn && mode === 'command' && !command) {
    return {
      ok: false,
      error: translate(
        'board.loops.error.stopCommandEmpty',
        'Enter the command that ends this loop.'
      )
    }
  }
  const problem = command ? stopCommandProblem(command) : null
  if (problem) {
    return {
      ok: false,
      error:
        problem === 'too_long'
          ? translate('board.loops.error.stopLong', 'Stop command is longer than 200 characters.')
          : problem === 'shell'
            ? translate(
                'board.loops.error.stopShellPlain',
                'Use one plain command — no quotes, wildcards, ~, pipes, ; & > or $'
              )
            : translate(
                'board.loops.error.stopDestructive',
                'That stop command could change or delete files. Use a check such as a build or test command.'
              )
    }
  }
  return {
    ok: true,
    fields: {
      ...(stopAfterMs ? { stopAfterMs } : {}),
      ...(stopAfterRuns ? { stopAfterRuns } : {}),
      ...(command ? { stopCommand: command } : {}),
      ...(goalCardId ? { stopGoalCardId: goalCardId } : {})
    }
  }
}
