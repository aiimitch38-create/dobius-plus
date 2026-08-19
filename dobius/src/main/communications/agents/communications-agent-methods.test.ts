import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RpcDispatcher } from '../../runtime/rpc/dispatcher'
import type { RpcRequest } from '../../runtime/rpc/core'
import type { DobiusRuntimeService } from '../../runtime/dobius-runtime'

vi.mock('./agent-local-overrides-store', () => ({
  getAgentLocalOverrides: vi.fn(),
  setAgentLocalOverride: vi.fn()
}))
vi.mock('./custom-harness-store', () => ({
  saveCustomHarness: vi.fn(),
  deleteCustomHarness: vi.fn()
}))
vi.mock('./global-agent-config-store', () => ({
  getGlobalAgentConfig: vi.fn(),
  setGlobalAgentConfig: vi.fn(),
  getAgentManagedProfiles: vi.fn(),
  setAgentManagedProfiles: vi.fn()
}))
vi.mock('./observer-channel-index-store', () => ({
  indexObserverChannelIds: vi.fn(),
  readIndexedEventsForChannel: vi.fn()
}))
vi.mock('./agent-decision-approval-bridge', () => ({
  listApprovalsForRun: vi.fn(),
  grantAgentApproval: vi.fn(),
  denyAgentApproval: vi.fn()
}))
vi.mock('./observer-event-crypto', () => ({
  decryptObserverEvent: vi.fn(),
  buildObserverControlEvent: vi.fn()
}))

import { getAgentLocalOverrides, setAgentLocalOverride } from './agent-local-overrides-store'
import { deleteCustomHarness, saveCustomHarness } from './custom-harness-store'
import {
  getAgentManagedProfiles,
  getGlobalAgentConfig,
  setAgentManagedProfiles,
  setGlobalAgentConfig
} from './global-agent-config-store'
import {
  indexObserverChannelIds,
  readIndexedEventsForChannel
} from './observer-channel-index-store'
import {
  denyAgentApproval,
  grantAgentApproval,
  listApprovalsForRun
} from './agent-decision-approval-bridge'
import { buildObserverControlEvent, decryptObserverEvent } from './observer-event-crypto'
import { COMMUNICATIONS_AGENT_METHODS } from './communications-agent-methods'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function makeDispatcher(): RpcDispatcher {
  return new RpcDispatcher({ runtime, methods: COMMUNICATIONS_AGENT_METHODS })
}

describe('communications agent RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves and deletes a custom harness', async () => {
    vi.mocked(saveCustomHarness).mockReturnValue({
      id: 'goose',
      label: 'Goose',
      command: 'goose',
      args: [],
      env: {},
      installInstructionsUrl: '',
      installHint: ''
    })
    const dispatcher = makeDispatcher()
    const saveResult = await dispatcher.dispatch(
      makeRequest('agentHarness.save', {
        definition: { id: 'goose', label: 'Goose', command: 'goose' }
      })
    )
    expect(saveResult.ok).toBe(true)
    expect(saveCustomHarness).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'goose', label: 'Goose', command: 'goose' }),
      null
    )

    const deleteResult = await dispatcher.dispatch(makeRequest('agentHarness.delete', { id: 'goose' }))
    expect(deleteResult).toMatchObject({ ok: true, result: { removed: true, id: 'goose' } })
    expect(deleteCustomHarness).toHaveBeenCalledWith('goose')
  })

  it('rejects a harness definition missing a required field', async () => {
    const dispatcher = makeDispatcher()
    const result = await dispatcher.dispatch(
      makeRequest('agentHarness.save', { definition: { id: '', label: 'Goose', command: 'goose' } })
    )
    expect(result.ok).toBe(false)
  })

  it('reads and writes the global agent config with an honest zero restart count', async () => {
    vi.mocked(getGlobalAgentConfig).mockReturnValue({
      env_vars: {},
      provider: null,
      model: null,
      preferred_runtime: null
    })
    vi.mocked(setGlobalAgentConfig).mockReturnValue({
      env_vars: { FOO: 'bar' },
      provider: 'anthropic',
      model: null,
      preferred_runtime: null
    })
    const dispatcher = makeDispatcher()
    await expect(dispatcher.dispatch(makeRequest('agentConfig.get'))).resolves.toMatchObject({
      ok: true,
      result: { config: { env_vars: {}, provider: null, model: null, preferred_runtime: null } }
    })
    const setResult = await dispatcher.dispatch(
      makeRequest('agentConfig.set', { env_vars: { FOO: 'bar' }, provider: 'anthropic' })
    )
    expect(setResult).toMatchObject({
      ok: true,
      result: { restarted_count: 0, failed_restart_count: 0 }
    })
  })

  it('reads and writes the managed-profiles preference', async () => {
    vi.mocked(getAgentManagedProfiles).mockReturnValue(false)
    vi.mocked(setAgentManagedProfiles).mockReturnValue(true)
    const dispatcher = makeDispatcher()
    await expect(dispatcher.dispatch(makeRequest('agentManagedProfiles.get'))).resolves.toMatchObject({
      ok: true,
      result: { enabled: false }
    })
    await expect(
      dispatcher.dispatch(makeRequest('agentManagedProfiles.set', { enabled: true }))
    ).resolves.toMatchObject({ ok: true, result: { enabled: true } })
    expect(setAgentManagedProfiles).toHaveBeenCalledWith(true)
  })

  it('reads and writes a per-agent local override', async () => {
    vi.mocked(getAgentLocalOverrides).mockReturnValue({ active: true })
    vi.mocked(setAgentLocalOverride).mockReturnValue({ active: false })
    const dispatcher = makeDispatcher()
    await expect(
      dispatcher.dispatch(makeRequest('agentLocalOverrides.get', { agentId: 'agent-1' }))
    ).resolves.toMatchObject({ ok: true, result: { overrides: { active: true } } })
    await dispatcher.dispatch(
      makeRequest('agentLocalOverrides.set', { agentId: 'agent-1', key: 'active', value: false })
    )
    expect(setAgentLocalOverride).toHaveBeenCalledWith('agent-1', 'active', false)
  })

  it('rejects an unknown override key', async () => {
    const dispatcher = makeDispatcher()
    const result = await dispatcher.dispatch(
      makeRequest('agentLocalOverrides.set', { agentId: 'agent-1', key: 'bogus', value: true })
    )
    expect(result.ok).toBe(false)
  })

  it('writes and reads the observer channel index', async () => {
    vi.mocked(readIndexedEventsForChannel).mockReturnValue([
      { eventId: 'evt-1', channelId: 'c', createdAt: 1 }
    ])
    const dispatcher = makeDispatcher()
    const writeResult = await dispatcher.dispatch(
      makeRequest('agentObserverIndex.write', {
        entries: [{ eventId: 'evt-1', channelId: 'c', createdAt: 1 }]
      })
    )
    expect(writeResult).toMatchObject({ ok: true, result: { indexed: 1 } })
    expect(indexObserverChannelIds).toHaveBeenCalledWith([
      { eventId: 'evt-1', channelId: 'c', createdAt: 1 }
    ])

    const readResult = await dispatcher.dispatch(
      makeRequest('agentObserverIndex.readForChannel', { channelId: 'c', limit: 10 })
    )
    expect(readResult).toMatchObject({
      ok: true,
      result: { entries: [{ eventId: 'evt-1', channelId: 'c', createdAt: 1 }] }
    })
    expect(readIndexedEventsForChannel).toHaveBeenCalledWith('c', { before: undefined, limit: 10 })
  })

  it('lists, grants, and denies approvals through the decision bridge', async () => {
    vi.mocked(listApprovalsForRun).mockReturnValue([])
    vi.mocked(grantAgentApproval).mockResolvedValue({
      token: 'tok-1',
      status: 'approved',
      runId: 'run-1',
      workflowId: 'agent-1'
    })
    vi.mocked(denyAgentApproval).mockResolvedValue({
      token: 'tok-2',
      status: 'denied',
      runId: 'run-1',
      workflowId: 'agent-1'
    })
    const dispatcher = makeDispatcher()
    await expect(
      dispatcher.dispatch(makeRequest('agentApprovals.listForRun', { runId: 'run-1' }))
    ).resolves.toMatchObject({ ok: true, result: { approvals: [] } })
    await expect(
      dispatcher.dispatch(makeRequest('agentApprovals.grant', { token: 'tok-1' }))
    ).resolves.toMatchObject({ ok: true, result: { approval: { status: 'approved' } } })
    await dispatcher.dispatch(makeRequest('agentApprovals.deny', { token: 'tok-2', note: 'no' }))
    expect(denyAgentApproval).toHaveBeenCalledWith('tok-2', 'no')
  })

  it('propagates a decision-bridge failure as a dispatch error', async () => {
    vi.mocked(grantAgentApproval).mockRejectedValue(new Error('Approval not found'))
    const dispatcher = makeDispatcher()
    const result = await dispatcher.dispatch(makeRequest('agentApprovals.grant', { token: 'missing' }))
    expect(result.ok).toBe(false)
  })

  it('decrypts and builds observer events by delegating to the identity slice, never inlining crypto', async () => {
    vi.mocked(decryptObserverEvent).mockReturnValue({ type: 'cancel_turn' })
    vi.mocked(buildObserverControlEvent).mockReturnValue('{"kind":24200}')
    const dispatcher = makeDispatcher()

    await expect(
      dispatcher.dispatch(makeRequest('agentObserver.decryptEvent', { eventJson: '{"pubkey":"a"}' }))
    ).resolves.toMatchObject({ ok: true, result: { payload: { type: 'cancel_turn' } } })
    expect(decryptObserverEvent).toHaveBeenCalledWith('{"pubkey":"a"}')

    await expect(
      dispatcher.dispatch(
        makeRequest('agentObserver.buildControlEvent', { agentPubkey: 'agent-pub', payload: { type: 'cancel_turn' } })
      )
    ).resolves.toMatchObject({ ok: true, result: { eventJson: '{"kind":24200}' } })
    expect(buildObserverControlEvent).toHaveBeenCalledWith('agent-pub', { type: 'cancel_turn' })
  })

  it('propagates a not-configured identity error from the crypto layer as a dispatch error', async () => {
    vi.mocked(decryptObserverEvent).mockImplementation(() => {
      throw new Error('Communications participant identity is not configured')
    })
    const dispatcher = makeDispatcher()
    const result = await dispatcher.dispatch(
      makeRequest('agentObserver.decryptEvent', { eventJson: '{"pubkey":"a"}' })
    )
    expect(result.ok).toBe(false)
  })
})
