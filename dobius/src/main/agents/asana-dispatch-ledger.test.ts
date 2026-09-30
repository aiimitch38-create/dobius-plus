import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('does not claim a task when the claim cannot be persisted', async () => {
    mkdirSync(path.join(electronMock.userDataDir, 'asana-dispatch-ledger.json'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ledger = await loadLedger()

    expect(ledger.claimTask('123459', 'build')).toBeNull()
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

  it('never re-claims a task whose build was dispatched, even after the triage run fails', async () => {
    const ledger = await loadLedger()
    ledger.claimTask('300001', 'build')
    expect(ledger.mayDispatchBuild('300001')).toBe(true)
    expect(ledger.recordBuildDispatched('300001')).toBe(true)
    ledger.recordFailure('300001')

    expect(ledger.mayDispatchBuild('300001')).toBe(false)
    expect(ledger.claimTask('300001', 'build')).toBeNull()
    // Survives a reload (the field is persisted, not session-only).
    const reloaded = await loadLedger()
    expect(reloaded.mayDispatchBuild('300001')).toBe(false)
    expect(reloaded.claimTask('300001', 'build')).toBeNull()
  })

  it('records a build for a task missing from the ledger', async () => {
    const ledger = await loadLedger()
    expect(ledger.recordBuildDispatched('300002')).toBe(true)
    expect(ledger.mayDispatchBuild('300002')).toBe(false)
    expect(ledger.claimTask('300002', 'build')).toBeNull()
  })

  it('refuses build dispatch while the ledger is unreadable', async () => {
    writeFileSync(path.join(electronMock.userDataDir, 'asana-dispatch-ledger.json'), '{broken')
    const ledger = await loadLedger()
    expect(ledger.mayDispatchBuild('300003')).toBe(false)
  })

  describe('interrupted claims (BUILD-024 #43)', () => {
    it('a claim left by a crashed process is reconciled on the next start, not skipped for 30 days', async () => {
      const crashed = await loadLedger()
      crashed.claimTask('400001', 'build')

      const restarted = await loadLedger()
      expect(restarted.hasBeenClaimed('400001')).toBe(true)
      expect(restarted.reconcileInterruptedClaims()).toEqual([
        expect.objectContaining({ gid: '400001', status: 'failed', attempts: 1 })
      ])
      expect(restarted.claimTask('400001', 'build')).toMatchObject({ status: 'claimed' })
      // This process's own live claim is never treated as interrupted.
      expect(restarted.reconcileInterruptedClaims()).toEqual([])
      expect(restarted.hasBeenClaimed('400001')).toBe(true)
    })

    it('counts each interruption as an attempt, so a task that keeps killing the app dead-letters', async () => {
      ;(await loadLedger()).claimTask('400002', 'build')
      const second = await loadLedger()
      second.reconcileInterruptedClaims()
      second.claimTask('400002', 'build')
      const third = await loadLedger()
      expect(third.reconcileInterruptedClaims()).toEqual([
        expect.objectContaining({ gid: '400002', status: 'dead', attempts: 2 })
      ])
      expect(third.claimTask('400002', 'build')).toBeNull()
    })

    it('never re-dispatches a build recorded before the crash', async () => {
      const crashed = await loadLedger()
      crashed.claimTask('400003', 'build')
      crashed.recordBuildDispatched('400003')

      const restarted = await loadLedger()
      restarted.reconcileInterruptedClaims()
      expect(restarted.claimTask('400003', 'build')).toBeNull()
      expect(restarted.mayDispatchBuild('400003')).toBe(false)
    })

    it('reconciles a claimed record written by older code without an owner', async () => {
      const now = Date.now()
      writeFileSync(
        path.join(electronMock.userDataDir, 'asana-dispatch-ledger.json'),
        JSON.stringify([
          {
            gid: '400004',
            lane: 'review',
            firstSeenAt: now,
            lastAttemptAt: now,
            attempts: 0,
            status: 'claimed'
          }
        ])
      )
      const ledger = await loadLedger()
      expect(ledger.reconcileInterruptedClaims()).toHaveLength(1)
      expect(ledger.claimTask('400004', 'review')).toMatchObject({ status: 'claimed' })
    })

    function writeForeignClaim(gid: string, claimPid: number, claimedAt: number): void {
      writeFileSync(
        path.join(electronMock.userDataDir, 'asana-dispatch-ledger.json'),
        JSON.stringify([
          {
            gid,
            lane: 'build',
            firstSeenAt: claimedAt,
            lastAttemptAt: claimedAt,
            attempts: 0,
            status: 'claimed',
            claimOwner: 'other-instance',
            claimPid,
            claimedAt
          }
        ])
      )
    }

    it("leaves a live foreign instance's fresh claim alone (F1)", async () => {
      writeForeignClaim('410001', process.ppid, Date.now())
      const ledger = await loadLedger()
      expect(ledger.reconcileInterruptedClaims()).toEqual([])
      expect(ledger.claimTask('410001', 'build')).toBeNull()
    })

    it('reconciles a foreign claim whose process is dead (ESRCH), not one that is EPERM (F1)', async () => {
      const deadPid = 2_000_001
      const eprmPid = 2_000_002
      const realKill = process.kill.bind(process)
      vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
        if (pid === deadPid || pid === eprmPid) {
          throw Object.assign(new Error('probe'), { code: pid === deadPid ? 'ESRCH' : 'EPERM' })
        }
        return realKill(pid, signal)
      }) as typeof process.kill)
      writeForeignClaim('410002', deadPid, Date.now())
      const ledger = await loadLedger()
      expect(ledger.reconcileInterruptedClaims()).toEqual([
        expect.objectContaining({ gid: '410002', status: 'failed', attempts: 1 })
      ])
      writeForeignClaim('410003', eprmPid, Date.now())
      expect(ledger.reconcileInterruptedClaims()).toEqual([])
    })

    it('reconciles a live foreign claim held past the stale bound (F1)', async () => {
      const ledger = await loadLedger()
      writeForeignClaim('410004', process.ppid, Date.now() - ledger.CLAIM_STALE_MS - 1_000)
      expect(ledger.reconcileInterruptedClaims()).toEqual([
        expect.objectContaining({ gid: '410004', status: 'failed' })
      ])
    })

    it("re-reads the ledger before claiming, so another instance's new claim is honoured (F1)", async () => {
      const ledger = await loadLedger()
      expect(ledger.listDispatchRecords()).toEqual([])
      writeForeignClaim('410005', process.ppid, Date.now())
      expect(ledger.claimTask('410005', 'build')).toBeNull()
    })

    it('rejects a malformed claimPid as an invalid record (CX12)', async () => {
      writeForeignClaim('410006', -4, Date.now())
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const ledger = await loadLedger()
      expect(ledger.claimTask('410007', 'build')).toBeNull()
    })

    it('does nothing while the ledger is unreadable', async () => {
      writeFileSync(path.join(electronMock.userDataDir, 'asana-dispatch-ledger.json'), '{broken')
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const ledger = await loadLedger()
      expect(ledger.reconcileInterruptedClaims()).toEqual([])
    })
  })

  describe('retention (BUILD-024 #44)', () => {
    const DAY = 24 * 60 * 60 * 1000

    it('keeps dead letters, dispatched builds and live claims past the 30-day prune', async () => {
      const ledger = await loadLedger()
      ledger.claimTask('500001', 'build')
      ledger.recordFailure('500001')
      ledger.claimTask('500001', 'build')
      ledger.recordFailure('500001')
      ledger.claimTask('500002', 'build')
      ledger.recordBuildDispatched('500002')
      ledger.recordBriefed('500002')
      ledger.claimTask('500003', 'build')
      ledger.claimTask('500004', 'build')
      ledger.recordBriefed('500004')

      ledger.pruneOld(Date.now() + 31 * DAY)

      expect(ledger.listDispatchRecords().map((record) => record.gid)).toEqual([
        '500001',
        '500002',
        '500003'
      ])
      const reloaded = await loadLedger()
      expect(reloaded.isDead('500001')).toBe(true)
      expect(reloaded.claimTask('500001', 'build')).toBeNull()
      expect(reloaded.mayDispatchBuild('500002')).toBe(false)
    })
  })

  describe('build mark undo (BUILD-024 F2)', () => {
    it('a failed dispatch mark on an unclaimed task leaves no blocking record', async () => {
      const ledger = await loadLedger()
      const mark = ledger.markBuildDispatched('450001')
      expect(mark).toEqual({ saved: true, created: true })
      ledger.clearBuildDispatched('450001', mark.created)
      expect(ledger.listDispatchRecords()).toEqual([])
      expect(ledger.claimTask('450001', 'build')).toMatchObject({ status: 'claimed' })
    })

    it('a failed dispatch mark on a claimed task keeps the claim', async () => {
      const ledger = await loadLedger()
      ledger.claimTask('450002', 'build')
      const mark = ledger.markBuildDispatched('450002')
      expect(mark.created).toBe(false)
      ledger.clearBuildDispatched('450002', mark.created)
      expect(ledger.listDispatchRecords()).toEqual([
        expect.not.objectContaining({ buildDispatchedAt: expect.anything() })
      ])
      expect(ledger.hasBeenClaimed('450002')).toBe(true)
    })
  })

  describe('human re-queue (BUILD-024)', () => {
    it('lists and re-queues a dead-lettered task', async () => {
      const ledger = await loadLedger()
      ledger.claimTask('600001', 'build')
      ledger.recordFailure('600001')
      ledger.claimTask('600001', 'build')
      ledger.recordFailure('600001')
      expect(ledger.listBlockedTaskGids()).toEqual(['600001'])

      expect(ledger.requeueTask('600001')).toEqual({ ok: true })
      expect(ledger.listBlockedTaskGids()).toEqual([])
      expect(ledger.claimTask('600001', 'build')).toMatchObject({ status: 'claimed', attempts: 0 })
    })

    it('re-queues a task blocked by a dispatched build, and the block survives reload until then', async () => {
      const ledger = await loadLedger()
      ledger.claimTask('600002', 'build')
      ledger.recordBuildDispatched('600002')
      ledger.recordBriefed('600002')
      const reloaded = await loadLedger()
      expect(reloaded.listBlockedTaskGids()).toEqual(['600002'])

      expect(reloaded.requeueTask('600002')).toEqual({ ok: true })
      expect(reloaded.mayDispatchBuild('600002')).toBe(true)
      expect(reloaded.claimTask('600002', 'build')).toMatchObject({ status: 'claimed' })
    })

    it('refuses to re-queue a task that is being triaged right now', async () => {
      const ledger = await loadLedger()
      ledger.claimTask('600003', 'build')
      expect(ledger.requeueTask('600003')).toMatchObject({ ok: false })
      expect(ledger.hasBeenClaimed('600003')).toBe(true)
    })

    it('refuses to re-queue while the ledger is unreadable', async () => {
      const file = path.join(electronMock.userDataDir, 'asana-dispatch-ledger.json')
      writeFileSync(file, '{broken')
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const ledger = await loadLedger()
      expect(ledger.requeueTask('600004')).toMatchObject({ ok: false })
      expect(ledger.listBlockedTaskGids()).toEqual([])
    })
  })
})
