import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../agents/agent-decision-queue', () => ({
  listAgentDecisions: vi.fn(),
  resolveAgentDecision: vi.fn()
}))

import { listAgentDecisions, resolveAgentDecision } from '../../agents/agent-decision-queue'
import {
  denyAgentApproval,
  grantAgentApproval,
  listApprovalsForRun
} from './agent-decision-approval-bridge'

const pendingDecision = {
  id: 'decision-1',
  runId: 'run-1',
  agentId: 'agent-1',
  toolName: 'Bash',
  input: { command: 'ls' },
  description: 'run ls',
  cwd: '/tmp',
  createdAt: 1_000
}

describe('agent decision approval bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('projects pending decisions for a run into approval shape', () => {
    vi.mocked(listAgentDecisions).mockReturnValue([
      pendingDecision,
      { ...pendingDecision, id: 'decision-2', runId: 'run-2' }
    ] as never)
    const approvals = listApprovalsForRun('run-1')
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({
      token: 'decision-1',
      workflowId: 'agent-1',
      runId: 'run-1',
      stepId: 'Bash',
      status: 'pending',
      note: 'run ls'
    })
  })

  it('grants an approval by resolving it as approve', async () => {
    vi.mocked(listAgentDecisions).mockReturnValue([pendingDecision] as never)
    vi.mocked(resolveAgentDecision).mockResolvedValue({ ok: true } as never)
    const result = await grantAgentApproval('decision-1')
    expect(resolveAgentDecision).toHaveBeenCalledWith({ id: 'decision-1', action: 'approve' })
    expect(result).toEqual({
      token: 'decision-1',
      status: 'approved',
      runId: 'run-1',
      workflowId: 'agent-1'
    })
  })

  it('denies with a note using the respond action', async () => {
    vi.mocked(listAgentDecisions).mockReturnValue([pendingDecision] as never)
    vi.mocked(resolveAgentDecision).mockResolvedValue({ ok: true } as never)
    await denyAgentApproval('decision-1', 'not now')
    expect(resolveAgentDecision).toHaveBeenCalledWith({
      id: 'decision-1',
      action: 'respond',
      payload: { text: 'not now' }
    })
  })

  it('denies without a note using the plain deny action', async () => {
    vi.mocked(listAgentDecisions).mockReturnValue([pendingDecision] as never)
    vi.mocked(resolveAgentDecision).mockResolvedValue({ ok: true } as never)
    await denyAgentApproval('decision-1')
    expect(resolveAgentDecision).toHaveBeenCalledWith({ id: 'decision-1', action: 'deny' })
  })

  it('throws when the token does not match a pending decision', async () => {
    vi.mocked(listAgentDecisions).mockReturnValue([])
    await expect(grantAgentApproval('missing')).rejects.toThrow('Approval not found')
    expect(resolveAgentDecision).not.toHaveBeenCalled()
  })
})
