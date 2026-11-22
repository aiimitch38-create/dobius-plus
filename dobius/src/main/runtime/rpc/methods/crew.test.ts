import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

// Why: these stores import electron (and the runner the Claude SDK) at module
// scope, so each is mocked before the methods module loads it.
vi.mock('../../../agents/agents-config-store', () => ({
  getAgentsExecutionState: vi.fn(),
  setAgentsPaused: vi.fn()
}))
vi.mock('../../../agents/agent-decision-queue', () => ({
  listAgentDecisions: vi.fn(),
  resolveAgentDecision: vi.fn()
}))
vi.mock('../../../agents/agent-draft-store', () => ({
  discardDraft: vi.fn(),
  listDrafts: vi.fn()
}))
vi.mock('../../../agents/agent-draft-approval', () => ({
  approveDraftAndPost: vi.fn()
}))
vi.mock('../../../agents/agent-briefing-store', () => ({
  dismissBriefingItems: vi.fn(),
  listRecentBriefingItems: vi.fn()
}))
vi.mock('../../../agents/agent-runner', () => ({
  listAgentRuns: vi.fn(),
  stopAgentRun: vi.fn()
}))

import { getAgentsExecutionState, setAgentsPaused } from '../../../agents/agents-config-store'
import { listAgentDecisions, resolveAgentDecision } from '../../../agents/agent-decision-queue'
import { discardDraft, listDrafts } from '../../../agents/agent-draft-store'
import { approveDraftAndPost } from '../../../agents/agent-draft-approval'
import {
  dismissBriefingItems,
  listRecentBriefingItems
} from '../../../agents/agent-briefing-store'
import { listAgentRuns, stopAgentRun } from '../../../agents/agent-runner'
import { CREW_METHODS } from './crew'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService

function call(method: string, params?: unknown) {
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method, params }
  return new RpcDispatcher({ runtime, methods: CREW_METHODS }).dispatch(request)
}

describe('crew RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports and sets Pause crew through the config store', async () => {
    const state = { paused: true, status: 'ok', detail: null, filePath: '/x/agents-config.json' }
    vi.mocked(getAgentsExecutionState).mockReturnValue(state as never)
    vi.mocked(setAgentsPaused).mockReturnValue(false)

    await expect(call('crew.state')).resolves.toMatchObject({ ok: true, result: state })
    await expect(call('crew.setPaused', { paused: false })).resolves.toMatchObject({
      ok: true,
      result: { paused: false }
    })
    expect(setAgentsPaused).toHaveBeenCalledWith(false)
  })

  it('refuses a non-boolean pause value', async () => {
    await expect(call('crew.setPaused', { paused: 'yes' })).resolves.toMatchObject({ ok: false })
    expect(setAgentsPaused).not.toHaveBeenCalled()
  })

  it('passes a resume refusal from the store back to the caller', async () => {
    vi.mocked(setAgentsPaused).mockImplementation(() => {
      throw new Error('Crew control file could not be read')
    })
    await expect(call('crew.setPaused', { paused: false })).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('could not be read') }
    })
  })

  it('lists decisions and resolves approve / deny / respond', async () => {
    vi.mocked(listAgentDecisions).mockReturnValue([{ id: 'd1' }] as never)
    vi.mocked(resolveAgentDecision).mockResolvedValue({ ok: true })

    await expect(call('crew.decisions')).resolves.toMatchObject({
      ok: true,
      result: { decisions: [{ id: 'd1' }] }
    })
    await call('crew.decide', { id: 'd1', choice: 'approve' })
    expect(resolveAgentDecision).toHaveBeenLastCalledWith({ id: 'd1', action: 'approve' })
    await call('crew.decide', { id: 'd1', choice: 'deny' })
    expect(resolveAgentDecision).toHaveBeenLastCalledWith({ id: 'd1', action: 'deny' })
    await expect(
      call('crew.decide', { id: 'd1', choice: 'respond', note: 'Use the staging DB' })
    ).resolves.toMatchObject({ ok: true, result: { id: 'd1', choice: 'respond', ok: true } })
    expect(resolveAgentDecision).toHaveBeenLastCalledWith({
      id: 'd1',
      action: 'respond',
      payload: { text: 'Use the staging DB' }
    })
  })

  it.each([
    ['always-allow', { id: 'd1', choice: 'alwaysAllow' }],
    ['bypass run', { id: 'd1', choice: 'bypassRun' }],
    ['respond without a note', { id: 'd1', choice: 'respond' }],
    ['a note on approve', { id: 'd1', choice: 'approve', note: 'x' }],
    ['a missing id', { choice: 'approve' }]
  ])('refuses %s', async (_label, params) => {
    await expect(call('crew.decide', params)).resolves.toMatchObject({ ok: false })
    expect(resolveAgentDecision).not.toHaveBeenCalled()
  })

  it('lists, approves and discards drafts through the shared functions', async () => {
    const draft = { id: 'dr1', status: 'pending' }
    vi.mocked(listDrafts).mockReturnValue([draft] as never)
    vi.mocked(approveDraftAndPost).mockResolvedValue({ ...draft, status: 'approved' } as never)
    vi.mocked(discardDraft).mockReturnValue({ ...draft, status: 'discarded' } as never)

    await expect(call('crew.drafts')).resolves.toMatchObject({ result: { drafts: [draft] } })
    await expect(call('crew.draftApprove', { id: 'dr1' })).resolves.toMatchObject({
      result: { draft: { status: 'approved' } }
    })
    expect(approveDraftAndPost).toHaveBeenCalledWith('dr1')
    await expect(call('crew.draftDiscard', { id: 'dr1' })).resolves.toMatchObject({
      result: { draft: { status: 'discarded' } }
    })
    expect(discardDraft).toHaveBeenCalledWith('dr1')
  })

  it('surfaces an Asana posting failure on approve', async () => {
    vi.mocked(approveDraftAndPost).mockRejectedValue(new Error('Asana not connected'))
    await expect(call('crew.draftApprove', { id: 'dr1' })).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Asana not connected') }
    })
  })

  it('lists and dismisses the briefing', async () => {
    vi.mocked(listRecentBriefingItems).mockReturnValue([{ id: 'b1' }] as never)
    await expect(call('crew.briefing')).resolves.toMatchObject({
      result: { items: [{ id: 'b1' }] }
    })
    await expect(call('crew.briefingDismiss')).resolves.toMatchObject({
      result: { dismissed: true }
    })
    expect(dismissBriefingItems).toHaveBeenCalledTimes(1)
  })

  it('stops a known run and refuses an unknown one', async () => {
    vi.mocked(listAgentRuns).mockReturnValue([{ id: 'r1', status: 'running' }] as never)
    await expect(call('crew.stop', { runId: 'r1' })).resolves.toMatchObject({
      result: { runId: 'r1', wasRunning: true }
    })
    expect(stopAgentRun).toHaveBeenCalledWith('r1')

    vi.mocked(stopAgentRun).mockClear()
    await expect(call('crew.stop', { runId: 'nope' })).resolves.toMatchObject({ ok: false })
    expect(stopAgentRun).not.toHaveBeenCalled()
  })

  it('has no yield method', () => {
    expect(CREW_METHODS.map((method) => method.name)).not.toContain('crew.yield')
  })
})
