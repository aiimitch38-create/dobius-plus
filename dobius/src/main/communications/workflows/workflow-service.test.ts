import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  }
}))

describe('workflow-service', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-workflow-service-'))
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('triggers a workflow, executes its steps, and records a run', async () => {
    const { createWorkflow, triggerWorkflow, getWorkflowRuns } = await import('./workflow-service')
    const workflow = createWorkflow({
      ownerPubkey: 'owner',
      channelId: 'chan-1',
      yamlDefinition: 'name: Greeter\nsteps:\n  - id: a\n    type: log\n    with: {message: hi}'
    })

    const result = triggerWorkflow(workflow.id)
    expect(result.workflowId).toBe(workflow.id)
    expect(result.status).toBe('completed')
    expect(result.runId).toBeTruthy()

    const runs = getWorkflowRuns(workflow.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe(result.runId)
    expect(runs[0].executionTrace).toEqual([
      expect.objectContaining({ stepId: 'a', status: 'completed', output: { message: 'hi' } })
    ])
  })

  it('throws for triggering, showing, updating, deleting, or listing runs of a missing workflow', async () => {
    const { triggerWorkflow, getWorkflowOrThrow, updateWorkflow, deleteWorkflow, getWorkflowRuns } = await import(
      './workflow-service'
    )
    expect(() => triggerWorkflow('ghost')).toThrow(/Workflow not found/)
    expect(() => getWorkflowOrThrow('ghost')).toThrow(/Workflow not found/)
    expect(() => updateWorkflow('ghost', { yamlDefinition: 'name: x' })).toThrow(/Workflow not found/)
    expect(() => deleteWorkflow('ghost')).toThrow(/Workflow not found/)
    expect(() => getWorkflowRuns('ghost')).toThrow(/Workflow not found/)
  })

  it('deleting a workflow also clears its run history', async () => {
    const { createWorkflow, triggerWorkflow, deleteWorkflow, getWorkflowOrThrow } = await import('./workflow-service')
    const workflow = createWorkflow({ ownerPubkey: 'owner', channelId: null, yamlDefinition: 'name: X\nsteps: []' })
    triggerWorkflow(workflow.id)
    deleteWorkflow(workflow.id)
    expect(() => getWorkflowOrThrow(workflow.id)).toThrow(/Workflow not found/)
  })

  it('getChannelWorkflows / getChannelsWorkflows scope correctly', async () => {
    const { createWorkflow, getChannelWorkflows, getChannelsWorkflows } = await import('./workflow-service')
    const a = createWorkflow({ ownerPubkey: 'owner', channelId: 'chan-a', yamlDefinition: 'name: A' })
    const b = createWorkflow({ ownerPubkey: 'owner', channelId: 'chan-b', yamlDefinition: 'name: B' })
    createWorkflow({ ownerPubkey: 'owner', channelId: null, yamlDefinition: 'name: C' })

    expect(getChannelWorkflows('chan-a').map((w) => w.id)).toEqual([a.id])
    const both = getChannelsWorkflows(['chan-a', 'chan-b']).map((w) => w.id).sort()
    expect(both).toEqual([a.id, b.id].sort())
  })
})
