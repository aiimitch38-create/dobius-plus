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
import {
  getStoredAgentRun,
  pinStoredAgentRun,
  unpinStoredAgentRun,
  updateStoredAgentRun
} from './agent-runs-store'
import { isRunSessionKeyBusy } from './agent-session-lease'
import { getAgent, getAgentSessionForKey } from './agents-store'
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

type RunLoopStartArgs = { prompt: string; cwd?: string; options?: RunLoopOptions }

type HeldEnd =
  | { kind: 'result'; message: SDKResultMessage }
  | { kind: 'ended'; status: 'error' | 'cancelled'; summary: string }

// Second enforcement of the run ceiling, independent of the `loop` option a
// caller could hand in: runs actually started per loop, keyed by its first run.
const loopRunCounts = new Map<string, number>()

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Called by the runner once it knows which session the run will resume. A
 * loop retry that would resume anything else (or nothing) must not start.
 */
export function assertLoopResume(loop: AgentRunLoopState | undefined, resume: string | undefined): void {
  if (loop?.requiredSessionId && resume !== loop.requiredSessionId) {
    throw new Error('the conversation of the failed attempt is no longer available')
  }
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

  // A check can outlast the history's grace period for ended runs; the record
  // must still be there to take the check result and the outcome.
  pinStoredAgentRun(runId)
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
    const sessionKey = options.sessionKey ?? 'default'
    const sessionId = held?.kind === 'result' ? held.message.session_id : undefined
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
      changedTooling: tools.changedTooling(),
      nextBudgetUsd,
      executionAdmitted: true
    }
    const before = decideNextStep(facts)
    if (before.step === 'final') {
      finish(before.outcome, outwardTool ? `${before.reason} (${outwardTool})` : before.reason, loopCostUsd)
      return false
    }
    if (before.step !== 'check') {
      return false
    }

    // Why loaded here: the check runner pulls in the SSH stack, which a run
    // with no check never needs.
    const { runSandboxedPostcheck } = await import('./agent-run-postcheck-sandbox')
    const sandboxed = await runSandboxedPostcheck({ postcheck, cwd: args.cwd })
    if (!sandboxed.ok) {
      // Never run the check unsandboxed instead.
      finish('needs-review', `${sandboxed.reason}; check not run`, loopCostUsd)
      return false
    }
    const result: AutomationPrecheckResult = sandboxed.result
    if (sandboxed.processesLeft) {
      // Something the check started is still running in the folder: no retry
      // on top of it, and its result is not trusted.
      record({ postcheck: result })
      finish('blocked', 'the check left processes running', loopCostUsd)
      return false
    }
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
      finish(decision.outcome, decision.reason, loopCostUsd)
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
    // The retry must continue the conversation this attempt just left. The
    // session lease was released before the check, so another run may have
    // taken the key or replaced its session since; restart() claims the key
    // synchronously, so nothing can change between this look and that claim.
    const currentAgent = getAgent(agent.id)
    const storedSessionId = currentAgent
      ? getAgentSessionForKey(currentAgent, sessionKey)?.sessionId
      : undefined
    if (
      !sessionId ||
      storedSessionId !== sessionId ||
      isRunSessionKeyBusy(agent.id, sessionKey)
    ) {
      note(`postcheck: failed ${describePostcheckFailure(result)}`)
      finish('blocked', 'another run has since used this conversation', loopCostUsd)
      return false
    }
    note(
      `postcheck: failed ${describePostcheckFailure(result)}, retry ${loop.attempt} of ${Math.min(loop.maxRuns, HARD_MAX_LOOP_RUNS) - 1}`
    )
    try {
      await args.restart({
        ...args.startArgs,
        prompt: buildRetryPrompt(result),
        // The folder this attempt really ran in, even if the agent's own
        // folder setting changed meanwhile.
        cwd: args.cwd,
        options: {
          ...options,
          // Same thread in the journal for every attempt.
          context: options.context ?? { correlationId: loop.rootRunId },
          // The retry continues the session the failed attempt just left.
          resume: true,
          maxBudgetUsd: nextBudgetUsd,
          loop: { ...loop, attempt: loop.attempt + 1, spentUsd, requiredSessionId: sessionId }
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
    unpinStoredAgentRun(runId)
    if (!handedOff) {
      loopRunCounts.delete(loop.rootRunId)
      flushToCaller()
    }
  }

  let settled = false
  return {
    noFreshSessionFallback: loop.requiredSessionId !== undefined,
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
