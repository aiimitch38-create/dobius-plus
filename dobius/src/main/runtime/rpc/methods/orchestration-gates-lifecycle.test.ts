import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ORCHESTRATION_GATE_METHODS } from './orchestration-gates'
import type { RpcContext } from '../core'
import { OrchestrationDb } from '../../orchestration/db'
import { DobiusRuntimeService } from '../../dobius-runtime'

const testState = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  }
}))

function call(name: string, params: Record<string, unknown>, ctx: RpcContext) {
  const method = ORCHESTRATION_GATE_METHODS.find((m) => m.name === name)
  if (!method) {
    throw new Error(`${name} not registered`)
  }
  return method.handler(method.params ? method.params.parse(params) : undefined, ctx)
}

describe('orchestration coordinator run ownership', () => {
  let runtime: DobiusRuntimeService
  let ctx: RpcContext

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-orchestration-lifecycle-test-'))
    writeFileSync(join(testState.dir, 'agents-config.json'), JSON.stringify({ agentsPaused: false }))
    runtime = new DobiusRuntimeService()
    ctx = { runtime }
  })

  afterEach(async () => {
    // Why: let any stopped coordinator loop finish its last sleep before the
    // temp dir goes away. The in-memory DB is left for GC so a loop that is
    // still mid-tick never hits a closed handle.
    await new Promise((r) => {
      setTimeout(r, 50)
    })
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('stops and restarts past a running row left by a previous process, keeping tasks', async () => {
    const db = new OrchestrationDb(':memory:')
    runtime.setOrchestrationDb(db)
    const task = db.createTask({ spec: 'survives restart' })
    // Why: blocked on a gate so the started coordinator never dispatches
    // through the real (unconfigured) runtime during this test.
    db.createGate({ taskId: task.id, question: 'proceed?' })
    const orphan = db.createCoordinatorRun({ spec: 'before restart', coordinatorHandle: 'coord' })

    expect(call('orchestration.runStop', {}, ctx)).toEqual({ runId: orphan.id, stopped: true })
    expect(db.getCoordinatorRun(orphan.id)?.status).toBe('failed')
    expect(db.getActiveCoordinatorRun()).toBeUndefined()

    const second = db.createCoordinatorRun({ spec: 'also orphaned', coordinatorHandle: 'coord' })
    const started = (await call(
      'orchestration.run',
      { spec: 'after restart', pollIntervalMs: 10 },
      ctx
    )) as { runId: string; status: string }
    expect(started.status).toBe('running')
    expect(started.runId).not.toBe(second.id)
    expect(db.getCoordinatorRun(second.id)?.status).toBe('failed')
    expect(db.getActiveCoordinatorRun()?.id).toBe(started.runId)
    expect(db.getTask(task.id)).toBeDefined()

    // The live run is owned, so a second start is still refused.
    expect(() => call('orchestration.run', { spec: 'again' }, ctx)).toThrow(
      /Coordinator already running/
    )

    expect(call('orchestration.runStop', {}, ctx)).toEqual({
      runId: started.runId,
      stopped: true
    })
    expect(db.getCoordinatorRun(started.runId)?.status).toBe('failed')
    expect(() => call('orchestration.runStop', {}, ctx)).toThrow(/No active coordinator run/)
  })
})
