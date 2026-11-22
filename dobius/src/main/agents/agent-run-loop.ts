// What happens after an agent run ends: run the caller's check, and retry once
// if it fails. Plugs into the runner only through the run-end callbacks, and
// starts a retry through the `restart` it is handed (never by importing the
// runner), so a retry passes the pause switch, slot limit, budget cap, hard
// rails and sandbox like any other run.
// Design: plans/research/AGENT-RUNNER-LOOPS.md.

import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentRun,
  AgentRunContext,
  AgentRunOutcome,
  AgentRunSource,
  CustomAgent
} from '../../shared/agents'
import {
  attemptSpendUsd,
  buildRetryPrompt,
  decideNextStep,
  DEFAULT_LOOP_MAX_RUNS,
  describePostcheckFailure,
  HARD_MAX_LOOP_RUNS,
  loopBudgetCeilingUsd,
  normalizeAgentRunPostcheck,
  retryBudgetUsd,
  type AgentRunLoopState,
  type AgentRunPostcheck,
  type LoopDecisionInput
} from '../../shared/agent-run-loop'
import { createLocalToolTracker } from '../../shared/agent-run-local-tools'
import { didAutomationPrecheckPass } from '../../shared/automation-precheck'
import type { AutomationPrecheckResult } from '../../shared/automations-types'
import {
  broadcastRunEvent,
  broadcastRunsChanged,
  eventBase,
  subscribeToAgentRunEvents
} from './agent-run-events'
import {
  guardRunEndCallbacks,
  type GuardedRunEndCallbacks,
  type RunEndCallbacks
} from './agent-run-end-callbacks'
import { buildPostcheckEnv } from './agent-run-postcheck-env'
import { getStoredAgentRun, updateStoredAgentRun } from './agent-runs-store'
import { checkExecutionAdmission } from './execution-gate'

/** The run options the loop reads or rewrites for a retry. */
export type RunLoopOptions = RunEndCallbacks & {
  /** A command the app runs itself once the run settles; exit 0 means the work passed. */
  postcheck?: AgentRunPostcheck
  /** Reserved for the grader (design task 5). Not acted on yet. */
  grade?: boolean
  /** Internal: set only by the loop when it starts a retry. */
  loop?: AgentRunLoopState
  source?: AgentRunSource
  sessionKey?: string
  maxBudgetUsd?: number
  resume?: boolean
  context?: AgentRunContext
  origin?: string
  spawnedBy?: string
}

type RunLoopStartArgs = { prompt: string; options?: RunLoopOptions }

type HeldEnd =
  | { kind: 'result'; message: SDKResultMessage }
  | { kind: 'ended'; status: 'error' | 'cancelled'; summary: string }

// Second enforcement of the run ceiling, independent of the `loop` option a
// caller could hand in: runs actually started per loop, keyed by its first run.
const loopRunCounts = new Map<string, number>()

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function attachRunLoop<A extends RunLoopStartArgs>(args: {
  runId: string
  agent: CustomAgent
  cwd: string
  startArgs: A
  restart: (startArgs: A) => Promise<string>
  /** This run's budget cap. Absent (Codex) = no budget, so never a retry. */
  runBudgetUsd?: number
}): GuardedRunEndCallbacks {
  const options: RunLoopOptions | undefined = args.startArgs.options
  const postcheck = normalizeAgentRunPostcheck(options?.postcheck)
  if (!options || !postcheck) {
    // No check asked for: the run behaves exactly as it did before the loop existed.
    return guardRunEndCallbacks(options)
  }
  const { runId, agent } = args
  const runBudgetUsd = args.runBudgetUsd ?? 0
  const loop: AgentRunLoopState = options.loop ?? {
    attempt: 1,
    rootRunId: runId,
    maxRuns: DEFAULT_LOOP_MAX_RUNS,
    budgetCeilingUsd: loopBudgetCeilingUsd(runBudgetUsd),
    spentUsd: 0
  }
  loopRunCounts.set(loop.rootRunId, (loopRunCounts.get(loop.rootRunId) ?? 0) + 1)

  // Why: bookkeeping must never break the run it describes.
  const record = (updates: Partial<AgentRun>): void => {
    try {
      if (updateStoredAgentRun(runId, updates)) {
        broadcastRunsChanged()
      }
    } catch (error) {
      console.error('[agents] could not record the run loop state:', errorText(error))
    }
  }
  const note = (detail: string): void => {
    try {
      broadcastRunEvent({ ...eventBase(runId, agent.id), kind: 'system', detail })
    } catch (error) {
      console.error('[agents] could not log the run loop event:', errorText(error))
    }
  }

  record({ attempt: loop.attempt, rootRunId: loop.rootRunId })

  let outwardTool: string | null = null
  const tools = createLocalToolTracker()
  const stopListening = subscribeToAgentRunEvents((event) => {
    if (
      event.runId === runId &&
      event.kind === 'tool-use' &&
      !tools.isLocal(event.toolName, event.detail)
    ) {
      outwardTool ??= event.toolName || 'an unnamed tool'
    }
  })

  // The caller hears nothing until the loop is finished, then gets the last
  // attempt's end exactly once: it must not post two answers or start its next
  // turn in the middle of a retry.
  let held: HeldEnd | undefined
  const flushToCaller = (): void => {
    const caller = guardRunEndCallbacks(options)
    if (held?.kind === 'result') {
      caller.onResult(held.message)
    } else if (held) {
      caller.onRunEnded(held.status, held.summary)
    }
    caller.onSettled()
  }

  const finish = (outcome: AgentRunOutcome, reason: string, loopCostUsd: number): void => {
    record({ outcome, loopCostUsd })
    note(`loop: ${outcome === 'needs-review' ? 'needs review' : outcome}, ${reason}`)
  }

  /** Returns true when a retry took over, so this attempt must stay silent. */
  const runLoopStep = async (): Promise<boolean> => {
    const run = getStoredAgentRun(runId)
    const spentUsd = loop.spentUsd + attemptSpendUsd(run?.costUsd, runBudgetUsd)
    const loopCostUsd = loop.spentUsd + (run?.costUsd ?? 0)
    const nextBudgetUsd = retryBudgetUsd({
      budgetCeilingUsd: loop.budgetCeilingUsd,
      spentUsd,
      runBudgetUsd
    })
    const facts: LoopDecisionInput = {
      status: run?.status ?? 'error',
      checkPassed: null,
      attempt: loop.attempt,
      maxRuns: loop.maxRuns,
      engine: agent.engine ?? 'claude',
      source: options.source ?? 'manual',
      sessionKey: options.sessionKey,
      origin: options.origin,
      spawnedBy: options.spawnedBy,
      usedOutwardTool: outwardTool !== null,
      nextBudgetUsd,
      executionAdmitted: true
    }
    const before = decideNextStep(facts)
    if (before.step === 'final') {
      finish(before.outcome, before.reason, loopCostUsd)
      return false
    }
    if (before.step !== 'check') {
      return false
    }

    // Why loaded here: the check runner pulls in the SSH stack, which a run
    // with no check never needs.
    const { runAutomationPrecheck } = await import('../automations/precheck-runner')
    const result: AutomationPrecheckResult = await runAutomationPrecheck({
      precheck: postcheck,
      target: { type: 'local', cwd: args.cwd, env: buildPostcheckEnv(process.env) }
    })
    record({ postcheck: result })
    const passed = didAutomationPrecheckPass(result)
    // 'agents-page' runs skip the pause switch, so the loop asks for itself.
    const decision = decideNextStep({
      ...facts,
      checkPassed: passed,
      executionAdmitted: checkExecutionAdmission('agent-run').allowed
    })
    if (passed) {
      note('postcheck: passed')
    }
    if (decision.step === 'final') {
      if (!passed) {
        note(`postcheck: failed ${describePostcheckFailure(result)}`)
      }
      const reason =
        decision.outcome === 'needs-review' && outwardTool
          ? `${decision.reason} (${outwardTool})`
          : decision.reason
      finish(decision.outcome, reason, loopCostUsd)
      return false
    }
    if (decision.step !== 'retry') {
      return false
    }
    if ((loopRunCounts.get(loop.rootRunId) ?? 0) >= HARD_MAX_LOOP_RUNS) {
      note(`postcheck: failed ${describePostcheckFailure(result)}`)
      finish('blocked', `after ${HARD_MAX_LOOP_RUNS} runs`, loopCostUsd)
      return false
    }
    note(
      `postcheck: failed ${describePostcheckFailure(result)}, retry ${loop.attempt} of ${Math.min(loop.maxRuns, HARD_MAX_LOOP_RUNS) - 1}`
    )
    try {
      await args.restart({
        ...args.startArgs,
        prompt: buildRetryPrompt(result),
        options: {
          ...options,
          // Same thread in the journal for every attempt.
          context: options.context ?? { correlationId: loop.rootRunId },
          // The retry continues the session the failed attempt just left.
          resume: true,
          maxBudgetUsd: nextBudgetUsd,
          loop: { ...loop, attempt: loop.attempt + 1, spentUsd }
        }
      })
      return true
    } catch (error) {
      // A refused start (crew paused, no free slot) is never tried again.
      finish('blocked', `the retry could not start (${errorText(error)})`, loopCostUsd)
      return false
    }
  }

  const afterSettle = async (): Promise<void> => {
    let handedOff = false
    try {
      handedOff = await runLoopStep()
    } catch (error) {
      console.error('[agents] run loop failed:', errorText(error))
      note(`loop: stopped, ${errorText(error)}`)
    }
    // Why: a caller holding a slot until the run ends must always hear back,
    // whatever went wrong above.
    if (!handedOff) {
      loopRunCounts.delete(loop.rootRunId)
      flushToCaller()
    }
  }

  let settled = false
  return {
    onResult: (message) => {
      held ??= { kind: 'result', message }
    },
    onRunEnded: (status, summary) => {
      held ??= { kind: 'ended', status, summary }
    },
    onSettled: () => {
      if (settled) {
        return
      }
      settled = true
      stopListening()
      void afterSettle()
    }
  }
}
