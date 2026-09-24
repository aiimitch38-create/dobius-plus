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

describe('orchestration.run crew admission', () => {
  let db: OrchestrationDb
  let ctx: RpcContext

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-orchestration-admission-test-'))
    // Real Pause crew file, read through the real gate and config store.
    writeFileSync(join(testState.dir, 'agents-config.json'), JSON.stringify({ agentsPaused: true }))
    db = new OrchestrationDb(':memory:')
    const runtime = new DobiusRuntimeService()
    runtime.setOrchestrationDb(db)
    ctx = { runtime }
  })

  afterEach(() => {
    db.close()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  function callRun(params: Record<string, unknown>) {
    const method = ORCHESTRATION_GATE_METHODS.find((m) => m.name === 'orchestration.run')
    if (!method) {
      throw new Error('orchestration.run not registered')
    }
    return method.handler(method.params ? method.params.parse(params) : undefined, ctx)
  }

  it('refuses while the crew is paused without inserting a coordinator run', () => {
    const createCoordinatorRun = vi.spyOn(db, 'createCoordinatorRun')

    expect(() => callRun({ spec: 'build it' })).toThrow(/Crew is paused/)

    expect(createCoordinatorRun).not.toHaveBeenCalled()
    expect(db.getActiveCoordinatorRun()).toBeUndefined()
  })
})
