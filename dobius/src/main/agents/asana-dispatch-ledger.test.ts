import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  userDataDir: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMock.userDataDir)
  }
}))

async function loadLedger() {
  vi.resetModules()
  return import('./asana-dispatch-ledger')
}

beforeEach(() => {
  electronMock.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-asana-ledger-'))
})

afterEach(() => {
  rmSync(electronMock.userDataDir, { recursive: true, force: true })
})

describe('asana dispatch ledger', () => {
  it('claims a task idempotently', async () => {
    const ledger = await loadLedger()
    const first = ledger.claimTask('123456', 'build')
    const second = ledger.claimTask('123456', 'build')

    expect(first).toMatchObject({ gid: '123456', lane: 'build', status: 'claimed' })
    expect(second).toBeNull()
    expect(ledger.hasBeenClaimed('123456')).toBe(true)
    expect(ledger.listDispatchRecords()).toHaveLength(1)
  })

  it('dead-letters after two failures', async () => {
    const ledger = await loadLedger()
    ledger.claimTask('123457', 'review')

    expect(ledger.recordFailure('123457')).toMatchObject({ attempts: 1, status: 'failed' })
    expect(ledger.hasBeenClaimed('123457')).toBe(false)
    expect(ledger.claimTask('123457', 'review')).toMatchObject({ status: 'claimed' })
    expect(ledger.recordFailure('123457')).toMatchObject({ attempts: 2, status: 'dead' })
    expect(ledger.isDead('123457')).toBe(true)
    expect(ledger.hasBeenClaimed('123457')).toBe(true)
  })

  it('keeps dead tasks dead', async () => {
    const ledger = await loadLedger()
    ledger.claimTask('123458', 'build')
    ledger.recordFailure('123458')
    ledger.claimTask('123458', 'build')
    ledger.recordFailure('123458')

    expect(ledger.claimTask('123458', 'build')).toBeNull()
    expect(ledger.recordFailure('123458')).toMatchObject({ attempts: 2, status: 'dead' })
  })

  it('releaseClaim removes a fresh claim so the task is claimable again', async () => {
    const ledger = await loadLedger()
    ledger.claimTask('200001', 'build')

    expect(ledger.releaseClaim('200001')).toBeNull()
    expect(ledger.listDispatchRecords()).toHaveLength(0)
    expect(ledger.claimTask('200001', 'build')).toMatchObject({ status: 'claimed' })
  })

  it('releaseClaim returns a reclaimed failed record to failed without counting an attempt', async () => {
    const ledger = await loadLedger()
    ledger.claimTask('200002', 'build')
    ledger.recordFailure('200002')
    ledger.claimTask('200002', 'build')

    expect(ledger.releaseClaim('200002')).toMatchObject({ status: 'failed', attempts: 1 })
  })

  it('releaseClaim leaves briefed and dead records unchanged', async () => {
    const ledger = await loadLedger()
    ledger.claimTask('200003', 'build')
    ledger.recordBriefed('200003')
    ledger.claimTask('200004', 'build')
    ledger.recordFailure('200004')
    ledger.claimTask('200004', 'build')
    ledger.recordFailure('200004')

    expect(ledger.releaseClaim('200003')).toMatchObject({ status: 'briefed' })
    expect(ledger.releaseClaim('200004')).toMatchObject({ status: 'dead', attempts: 2 })
  })
})
