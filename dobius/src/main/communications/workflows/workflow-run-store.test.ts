import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkflowRun } from './workflow-run-store'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  }
}))

function makeRun(overrides: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    status: 'completed',
    currentStep: 0,
    executionTrace: [],
    startedAt: 1,
    completedAt: 2,
    errorMessage: null,
    createdAt: 1,
    ...overrides
  }
}

describe('workflow-run-store', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-workflow-runs-'))
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('appends and lists runs newest-first, scoped to a workflow', async () => {
    const { appendRun, listRuns } = await import('./workflow-run-store')
    appendRun(makeRun({ id: 'run-1', workflowId: 'wf-1', createdAt: 1 }))
    appendRun(makeRun({ id: 'run-2', workflowId: 'wf-1', createdAt: 2 }))
    appendRun(makeRun({ id: 'run-3', workflowId: 'wf-2', createdAt: 3 }))

    const runsForWf1 = listRuns('wf-1')
    expect(runsForWf1.map((r) => r.id)).toEqual(['run-2', 'run-1'])
    expect(listRuns('wf-2').map((r) => r.id)).toEqual(['run-3'])
    expect(listRuns('ghost')).toEqual([])
  })

  it('respects the limit parameter', async () => {
    const { appendRun, listRuns } = await import('./workflow-run-store')
    for (let i = 0; i < 5; i += 1) {
      appendRun(makeRun({ id: `run-${i}`, workflowId: 'wf-1', createdAt: i }))
    }
    expect(listRuns('wf-1', 2)).toHaveLength(2)
    expect(listRuns('wf-1')).toHaveLength(5)
  })

  it('caps stored runs per workflow', async () => {
    const { appendRun, listRuns } = await import('./workflow-run-store')
    for (let i = 0; i < 205; i += 1) {
      appendRun(makeRun({ id: `run-${i}`, workflowId: 'wf-1', createdAt: i }))
    }
    expect(listRuns('wf-1')).toHaveLength(200)
  })

  it('removeRunsForWorkflow clears only that workflow', async () => {
    const { appendRun, listRuns, removeRunsForWorkflow } = await import('./workflow-run-store')
    appendRun(makeRun({ id: 'run-1', workflowId: 'wf-1' }))
    appendRun(makeRun({ id: 'run-2', workflowId: 'wf-2' }))
    removeRunsForWorkflow('wf-1')
    expect(listRuns('wf-1')).toEqual([])
    expect(listRuns('wf-2')).toHaveLength(1)
  })

  it('persists across module instances', async () => {
    const mod1 = await import('./workflow-run-store')
    mod1.appendRun(makeRun({ id: 'run-1', workflowId: 'wf-1' }))
    vi.resetModules()
    const mod2 = await import('./workflow-run-store')
    expect(mod2.listRuns('wf-1').map((r) => r.id)).toEqual(['run-1'])
  })
})
