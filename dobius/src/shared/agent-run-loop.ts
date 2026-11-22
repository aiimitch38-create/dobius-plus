// Rules for the agent run loop: check after a run, retry at most a fixed
// number of times, never retry an outward action. Pure; main runs the check
// and starts the retry (main/agents/agent-run-loop.ts).

import type { AgentEngine, AgentRunOutcome, AgentRunSource, AgentRunStatus } from './agents'
import { IMESSAGE_SESSION_KEY } from './agents'
import type { AutomationPrecheck, AutomationPrecheckResult } from './automations-types'
import {
  MAX_AUTOMATION_PRECHECK_OUTPUT_CHARS,
  normalizeAutomationPrecheck
} from './automation-precheck'

/** Runs in a loop when nobody asks for more: the first run plus one retry. */
export const DEFAULT_LOOP_MAX_RUNS = 2
/** No caller, prompt or agent can raise this. */
export const HARD_MAX_LOOP_RUNS = 3
/** All attempts of a loop share this multiple of the first run's budget cap. */
export const LOOP_BUDGET_MULTIPLIER = 1.5
/** Below this much left, a retry could not do useful work. */
export const MIN_RETRY_BUDGET_USD = 0.25
export const MAX_POSTCHECK_COMMAND_LENGTH = 500

export type AgentRunPostcheck = AutomationPrecheck

/** Carried from one attempt to the next. Internal: only the run loop sets it. */
export type AgentRunLoopState = {
  /** 1 for the first run. */
  attempt: number
  rootRunId: string
  maxRuns: number
  budgetCeilingUsd: number
  spentUsd: number
}

export function normalizeAgentRunPostcheck(
  postcheck: { command?: unknown; timeoutSeconds?: unknown } | null | undefined
): AgentRunPostcheck | null {
  const command = typeof postcheck?.command === 'string' ? postcheck.command.trim() : ''
  if (command.length > MAX_POSTCHECK_COMMAND_LENGTH) {
    return null
  }
  return normalizeAutomationPrecheck({
    command,
    timeoutSeconds: postcheck?.timeoutSeconds as number
  })
}

export function normalizeLoopMaxRuns(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_LOOP_MAX_RUNS
  }
  return Math.min(HARD_MAX_LOOP_RUNS, Math.max(1, Math.floor(value)))
}

export function loopBudgetCeilingUsd(runBudgetUsd: number): number {
  return Number.isFinite(runBudgetUsd) && runBudgetUsd > 0 ? runBudgetUsd * LOOP_BUDGET_MULTIPLIER : 0
}

/**
 * What one finished attempt adds to the loop's spend. A run that reports no
 * cost is counted as having spent its whole cap, so the ceiling still holds.
 */
export function attemptSpendUsd(costUsd: number | undefined, attemptBudgetUsd: number): number {
  return typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd >= 0
    ? costUsd
    : Math.max(0, attemptBudgetUsd)
}

/** Budget for the next attempt: what the loop has left, never more than one run's cap. */
export function retryBudgetUsd(args: {
  budgetCeilingUsd: number
  spentUsd: number
  runBudgetUsd: number
}): number {
  const left = args.budgetCeilingUsd - args.spentUsd
  if (!Number.isFinite(left) || left <= 0) {
    return 0
  }
  return Math.min(left, args.runBudgetUsd)
}

export type LoopDecisionInput = {
  status: AgentRunStatus
  /** null = the check has not run yet. */
  checkPassed: boolean | null
  attempt: number
  maxRuns: number
  engine: AgentEngine
  source: AgentRunSource
  sessionKey?: string
  /** The run's execution origin ('imessage-command' marks an iMessage run). */
  origin?: string
  spawnedBy?: string
  usedOutwardTool: boolean
  /** The run changed package.json, tool config, node_modules, .git or similar. */
  changedTooling: boolean
  /** What retryBudgetUsd() returned for the next attempt. */
  nextBudgetUsd: number
  /** False while the crew is paused. */
  executionAdmitted: boolean
}

export type LoopDecision =
  | { step: 'none' }
  | { step: 'check' }
  | { step: 'retry' }
  | { step: 'final'; outcome: AgentRunOutcome; reason: string }

function retryRefusal(input: LoopDecisionInput): string | null {
  if (input.attempt >= Math.min(normalizeLoopMaxRuns(input.maxRuns), HARD_MAX_LOOP_RUNS)) {
    return `after ${input.attempt} attempt${input.attempt === 1 ? '' : 's'}`
  }
  if (input.engine !== 'claude') {
    return 'Codex runs are never retried'
  }
  if (input.source !== 'manual') {
    return `${input.source} runs are never retried`
  }
  if (input.sessionKey === IMESSAGE_SESSION_KEY || input.origin === 'imessage-command') {
    return 'iMessage runs are never retried'
  }
  if (input.spawnedBy !== undefined) {
    return 'voice runs are never retried'
  }
  if (!(input.nextBudgetUsd >= MIN_RETRY_BUDGET_USD)) {
    return 'the loop budget is spent'
  }
  if (!input.executionAdmitted) {
    return 'the crew is paused'
  }
  return null
}

/** The one place that decides what follows a settled attempt. */
export function decideNextStep(input: LoopDecisionInput): LoopDecision {
  if (input.status === 'cancelled' || input.status === 'running') {
    return { step: 'none' }
  }
  if (input.status === 'error') {
    // Out of turns or budget, or crashed: a retry would only spend more.
    return { step: 'final', outcome: 'blocked', reason: 'the run ended with an error' }
  }
  // Decided BEFORE the check, so the check never runs for these: it executes
  // outside the agent's sandbox, and after such a run it would execute code
  // nobody reviewed. There is also no retry.
  if (input.usedOutwardTool) {
    return {
      step: 'final',
      outcome: 'needs-review',
      reason: 'the run used a tool that may have acted outside this Mac; check not run'
    }
  }
  if (input.changedTooling) {
    return {
      step: 'final',
      outcome: 'needs-review',
      reason: 'the run changed tooling; check not run'
    }
  }
  if (input.checkPassed === null) {
    return { step: 'check' }
  }
  if (input.checkPassed) {
    return { step: 'final', outcome: 'verified', reason: 'the check passed' }
  }
  const refusal = retryRefusal(input)
  return refusal === null ? { step: 'retry' } : { step: 'final', outcome: 'blocked', reason: refusal }
}

export function postcheckOutputTail(result: AutomationPrecheckResult): string {
  const output = [result.stdout, result.stderr].filter((part) => part.trim()).join('\n')
  return output.slice(-MAX_AUTOMATION_PRECHECK_OUTPUT_CHARS)
}

export function describePostcheckFailure(result: AutomationPrecheckResult): string {
  if (result.timedOut) {
    return 'timed out'
  }
  if (result.error) {
    return `could not run (${result.error})`
  }
  return `exit ${result.exitCode ?? 'unknown'}`
}

export function buildRetryPrompt(result: AutomationPrecheckResult): string {
  const output = postcheckOutputTail(result)
  return [
    'The check that runs after your work failed.',
    `Command: ${result.command}`,
    `Result: ${describePostcheckFailure(result)}`,
    output ? `Last output:\n${output}` : 'The check printed no output.',
    'Fix the cause, then stop. Do not send, post, push, deploy or pay.'
  ].join('\n\n')
}
