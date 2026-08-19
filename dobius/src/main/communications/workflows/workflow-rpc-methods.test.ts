import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RpcDispatcher } from '../../runtime/rpc/dispatcher'
import type { RpcRequest } from '../../runtime/rpc/core'
import type { DobiusRuntimeService } from '../../runtime/dobius-runtime'

vi.mock('./workflow-service', () => ({
  getChannelWorkflows: vi.fn(),
  getChannelsWorkflows: vi.fn(),
  getWorkflowOrThrow: vi.fn(),
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  triggerWorkflow: vi.fn(),
  getWorkflowRuns: vi.fn()
}))

import {
  createWorkflow,
  deleteWorkflow,
  getChannelWorkflows,
  getChannelsWorkflows,
  getWorkflowOrThrow,
  getWorkflowRuns,
  triggerWorkflow,
  updateWorkflow
} from './workflow-service'
import { WORKFLOW_METHODS } from './workflow-rpc-methods'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function makeDispatcher(): RpcDispatcher {
  return new RpcDispatcher({ runtime, methods: WORKFLOW_METHODS })
}

describe('workflow RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists workflows by channel and by channels', async () => {
    const workflow = { id: 'wf-1' }
    vi.mocked(getChannelWorkflows).mockReturnValue([workflow] as never)
    vi.mocked(getChannelsWorkflows).mockReturnValue([workflow] as never)
    const dispatcher = makeDispatcher()

    await expect(
      dispatcher.dispatch(makeRequest('workflow.listByChannel', { channelId: 'chan-1' }))
    ).resolves.toMatchObject({ ok: true, result: { workflows: [workflow] } })
    expect(getChannelWorkflows).toHaveBeenCalledWith('chan-1')

    await expect(
      dispatcher.dispatch(makeRequest('workflow.listByChannels', { channelIds: ['chan-1', 'chan-2'] }))
    ).resolves.toMatchObject({ ok: true, result: { workflows: [workflow] } })
    expect(getChannelsWorkflows).toHaveBeenCalledWith(['chan-1', 'chan-2'])
  })

  it('rejects listByChannels with an empty array', async () => {
    await expect(
      makeDispatcher().dispatch(makeRequest('workflow.listByChannels', { channelIds: [] }))
    ).resolves.toMatchObject({ ok: false })
  })

  it('shows a workflow', async () => {
    const workflow = { id: 'wf-1' }
    vi.mocked(getWorkflowOrThrow).mockReturnValue(workflow as never)
    await expect(
      makeDispatcher().dispatch(makeRequest('workflow.show', { workflowId: 'wf-1' }))
    ).resolves.toMatchObject({ ok: true, result: { workflow } })
  })

  it('propagates a not-found error from show as an RPC failure', async () => {
    vi.mocked(getWorkflowOrThrow).mockImplementation(() => {
      throw new Error('Workflow not found: ghost')
    })
    await expect(
      makeDispatcher().dispatch(makeRequest('workflow.show', { workflowId: 'ghost' }))
    ).resolves.toMatchObject({ ok: false })
  })

  it('creates a workflow, normalizing a blank channelId to null', async () => {
    const created = { id: 'wf-1' }
    vi.mocked(createWorkflow).mockReturnValue(created as never)
    await expect(
      makeDispatcher().dispatch(
        makeRequest('workflow.create', { ownerPubkey: 'owner', channelId: '  ', yamlDefinition: 'name: X' })
      )
    ).resolves.toMatchObject({ ok: true, result: { workflow: created } })
    expect(createWorkflow).toHaveBeenCalledWith({ ownerPubkey: 'owner', channelId: null, yamlDefinition: 'name: X' })
  })

  it('rejects create without an owner or definition', async () => {
    await expect(
      makeDispatcher().dispatch(makeRequest('workflow.create', { channelId: 'chan-1', yamlDefinition: 'name: X' }))
    ).resolves.toMatchObject({ ok: false })
    await expect(
      makeDispatcher().dispatch(makeRequest('workflow.create', { ownerPubkey: 'owner', channelId: 'chan-1' }))
    ).resolves.toMatchObject({ ok: false })
    expect(createWorkflow).not.toHaveBeenCalled()
  })

  it('updates a workflow', async () => {
    const updated = { id: 'wf-1', name: 'Updated' }
    vi.mocked(updateWorkflow).mockReturnValue(updated as never)
    await expect(
      makeDispatcher().dispatch(makeRequest('workflow.update', { workflowId: 'wf-1', yamlDefinition: 'name: Updated' }))
    ).resolves.toMatchObject({ ok: true, result: { workflow: updated } })
    expect(updateWorkflow).toHaveBeenCalledWith('wf-1', { yamlDefinition: 'name: Updated' })
  })

  it('deletes a workflow', async () => {
    await expect(
      makeDispatcher().dispatch(makeRequest('workflow.delete', { workflowId: 'wf-1' }))
    ).resolves.toMatchObject({ ok: true, result: { removed: true, workflowId: 'wf-1' } })
    expect(deleteWorkflow).toHaveBeenCalledWith('wf-1')
  })

  it('triggers a workflow', async () => {
    vi.mocked(triggerWorkflow).mockReturnValue({ runId: 'run-1', workflowId: 'wf-1', status: 'completed' } as never)
    await expect(
      makeDispatcher().dispatch(makeRequest('workflow.trigger', { workflowId: 'wf-1' }))
    ).resolves.toMatchObject({ ok: true, result: { runId: 'run-1', workflowId: 'wf-1', status: 'completed' } })
  })

  it('lists runs with an optional limit', async () => {
    vi.mocked(getWorkflowRuns).mockReturnValue([{ id: 'run-1' }] as never)
    await expect(
      makeDispatcher().dispatch(makeRequest('workflow.runs', { workflowId: 'wf-1', limit: 5 }))
    ).resolves.toMatchObject({ ok: true, result: { runs: [{ id: 'run-1' }] } })
    expect(getWorkflowRuns).toHaveBeenCalledWith('wf-1', 5)

    await makeDispatcher().dispatch(makeRequest('workflow.runs', { workflowId: 'wf-1' }))
    expect(getWorkflowRuns).toHaveBeenCalledWith('wf-1', undefined)
  })
})
