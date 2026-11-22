// `dobius automations create --loop` / `edit` on a goal loop: the CLI names a
// goal, a run cap, an optional stop command and an optional card; main turns
// that into the same AutomationLoop the Board's Loops studio saves. Callers can
// never hand main a raw loop object: only these fields, validated here.
import { z } from 'zod'
import type { Automation, AutomationLoop, AutomationLoopTarget } from '../../../../shared/automations-types'
import {
  LOOP_MAX_RUNS_LIMIT,
  LOOP_PLACEHOLDER_RRULE,
  newLoopState,
  normalizeAutomationLoop
} from '../../../../shared/automation-loops'
import { stopCommandProblem } from '../../../../shared/automation-loop-stop'
import { CliActionError } from '../../../../shared/cli-action-errors'
import type { DobiusRuntimeService, RuntimeAutomationCreateInput } from '../../dobius-runtime'
import { resolveSavedCard, savedCards } from './board-cards'

export const LOOP_GOAL_MAX_CHARS = 2000
/** How often a goal loop looks for the console's DOBIUS_GOAL answer (same default as the Loops studio). */
export const LOOP_CHECK_EVERY_MS = 120_000

export const LoopCreateFields = z.object({
  goal: z.string().trim().min(1, 'Missing loop goal').max(LOOP_GOAL_MAX_CHARS, 'loop goal is too long'),
  // Why any positive integer here: the cap is refused with its own error code below.
  maxIterations: z.number().int('max iterations must be a whole number').positive('max iterations must be at least 1'),
  stopWhen: z.string().trim().min(1).max(500).optional(),
  card: z.string().trim().min(1).max(200).optional()
})

export const LoopUpdateFields = z.object({
  goal: LoopCreateFields.shape.goal.optional(),
  maxIterations: LoopCreateFields.shape.maxIterations.optional(),
  // null clears the stop command.
  stopWhen: z.union([z.string().trim().max(500), z.null()]).optional(),
  card: LoopCreateFields.shape.card
})

type LoopCreate = z.output<typeof LoopCreateFields>
type LoopUpdate = z.output<typeof LoopUpdateFields>

function checkCap(maxIterations: number): number {
  // Why refused, not clamped: every iteration is a paid agent run; a caller
  // asking for more than the cap must hear no, not get a quiet 50.
  if (maxIterations > LOOP_MAX_RUNS_LIMIT) {
    throw new CliActionError(
      'loop_iteration_cap',
      `--max-iterations is at most ${LOOP_MAX_RUNS_LIMIT} (each iteration is a paid agent run); got ${maxIterations}.`
    )
  }
  return maxIterations
}

function checkStopCommand(command: string): string {
  const problem = stopCommandProblem(command)
  if (problem) {
    throw new CliActionError(
      'loop_invalid',
      problem === 'too_long'
        ? '--stop-when is longer than 200 characters.'
        : problem === 'shell'
          ? '--stop-when must be one plain command: no quotes, wildcards, ~, pipes, ; & > or $.'
          : problem === 'empty'
            ? '--stop-when is empty.'
            : '--stop-when could change or delete files. Use a check such as a build or test command.'
    )
  }
  return command
}

/** The loop target a card name points at; no card means every console on the Board. */
function loopTarget(runtime: DobiusRuntimeService, worktreeId: string, card: string | undefined): AutomationLoopTarget {
  if (!card) {
    return { type: 'board' }
  }
  const found = resolveSavedCard(savedCards(runtime, worktreeId), card)
  if (found.kind === 'console' && typeof found.raw.tabId === 'string') {
    return { type: 'tab', tabId: found.raw.tabId }
  }
  if (found.kind === 'orchestrator') {
    return { type: 'orchestrator', cardId: found.id }
  }
  throw new CliActionError(
    'loop_invalid',
    `"${found.title}" is a ${found.kind} card; a loop targets a console or an orchestrator card.`
  )
}

function validLoop(loop: AutomationLoop): AutomationLoop {
  if (!normalizeAutomationLoop(loop)) {
    throw new CliActionError('loop_invalid', 'The loop settings are not valid.')
  }
  return loop
}

/**
 * Creates a goal loop the way the Loops studio does: saved disabled with the
 * placeholder schedule first, then given its loop and enabled, so no scheduler
 * tick ever sees it as a plain scheduled automation. A failed second step
 * removes the half-made automation so nothing is left behind.
 */
export async function createLoopAutomation(
  runtime: DobiusRuntimeService,
  input: RuntimeAutomationCreateInput,
  fields: LoopCreate
): Promise<Automation> {
  if (!input.workspace || input.repo || input.workspaceMode === 'new_per_run') {
    throw new CliActionError(
      'loop_invalid',
      "A loop runs on one workspace's Board. Pass --workspace (or run it inside that workspace), not --repo."
    )
  }
  const maxRuns = checkCap(fields.maxIterations)
  const stopCommand = fields.stopWhen ? checkStopCommand(fields.stopWhen) : undefined
  const worktree = await runtime.showManagedWorktree(input.workspace)
  const loop = validLoop({
    worktreeId: worktree.id,
    trigger: {
      kind: 'goal',
      target: loopTarget(runtime, worktree.id, fields.card),
      goal: fields.goal,
      checkEveryMs: LOOP_CHECK_EVERY_MS,
      maxRuns,
      judge: 'self'
    },
    state: newLoopState(),
    ...(stopCommand ? { stopCommand } : {})
  })
  const created = await runtime.createAutomation({
    ...input,
    workspace: `id:${worktree.id}`,
    workspaceMode: 'existing',
    reuseSession: false,
    precheck: null,
    rrule: LOOP_PLACEHOLDER_RRULE,
    dtstart: Date.now(),
    enabled: false
  })
  try {
    return await runtime.updateAutomation(created.id, { loop, enabled: input.enabled ?? true })
  } catch (error) {
    runtime.deleteAutomation(created.id)
    throw error
  }
}

/** The edited goal loop for `automations edit <id> --goal/--max-iterations/--stop-when/--card`. */
export function editedLoop(runtime: DobiusRuntimeService, current: Automation, fields: LoopUpdate): AutomationLoop {
  const loop = normalizeAutomationLoop(current.loop)
  if (!loop || loop.trigger.kind !== 'goal') {
    throw new CliActionError(
      'loop_not_found',
      'This automation is not a goal loop. Create one with `dobius automations create --loop`.'
    )
  }
  const trigger = {
    ...loop.trigger,
    ...(fields.goal !== undefined ? { goal: fields.goal } : {}),
    ...(fields.maxIterations !== undefined ? { maxRuns: checkCap(fields.maxIterations) } : {}),
    ...(fields.card !== undefined ? { target: loopTarget(runtime, loop.worktreeId, fields.card) } : {})
  }
  const { stopCommand: previous, ...rest } = loop
  const stopCommand =
    fields.stopWhen === undefined
      ? previous
      : fields.stopWhen === null || fields.stopWhen === ''
        ? undefined
        : checkStopCommand(fields.stopWhen)
  return validLoop({ ...rest, trigger, ...(stopCommand ? { stopCommand } : {}) })
}
