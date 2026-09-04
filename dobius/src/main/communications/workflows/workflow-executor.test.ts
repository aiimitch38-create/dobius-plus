import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../agents/agent-runner', () => ({
  startAgentRun: vi.fn()
}))
vi.mock('../../agents/default-claude-launch', () => ({
  getDefaultPrepareClaudeLaunch: vi.fn()
}))

import { executeWorkflowSteps } from './workflow-executor'
import type { WorkflowStep } from './workflow-yaml'
import { startAgentRun } from '../../agents/agent-runner'
import { getDefaultPrepareClaudeLaunch } from '../../agents/default-claude-launch'

function step(overrides: Partial<WorkflowStep>): WorkflowStep {
  return { id: 'step-1', type: 'noop', with: {}, ...overrides }
}

describe('executeWorkflowSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes with an empty trace for zero steps', async () => {
    const result = await executeWorkflowSteps([], 'session-1')
    expect(result).toEqual({ trace: [], status: 'completed', errorMessage: null, currentStep: null })
  })

  it('runs supported step types and records real output', async () => {
    const result = await executeWorkflowSteps(
      [
        step({ id: 'a', type: 'log', with: { message: 'hi' } }),
        step({ id: 'b', type: 'delay', with: { ms: 50 } }),
        step({ id: 'c', type: 'noop' })
      ],
      'session-1'
    )
    expect(result.status).toBe('completed')
    expect(result.errorMessage).toBeNull()
    expect(result.currentStep).toBe(2)
    expect(result.trace).toHaveLength(3)
    expect(result.trace[0]).toMatchObject({ stepId: 'a', status: 'completed', output: { message: 'hi' }, error: null })
    expect(result.trace[1]).toMatchObject({ stepId: 'b', status: 'completed', output: { requestedMs: 50 }, error: null })
    expect(result.trace[2]).toMatchObject({ stepId: 'c', status: 'completed', output: {}, error: null })
    for (const entry of result.trace) {
      expect(entry.startedAt).toBeTypeOf('number')
      expect(entry.completedAt).toBeTypeOf('number')
      expect(entry.completedAt).toBeGreaterThanOrEqual(entry.startedAt as number)
    }
  })

  it('marks an unsupported step type as skipped with an honest reason, and keeps running', async () => {
    const result = await executeWorkflowSteps(
      [step({ id: 'a', type: 'call_webhook' }), step({ id: 'b', type: 'log', with: { message: 'still runs' } })],
      'session-1'
    )
    expect(result.status).toBe('completed')
    expect(result.trace[0]).toMatchObject({ stepId: 'a', status: 'skipped' })
    expect(result.trace[0].error).toMatch(/not executable/)
    expect(result.trace[1]).toMatchObject({ stepId: 'b', status: 'completed' })
  })

  it('stops at the first failing step and reports failed status', async () => {
    // agent_dispatch with no configured prepareClaudeLaunch (no running Dobius+
    // app) is a real, supported step type that genuinely throws — unlike
    // delay's non-numeric-ms fallback to 0, this exercises a real failure path.
    vi.mocked(getDefaultPrepareClaudeLaunch).mockReturnValue(null)
    const result = await executeWorkflowSteps(
      [
        step({ id: 'a', type: 'agent_dispatch', with: { agent_id: 'agent-1', prompt: 'hi' } }),
        step({ id: 'b', type: 'log', with: { message: 'never runs' } })
      ],
      'session-1'
    )
    expect(result.status).toBe('failed')
    expect(result.currentStep).toBe(0)
    expect(result.trace).toHaveLength(1)
    expect(result.trace[0]).toMatchObject({ stepId: 'a', status: 'failed' })
    expect(result.errorMessage).toMatch(/Dobius\+ app to be running/)
  })

  it('dispatches a real agent run for agent_dispatch and records the runId', async () => {
    const prepareClaudeLaunch = vi.fn()
    vi.mocked(getDefaultPrepareClaudeLaunch).mockReturnValue(prepareClaudeLaunch)
    vi.mocked(startAgentRun).mockResolvedValue('run-123')

    const result = await executeWorkflowSteps(
      [step({ id: 'a', type: 'agent_dispatch', with: { agent_id: 'agent-1', prompt: 'do the thing' } })],
      'channel-42'
    )

    expect(result.status).toBe('completed')
    expect(result.trace[0]).toMatchObject({ stepId: 'a', status: 'completed', output: { runId: 'run-123' }, error: null })
    expect(startAgentRun).toHaveBeenCalledWith({
      agentId: 'agent-1',
      prompt: 'do the thing',
      prepareClaudeLaunch,
      options: { source: 'channel', permissionMode: 'dontAsk', resume: false, sessionKey: 'channel-42' }
    })
  })

  it('fails an agent_dispatch step missing agent_id or prompt', async () => {
    const result = await executeWorkflowSteps([step({ id: 'a', type: 'agent_dispatch', with: {} })], 'session-1')
    expect(result.status).toBe('failed')
    expect(result.errorMessage).toMatch(/agent_id/)
    expect(startAgentRun).not.toHaveBeenCalled()
  })
})
