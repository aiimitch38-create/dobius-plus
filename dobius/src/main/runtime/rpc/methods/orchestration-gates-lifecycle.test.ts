import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ORCHESTRATION_GATE_METHODS } from './orchestration-gates'
import type { RpcContext } from '../core'
import { OrchestrationDb } from '../../orchestration/db'
import Database from '../../../sqlite/sync-database'
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

  it('leaves a run owned by another live process alone: run and runStop both refuse', () => {
    const dbPath = join(testState.dir, 'orchestration.db')
    // Why: a second dev instance shares this DB file; the parent pid stands in
    // for that live process.
    const other = new OrchestrationDb(dbPath, { pid: process.ppid, sessionId: 'other-instance' })
    other.createTask({ spec: 'owned by the other instance' })
    const foreign = other.createCoordinatorRun({ spec: 'elsewhere', coordinatorHandle: 'coord' })
    other.close()

    const db = OrchestrationDb.openForProcess(dbPath)
    runtime.setOrchestrationDb(db)
    expect(db.getCoordinatorRun(foreign.id)?.status).toBe('running')
    expect(() => call('orchestration.run', { spec: 'second' }, ctx)).toThrow(
      /Coordinator already running: .*owned by another live process/
    )
    expect(() => call('orchestration.runStop', {}, ctx)).toThrow(
      /must be stopped from that instance/
    )
    expect(db.getCoordinatorRun(foreign.id)?.status).toBe('running')
    expect(db.getActiveCoordinatorRun()?.id).toBe(foreign.id)
    db.close()
  })

  it('refuses a new run until a stopped coordinator loop has exited', async () => {
    const db = new OrchestrationDb(':memory:')
    runtime.setOrchestrationDb(db)
    const task = db.createTask({ spec: 'gated' })
    db.createGate({ taskId: task.id, question: 'proceed?' })

    const first = (await call(
      'orchestration.run',
      { spec: 'first', pollIntervalMs: 300 },
      ctx
    )) as { runId: string }
    // Why: the first tick is done once the gate is re-checked; the loop then
    // sits in its 300 ms sleep, still unsettled after runStop returns.
    await new Promise((r) => {
      setTimeout(r, 30)
    })
    expect(call('orchestration.runStop', {}, ctx)).toEqual({ runId: first.runId, stopped: true })
    expect(() => call('orchestration.run', { spec: 'too soon' }, ctx)).toThrow(
      new RegExp(`Coordinator run ${first.runId} is still stopping`)
    )

    await new Promise((r) => {
      setTimeout(r, 400)
    })
    const second = (await call(
      'orchestration.run',
      { spec: 'after exit', pollIntervalMs: 10 },
      ctx
    )) as { runId: string; status: string }
    expect(second.status).toBe('running')
    expect(call('orchestration.runStop', {}, ctx)).toEqual({ runId: second.runId, stopped: true })
  })

  it('retires a live-pid run whose heartbeat is stale (reused pid) so run succeeds', async () => {
    const dbPath = join(testState.dir, 'orchestration.db')
    const other = new OrchestrationDb(dbPath, { pid: process.ppid, sessionId: 'crashed-instance' })
    const task = other.createTask({ spec: 'gated' })
    other.createGate({ taskId: task.id, question: 'proceed?' })
    const crashed = other.createCoordinatorRun({ spec: 'before crash', coordinatorHandle: 'coord' })
    other.close()
    const raw = new Database(dbPath)
    raw
      .prepare(
        "UPDATE coordinator_runs SET owner_heartbeat_at = datetime('now', '-5 minutes') WHERE id = ?"
      )
      .run(crashed.id)
    raw.close()

    const db = new OrchestrationDb(dbPath)
    runtime.setOrchestrationDb(db)
    const started = (await call(
      'orchestration.run',
      { spec: 'after crash', pollIntervalMs: 10 },
      ctx
    )) as { runId: string; status: string }
    expect(started.status).toBe('running')
    expect(db.getCoordinatorRun(crashed.id)?.status).toBe('failed')
    expect(call('orchestration.runStop', {}, ctx)).toEqual({ runId: started.runId, stopped: true })
  })

  it('still refuses a live-pid run whose heartbeat is fresh', () => {
    const dbPath = join(testState.dir, 'orchestration.db')
    const other = new OrchestrationDb(dbPath, { pid: process.ppid, sessionId: 'beating-instance' })
    other.createTask({ spec: 'owned elsewhere' })
    const live = other.createCoordinatorRun({ spec: 'beating', coordinatorHandle: 'coord' })
    other.touchCoordinatorRun(live.id)
    other.close()

    const db = new OrchestrationDb(dbPath)
    runtime.setOrchestrationDb(db)
    expect(() => call('orchestration.run', { spec: 'second' }, ctx)).toThrow(
      /Coordinator already running: .*owned by another live process/
    )
    expect(db.getCoordinatorRun(live.id)?.status).toBe('running')
  })

  it('with a huge poll interval, runStop then run succeeds without waiting it out', async () => {
    const db = new OrchestrationDb(':memory:')
    runtime.setOrchestrationDb(db)
    const task = db.createTask({ spec: 'gated' })
    db.createGate({ taskId: task.id, question: 'proceed?' })

    const first = (await call(
      'orchestration.run',
      { spec: 'slow poll', pollIntervalMs: 3_600_000 },
      ctx
    )) as { runId: string }
    expect(db.getCoordinatorRun(first.runId)?.poll_interval_ms).toBe(60_000)
    await new Promise((r) => {
      setTimeout(r, 30)
    })
    call('orchestration.runStop', {}, ctx)
    await new Promise((r) => {
      setTimeout(r, 30)
    })
    const second = (await call(
      'orchestration.run',
      { spec: 'right after', pollIntervalMs: 10 },
      ctx
    )) as { status: string }
    expect(second.status).toBe('running')
    call('orchestration.runStop', {}, ctx)
  })
})
