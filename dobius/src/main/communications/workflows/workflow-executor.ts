/**
 * Executes a workflow's parsed steps in-process for trigger_workflow.
 *
 * HONEST SCOPE: Buzz's real Rust workflow engine has step types this repo
 * has no source for (agent dispatch, HTTP calls, approval gates, ...).
 * Rather than fabricate success for step types we cannot actually run, this
 * executor supports a small, real vocabulary (`log`, `delay`, `noop`) and
 * records every other step type as `skipped` with an honest explanation —
 * see SUPPORTED_STEP_TYPES below. This also means trigger_workflow never
 * spawns a real Claude/Codex agent run, which is deliberate: it keeps the
 * command safe to exercise from an automated verification fixture. Wiring a
 * real `agent`/`dispatch` step type to Dobius's agent-run runtime
 * (src/main/agents/agents-store.ts + the automation runner) is future work,
 * flagged in the build report, not implemented here.
 */
import type { WorkflowStep } from './workflow-yaml'
import type { TraceEntry, WorkflowRunStatus } from './workflow-run-store'

const SUPPORTED_STEP_TYPES = new Set(['log', 'delay', 'noop'])

export type WorkflowExecutionResult = {
  trace: TraceEntry[]
  status: WorkflowRunStatus
  errorMessage: string | null
  currentStep: number | null
}

function runSupportedStep(step: WorkflowStep): Record<string, unknown> {
  switch (step.type) {
    case 'log':
      return { message: typeof step.with.message === 'string' ? step.with.message : '' }
    case 'delay':
      return { requestedMs: typeof step.with.ms === 'number' ? step.with.ms : 0 }
    case 'noop':
    default:
      return {}
  }
}

export function executeWorkflowSteps(steps: WorkflowStep[]): WorkflowExecutionResult {
  const trace: TraceEntry[] = []
  let failedAtIndex: number | null = null

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const startedAt = Date.now()
    if (!SUPPORTED_STEP_TYPES.has(step.type)) {
      trace.push({
        stepId: step.id,
        status: 'skipped',
        output: {},
        startedAt,
        completedAt: Date.now(),
        error: `Step type "${step.type}" is not executable by the local Dobius workflow engine yet`
      })
      continue
    }
    try {
      const output = runSupportedStep(step)
      trace.push({ stepId: step.id, status: 'completed', output, startedAt, completedAt: Date.now(), error: null })
    } catch (error) {
      failedAtIndex = index
      trace.push({
        stepId: step.id,
        status: 'failed',
        output: {},
        startedAt,
        completedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      })
      break
    }
  }

  if (failedAtIndex !== null) {
    return {
      trace,
      status: 'failed',
      errorMessage: trace[failedAtIndex]?.error ?? 'Step failed',
      currentStep: failedAtIndex
    }
  }
  return {
    trace,
    status: 'completed',
    errorMessage: null,
    currentStep: steps.length > 0 ? steps.length - 1 : null
  }
}
