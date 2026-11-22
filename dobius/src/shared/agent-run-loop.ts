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

// The design's list (plans/research/AGENT-RUNNER-LOOPS.md, Risks). `Agent` is
// the current name of `Task`.
const KNOWN_LOCAL_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'TodoWrite',
  'NotebookEdit',
  'Task',
  'Agent',
  'mcp__dobius__read_knowledge',
  'mcp__dobius__list_crew',
  'mcp__dobius__crew_status'
])

// A command word only counts where a command can start (after `;`, `|`, `$(`,
// a quote, or wrappers like `sudo` and `FOO=bar`), so `cat ~/.ssh/config` and
// `grep ssh notes.md` do not match `ssh`.
const COMMAND_START = String.raw`(?:^|[\n;&|(){}\`'"])\s*(?:(?:sudo|nohup|time|exec|command|xargs|env)\s+(?:-\S+\s+)*)*(?:\w+=\S*\s+)*`
const CURL_WRITE_FLAGS = String.raw`(?:-[A-Za-z]*[XdFT]|--(?:request|data|json|form|upload-file|post-data|post-file|method|body-data|body-file))`

const OUTWARD_BASH_PATTERNS: readonly RegExp[] = [
  /\bgit\s+(?:-[-\w]+(?:[= ]\S+)?\s+)*(?:push|send-email)\b/,
  new RegExp(`${COMMAND_START}gh\\s+(?:pr|release|issue|api|repo|workflow|run|gist|secret|variable)\\b`),
  new RegExp(`${COMMAND_START}(?:npm|pnpm|yarn|bun|cargo|twine|gem)\\b[^\\n;&|]*\\b(?:publish|upload|push)\\b`),
  new RegExp(
    `${COMMAND_START}(?:vercel|netlify|stripe|osascript|ssh|scp|sftp|rsync|heroku|wrangler|flyctl|fly|kubectl|helm|terraform|aws|gcloud|az|doctl|supabase|railway|sendmail|mail|mailx|telnet|nc|ncat)(?:\\s|$)`
  ),
  new RegExp(`${COMMAND_START}firebase\\b[^\\n;&|]*\\bdeploy\\b`),
  new RegExp(`${COMMAND_START}docker\\b[^\\n;&|]*\\b(?:push|login)\\b`),
  new RegExp(`${COMMAND_START}(?:curl|wget|http|https|xh)\\b[^\\n;&|]*\\s${CURL_WRITE_FLAGS}`),
  new RegExp(`${COMMAND_START}(?:http|https|xh)\\s+(?:POST|PUT|PATCH|DELETE)\\b`, 'i'),
  new RegExp(`${COMMAND_START}dobius\\b[^\\n;&|]*\\b(?:send|run|dispatch|create|post)\\b`)
]

export function isOutwardBashCommand(command: string): boolean {
  return OUTWARD_BASH_PATTERNS.some((pattern) => pattern.test(command))
}

// A `tool_progress` tick reuses the tool-use event with only an elapsed time
// ("12s"); the tool's real input was already judged on its own event.
const PROGRESS_TICK = /^\d+s$/

function bashCommandFromDetail(detail: string | undefined): string | null {
  if (!detail) {
    return null
  }
  try {
    const input: unknown = JSON.parse(detail)
    if (typeof input === 'object' && input !== null && 'command' in input) {
      const command = (input as { command: unknown }).command
      return typeof command === 'string' && command.trim() ? command : null
    }
    return null
  } catch {
    // Not the JSON a Bash call carries: the command cannot be read.
    return null
  }
}

/**
 * True only for a tool call known to stay on this Mac. Fails closed: an unknown
 * tool, or a Bash call whose command cannot be read, counts as outward.
 * `detail` is the tool-use event's detail (the tool input as JSON).
 */
export function isLocalOnlyToolUse(toolName: string | undefined, detail?: string): boolean {
  if (!toolName) {
    return false
  }
  if (toolName === 'Bash') {
    if (detail !== undefined && PROGRESS_TICK.test(detail)) {
      return true
    }
    const command = bashCommandFromDetail(detail)
    return command !== null && !isOutwardBashCommand(command)
  }
  return KNOWN_LOCAL_TOOLS.has(toolName)
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
  if (input.checkPassed === null) {
    return { step: 'check' }
  }
  if (input.checkPassed) {
    return { step: 'final', outcome: 'verified', reason: 'the check passed' }
  }
  if (input.usedOutwardTool) {
    return {
      step: 'final',
      outcome: 'needs-review',
      reason: 'the run used a tool that may have acted outside this Mac'
    }
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
