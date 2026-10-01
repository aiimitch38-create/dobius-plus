import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appendAgentNotification: vi.fn(),
  getStoredAgentRun: vi.fn(),
  emitDobiusActionEvent: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('./agent-notification-store', () => ({
  appendAgentNotification: mocks.appendAgentNotification
}))
vi.mock('./agent-runs-store', () => ({
  getStoredAgentRun: mocks.getStoredAgentRun
}))
vi.mock('./dobius-action-events', () => ({
  emitDobiusActionEvent: mocks.emitDobiusActionEvent,
  newActionContext: () => ({ correlationId: 'fresh' })
}))

import {
  createAgentCanUseTool,
  denyPendingDecisionsForRun,
  listAgentDecisions,
  resolveAgentDecision
} from './agent-decision-queue'

function askPermission(runId = 'run-1') {
  const canUseTool = createAgentCanUseTool({
    runId,
    agentId: 'agent-1',
    cwd: '/repo',
    bypassRunSupported: false
  })
  const controller = new AbortController()
  const result = canUseTool('Bash', { command: 'ls' }, {
    signal: controller.signal,
    suggestions: []
  } as never)
  return { result, controller }
}

describe('agent decision queue → ADAM ledger (B3)', () => {
  beforeEach(() => {
    mocks.appendAgentNotification.mockReset()
    mocks.getStoredAgentRun.mockReset()
    mocks.emitDobiusActionEvent.mockReset()
    denyPendingDecisionsForRun('run-1', 'test reset')
    mocks.emitDobiusActionEvent.mockReset()
  })

  it('emits exactly one agent.decision.resolved on the run context when the user approves', async () => {
    mocks.getStoredAgentRun.mockReturnValue({
      id: 'run-1',
      context: { correlationId: 'corr-run-1', adamJobId: 'job-1' }
    })
    const { result } = askPermission()
    expect(mocks.emitDobiusActionEvent).not.toHaveBeenCalled()
    const [decision] = listAgentDecisions()

    await resolveAgentDecision({ id: decision.id, action: 'approve' })
    await expect(result).resolves.toMatchObject({ behavior: 'allow' })

    expect(mocks.emitDobiusActionEvent).toHaveBeenCalledTimes(1)
    expect(mocks.emitDobiusActionEvent).toHaveBeenCalledWith({
      type: 'agent.decision.resolved',
      actor: 'user',
      runId: 'run-1',
      context: { correlationId: 'corr-run-1', adamJobId: 'job-1' },
      payload: {
        decisionId: decision.id,
        agentId: 'agent-1',
        toolName: 'Bash',
        behavior: 'allow'
      }
    })
  })

  it('attributes a run-stop denial to dobius with a fresh correlation id', async () => {
    mocks.getStoredAgentRun.mockReturnValue(null)
    const { result } = askPermission()

    denyPendingDecisionsForRun('run-1', 'Run cancelled')
    await expect(result).resolves.toMatchObject({ behavior: 'deny' })

    expect(mocks.emitDobiusActionEvent).toHaveBeenCalledTimes(1)
    expect(mocks.emitDobiusActionEvent.mock.calls[0][0]).toMatchObject({
      actor: 'dobius',
      runId: 'run-1',
      context: { correlationId: 'fresh' },
      payload: { behavior: 'deny', message: 'Run cancelled' }
    })
  })

  it('emits nothing for a run with no pending decision', () => {
    denyPendingDecisionsForRun('run-none', 'nothing here')
    expect(mocks.emitDobiusActionEvent).not.toHaveBeenCalled()
  })
})
