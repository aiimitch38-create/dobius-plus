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
  getDraft: vi.fn(),
  listDrafts: vi.fn()
}))
vi.mock('../../../agents/agent-draft-approval', () => ({
  approveDraftAndPost: vi.fn()
}))
vi.mock('../../../agents/agent-briefing-store', () => ({
  dismissBriefingItems: vi.fn(),
  listRecentBriefingItems: vi.fn()
}))
vi.mock('./crew-confirm', () => ({ appConfirmationGate: vi.fn() }))
vi.mock('../../../agents/agent-runner', () => ({
  listAgentRuns: vi.fn(),
  stopAgentRun: vi.fn()
}))

import { getAgentsExecutionState, setAgentsPaused } from '../../../agents/agents-config-store'
import { listAgentDecisions, resolveAgentDecision } from '../../../agents/agent-decision-queue'
import { discardDraft, getDraft, listDrafts } from '../../../agents/agent-draft-store'
import { approveDraftAndPost } from '../../../agents/agent-draft-approval'
import { dismissBriefingItems, listRecentBriefingItems } from '../../../agents/agent-briefing-store'
import { listAgentRuns, stopAgentRun } from '../../../agents/agent-runner'
import { buildCrewMethods, CREW_METHODS } from './crew'
import { createConfirmationGate } from './confirm-gate'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService

const confirm =
  vi.fn<
    (
      request: { title: string; message: string; detail: string },
      signal: AbortSignal
    ) => Promise<boolean>
  >()
const methods = buildCrewMethods(createConfirmationGate(confirm, { cooldownMs: 0 }))

function call(method: string, params?: unknown) {
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method, params }
  return new RpcDispatcher({ runtime, methods }).dispatch(request)
}

const PAUSED = { paused: true, status: 'ok', detail: null, filePath: '/f' }
const PENDING_DRAFT = {
  id: 'dr1',
  agentId: 'a1',
  status: 'pending',
  body: 'Shipped the fix.',
  target: { kind: 'asana', gid: '42' }
}

describe('crew RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirm.mockResolvedValue(true)
    vi.mocked(setAgentsPaused).mockImplementation((paused) => paused)
    vi.mocked(getDraft).mockReturnValue(PENDING_DRAFT as never)
    vi.mocked(listAgentDecisions).mockReturnValue([
      { id: 'd1', agentId: 'a1', toolName: 'Bash', input: { command: 'ls' } }
    ] as never)
    vi.mocked(getAgentsExecutionState).mockReturnValue(PAUSED as never)
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
    vi.mocked(listAgentDecisions).mockReturnValue([
      { id: 'd1', agentId: 'a1', toolName: 'Bash', input: {} }
    ] as never)
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

  it('refuses to discard a draft that is no longer pending', async () => {
    vi.mocked(getDraft).mockReturnValue({ id: 'dr1', status: 'approved' } as never)
    await expect(call('crew.draftDiscard', { id: 'dr1' })).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Only pending drafts') }
    })
    expect(discardDraft).not.toHaveBeenCalled()
  })

  it('surfaces an Asana posting failure on approve', async () => {
    vi.mocked(approveDraftAndPost).mockRejectedValueOnce(new Error('Asana not connected'))
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
    vi.mocked(listAgentRuns).mockReturnValue([{ id: 'r2', status: 'success' }] as never)
    await expect(call('crew.stop', { runId: 'r2' })).resolves.toMatchObject({
      result: { runId: 'r2', wasRunning: false }
    })
    expect(stopAgentRun).not.toHaveBeenCalled()

    await expect(call('crew.stop', { runId: 'nope' })).resolves.toMatchObject({ ok: false })
    expect(stopAgentRun).not.toHaveBeenCalled()
  })

  it('interrupts a run once when two stops arrive together', async () => {
    vi.mocked(listAgentRuns).mockReturnValue([{ id: 'r1', status: 'running' }] as never)
    let release: () => void = () => {}
    vi.mocked(stopAgentRun).mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    const first = call('crew.stop', { runId: 'r1' })
    await vi.waitFor(() => expect(stopAgentRun).toHaveBeenCalledTimes(1))
    await expect(call('crew.stop', { runId: 'r1' })).resolves.toMatchObject({
      result: { wasRunning: true }
    })
    release()
    await expect(first).resolves.toMatchObject({ ok: true })
    expect(stopAgentRun).toHaveBeenCalledTimes(1)
  })

  describe('in-app confirmation', () => {
    it.each([
      ['resume', 'crew.setPaused', { paused: false }, setAgentsPaused],
      ['draft approve', 'crew.draftApprove', { id: 'dr1' }, approveDraftAndPost],
      ['decide', 'crew.decide', { id: 'd1', choice: 'approve' }, resolveAgentDecision]
    ] as const)(
      '%s is refused when the dialog is declined',
      async (_label, method, params, action) => {
        confirm.mockResolvedValue(false)
        await expect(call(method, params)).resolves.toMatchObject({
          ok: false,
          error: { message: expect.stringContaining('Not confirmed') }
        })
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(action).not.toHaveBeenCalled()
      }
    )

    it.each([
      ['resume', 'crew.setPaused', { paused: false }, setAgentsPaused],
      ['draft approve', 'crew.draftApprove', { id: 'dr1' }, approveDraftAndPost],
      ['decide', 'crew.decide', { id: 'd1', choice: 'approve' }, resolveAgentDecision]
    ] as const)(
      '%s proceeds when the dialog is accepted',
      async (_label, method, params, action) => {
        vi.mocked(approveDraftAndPost).mockResolvedValue(PENDING_DRAFT as never)
        vi.mocked(resolveAgentDecision).mockResolvedValue({ ok: true })
        await expect(call(method, params)).resolves.toMatchObject({ ok: true })
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(action).toHaveBeenCalledTimes(1)
      }
    )

    it('shows the destination and text of a draft, and the decision and choice', async () => {
      vi.mocked(approveDraftAndPost).mockResolvedValue(PENDING_DRAFT as never)
      await call('crew.draftApprove', { id: 'dr1' })
      expect(confirm.mock.calls[0][0]).toMatchObject({
        message: expect.stringContaining('Asana task 42'),
        detail: expect.stringContaining('Shipped the fix.')
      })
      vi.mocked(resolveAgentDecision).mockResolvedValue({ ok: true })
      await call('crew.decide', { id: 'd1', choice: 'respond', note: 'use staging' })
      expect(confirm.mock.calls[1][0]).toMatchObject({
        message: expect.stringContaining('respond'),
        detail: expect.stringMatching(/Tool: Bash[\s\S]*"command":"ls"[\s\S]*use staging/)
      })
    })

    it('does not ask to pause, or to resume a crew that is already running', async () => {
      vi.mocked(setAgentsPaused).mockReturnValue(true)
      await call('crew.setPaused', { paused: true })
      vi.mocked(getAgentsExecutionState).mockReturnValue({ ...PAUSED, paused: false } as never)
      await expect(call('crew.setPaused', { paused: false })).resolves.toMatchObject({
        result: { paused: false }
      })
      expect(confirm).not.toHaveBeenCalled()
      expect(setAgentsPaused).toHaveBeenCalledTimes(1)
    })

    it('does not open a dialog for an unknown decision or a non-pending draft', async () => {
      await expect(call('crew.decide', { id: 'gone', choice: 'deny' })).resolves.toMatchObject({
        ok: false
      })
      vi.mocked(getDraft).mockReturnValue({ ...PENDING_DRAFT, status: 'approved' } as never)
      await expect(call('crew.draftApprove', { id: 'dr1' })).resolves.toMatchObject({ ok: false })
      expect(confirm).not.toHaveBeenCalled()
    })

    it('does not act if the caller gave up while the dialog was open', async () => {
      const controller = new AbortController()
      confirm.mockImplementationOnce(async () => {
        controller.abort()
        return true
      })
      const request: RpcRequest = {
        id: 'req-1',
        authToken: 'tok',
        method: 'crew.draftApprove',
        params: { id: 'dr1' }
      }
      await expect(
        new RpcDispatcher({ runtime, methods }).dispatch(request, { signal: controller.signal })
      ).resolves.toMatchObject({ ok: false })
      expect(approveDraftAndPost).not.toHaveBeenCalled()
    })

    it.each([
      ['a long draft', 'crew.draftApprove', { id: 'dr1' }],
      ['a long tool input', 'crew.decide', { id: 'd1', choice: 'approve' }]
    ] as const)('refuses %s instead of showing it clipped', async (_label, method, params) => {
      const long = 'x'.repeat(5000)
      vi.mocked(getDraft).mockReturnValue({ ...PENDING_DRAFT, body: long } as never)
      vi.mocked(listAgentDecisions).mockReturnValue([
        { id: 'd1', agentId: 'a1', toolName: 'Bash', input: { command: long } }
      ] as never)
      await expect(call(method, params)).resolves.toMatchObject({
        ok: false,
        error: { message: expect.stringContaining('too long to confirm here') }
      })
      expect(confirm).not.toHaveBeenCalled()
    })

    it('refuses a second confirmation while one is open', async () => {
      let answer: (value: boolean) => void = () => {}
      confirm.mockReturnValueOnce(new Promise<boolean>((resolve) => (answer = resolve)))
      vi.mocked(approveDraftAndPost).mockResolvedValue(PENDING_DRAFT as never)
      const first = call('crew.draftApprove', { id: 'dr1' })
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
      await expect(call('crew.setPaused', { paused: false })).resolves.toMatchObject({
        ok: false,
        error: { message: expect.stringContaining('already open') }
      })
      answer(true)
      await expect(first).resolves.toMatchObject({ ok: true })
      expect(confirm).toHaveBeenCalledTimes(1)
    })
  })

  it('has no yield method', () => {
    expect(CREW_METHODS.map((method) => method.name)).not.toContain('crew.yield')
  })
})
