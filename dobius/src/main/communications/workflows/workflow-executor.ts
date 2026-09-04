/**
 * Executes a workflow's parsed steps in-process for trigger_workflow.
 *
 * HONEST SCOPE: Buzz's real Rust workflow engine has step types this repo
 * has no source for (HTTP calls, approval gates, ...). Rather than fabricate
 * success for step types we cannot actually run, this executor supports a
 * real vocabulary (`log`, `delay`, `noop`, `agent_dispatch`) and records
 * every other step type as `skipped` with an honest explanation — see
 * SUPPORTED_STEP_TYPES below. `agent_dispatch` reuses the same
 * startAgentRun() call the `agent.run` RPC method uses for Communications
 * channel-agent dispatch (src/main/runtime/rpc/methods/custom-agents.ts) —
 * it starts the run and records the runId, it does not block the workflow on
 * the run finishing. Wiring `call_webhook`/`request_approval` (the other two
 * real Buzz action types, see workflow-yaml.ts) to a real implementation is
 * future work, flagged in the build report, not implemented here.
 */
import type { WorkflowStep } from './workflow-yaml'
import type { TraceEntry, WorkflowRunStatus } from './workflow-run-store'

const SUPPORTED_STEP_TYPES = new Set(['log', 'delay', 'noop', 'agent_dispatch'])

export type WorkflowExecutionResult = {
  trace: TraceEntry[]
  status: WorkflowRunStatus
  errorMessage: string | null
  currentStep: number | null
}

async function runAgentDispatchStep(
  step: WorkflowStep,
  sessionKey: string
): Promise<Record<string, unknown>> {
  const agentId = typeof step.with.agent_id === 'string' ? step.with.agent_id : ''
  const prompt = typeof step.with.prompt === 'string' ? step.with.prompt : ''
  if (!agentId) {
    throw new Error('agent_dispatch step is missing a string "agent_id"')
  }
  if (!prompt) {
    throw new Error('agent_dispatch step is missing a string "prompt"')
  }
  // Lazy import: agent-runner.ts pulls in the Claude Agent SDK, which most
  // workflow runs (log/delay/noop only) never need to load — mirrors the
  // same lazy-import pattern in agent-channel-service.ts.
  const [{ startAgentRun }, { getDefaultPrepareClaudeLaunch }] = await Promise.all([
    import('../../agents/agent-runner'),
    import('../../agents/default-claude-launch')
  ])
  const prepareClaudeLaunch = getDefaultPrepareClaudeLaunch()
  if (!prepareClaudeLaunch) {
    throw new Error('Agent runs require the Dobius+ app to be running')
  }
  // Channel-sourced dispatch: headless, so undecided tool prompts must not
  // hang the workflow — mirrors agent.run's 'channel' source (custom-agents.ts).
  // resume: false + a non-'default' sessionKey are both required: without
  // them this run resumes (and its own session lineage would get resumed by)
  // whatever else shares the 'default' key, i.e. a human's manual run in the
  // agent panel. See agents-store.ts's "a channel task must never hijack the
  // session a manual run would resume" and agent-channel-service.ts's
  // identical guard on its channel-source dispatch.
  const runId = await startAgentRun({
    agentId,
    prompt,
    prepareClaudeLaunch,
    options: { source: 'channel', permissionMode: 'dontAsk', resume: false, sessionKey }
  })
  return { runId }
}

async function runSupportedStep(step: WorkflowStep, sessionKey: string): Promise<Record<string, unknown>> {
  switch (step.type) {
    case 'log':
      return { message: typeof step.with.message === 'string' ? step.with.message : '' }
    case 'delay':
      return { requestedMs: typeof step.with.ms === 'number' ? step.with.ms : 0 }
    case 'agent_dispatch':
      return runAgentDispatchStep(step, sessionKey)
    case 'noop':
    default:
      return {}
  }
}

export async function executeWorkflowSteps(
  steps: WorkflowStep[],
  sessionKey: string
): Promise<WorkflowExecutionResult> {
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
      const output = await runSupportedStep(step, sessionKey)
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
