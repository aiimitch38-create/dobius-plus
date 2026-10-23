import { afterEach, describe, expect, it } from 'vitest'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  renameSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import {
  WorkerAttemptId,
  WorkerId,
  HERMES_PROFILE_IDS,
  type HermesProfileRegistration,
  type QueuePort,
  type WorkerJob,
  type WorkerLease
} from '../../../shared/workstation-worker'
import { WorkstationWorker } from './worker'
import { AttemptJournal, createAttemptRecord } from './journal'
import { processGroup, processStart, signalOwnedGroup } from './process-identity'
import type { WorkerRegistry } from './registry'
import { resolveExecution, validateHermesProfileRegistrations } from './registry'
import { WorkerInstanceLock } from './instance-lock'
import { manageRecoveredWatcher } from './recovered-lifecycle'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('WorkstationWorker fixture execution', () => {
  it('refuses TERM and KILL when recorded group ownership changes at signal time', () => {
    const fixture = createFixture('process.exit(0)\n')
    const record = createAttemptRecord(
      fixture.job,
      leaseFor(fixture),
      fixture.root,
      fixture.worktree,
      'incarnation',
      'boot-a',
      Date.now()
    )
    Object.assign(record, {
      pid: 4101,
      processStart: 'original-start',
      processGroupId: 4101
    })
    const signals: { pgid: number; signal: NodeJS.Signals }[] = []
    let identityObservations = 0
    const replacedIdentity = {
      processStart: (pid: number) =>
        pid === 4101
          ? identityObservations++ === 0
            ? 'original-start'
            : 'replacement-start'
          : null,
      processGroup: (pid: number) => (pid === 4101 ? 4101 : null)
    }

    // The first identity read matches; the immediate pre-signal read models PID/group reuse.
    expect(
      signalOwnedGroup(record, 'SIGTERM', replacedIdentity, (pgid, signal) => {
        signals.push({ pgid, signal })
      })
    ).toBe(false)
    expect(
      signalOwnedGroup(record, 'SIGKILL', replacedIdentity, (pgid, signal) => {
        signals.push({ pgid, signal })
      })
    ).toBe(false)
    expect(signals).toEqual([])
  })

  it('requires authenticated start authorization before any child side effect', async () => {
    const fixture = createFixture("require('node:fs').writeFileSync('marker', 'spawned')\n")
    const markerPath = join(fixture.worktree, 'marker')
    const port = queue([])
    port.authorizeStart = async () => {
      throw new Error('server rejected fake lease')
    }
    await expect(createWorker(fixture, port).runClaim(envelope(fixture))).rejects.toThrow(
      /rejected fake lease/
    )
    expect(existsSync(markerPath)).toBe(false)
    expect(existsSync(fixture.statePath)).toBe(false)
  })

  it('rejects a permit bound to another enrolled identity without spawning', async () => {
    const fixture = createFixture('process.exit(0)\n')
    const port = queue([])
    port.authorizeStart = async (lease, binding) => ({
      permitId: 'permit-1',
      ...binding,
      deviceId: 'other-device',
      attemptId: lease.attemptId,
      workerId: lease.workerId,
      expiresAt: lease.expiresAt
    })
    await expect(createWorker(fixture, port).runClaim(envelope(fixture))).rejects.toThrow(
      /does not match/
    )
    expect(existsSync(fixture.statePath)).toBe(false)
    expect(fixture.registry.workerId).not.toBe(fixture.registry.deviceId)
  })

  it('rechecks permit expiry immediately before launch', async () => {
    const fixture = createFixture("require('node:fs').writeFileSync('marker', 'spawned')\n")
    const port = queue([])
    port.authorizeStart = async (lease, binding) => ({
      permitId: 'permit-1',
      ...binding,
      attemptId: lease.attemptId,
      workerId: lease.workerId,
      expiresAt: 3500
    })
    let time = 0
    await expect(
      createWorker(fixture, port, 'boot-a', () => (time += 1000)).runClaim(envelope(fixture))
    ).rejects.toThrow(/expired/)
    expect(existsSync(join(fixture.worktree, 'marker'))).toBe(false)
    expect(JSON.parse(readFileSync(fixture.statePath, 'utf8')).phase).toBe('ambiguous')
  })

  it('rejects identifiers that could escape identifier fields', () => {
    expect(WorkerId.safeParse('worker.profile-1').success).toBe(true)
    expect(WorkerId.safeParse('../worker').success).toBe(false)
    expect(WorkerAttemptId.safeParse('attempt/1').success).toBe(false)
    expect(WorkerAttemptId.safeParse('attempt\n1').success).toBe(false)
  })

  it('runs a registered executable at exact revision, bounds evidence, and settles with cleanup proof', async () => {
    const fixture = createFixture("process.stdout.write('fixture-output'); process.exit(0)\n")
    const calls: string[] = []
    const worker = createWorker(fixture, queue(calls))
    await worker.runClaim(envelope(fixture))
    expect(calls).toContain('settle:true')
    expect(calls.some((call) => call.includes('log_tail_sha256:'))).toBe(true)
    const stored = readFileSync(fixture.statePath, 'utf8')
    expect(stored).toContain('"phase":"settled"')
    expect(stored).toContain('sealed:v1:')
    expect(stored).not.toContain('t'.repeat(40))
  })

  it('refuses an altered repository revision and job supplied command text before spawning', async () => {
    const fixture = createFixture("process.stdout.write('should-not-run')\n")
    const injected = envelope(fixture)
    injected.job = {
      ...(injected.job as object),
      command: 'touch /tmp/pwned'
    } as unknown as WorkerJob
    await expect(createWorker(fixture, queue([])).runClaim(injected)).rejects.toThrow()
    const invalid = envelope(fixture)
    invalid.job = { ...(invalid.job as object), sourceRevision: '0'.repeat(40) } as WorkerJob
    await expect(createWorker(fixture, queue([])).runClaim(invalid)).rejects.toThrow(/revision/)
    expect(existsSync(fixture.statePath)).toBe(false)
  })

  it('rejects dirty tracked and untracked source without discarding edits', () => {
    const tracked = createFixture('process.exit(0)\n')
    writeFileSync(join(tracked.worktree, 'tracked.txt'), 'intentional user edit\n')
    expect(() => resolveExecution(tracked.registry, tracked.job)).toThrow(/dirty or has untracked/)
    expect(readFileSync(join(tracked.worktree, 'tracked.txt'), 'utf8')).toBe(
      'intentional user edit\n'
    )

    const untracked = createFixture('process.exit(0)\n')
    writeFileSync(join(untracked.worktree, 'new-source.txt'), 'untracked source\n')
    expect(() => resolveExecution(untracked.registry, untracked.job)).toThrow(
      /dirty or has untracked/
    )
    expect(readFileSync(join(untracked.worktree, 'new-source.txt'), 'utf8')).toBe(
      'untracked source\n'
    )
  })

  it('preserves and attributes intentional agent source edits in result evidence', async () => {
    const fixture = createFixture(
      "require('node:fs').writeFileSync('tracked.txt', 'agent-authored result\\n'); process.exit(0)\n"
    )
    const calls: string[] = []
    await createWorker(fixture, queue(calls)).runClaim(envelope(fixture))
    expect(readFileSync(join(fixture.worktree, 'tracked.txt'), 'utf8')).toBe(
      'agent-authored result\n'
    )
    expect(calls.some((entry) => entry.startsWith('source_changes_sha256:'))).toBe(true)
  })

  it('rejects symlinked and replaced Hermes profile homes before spawn', async () => {
    const symlinkFixture = createHermesFixture()
    const realHome = join(symlinkFixture.dir, 'real-home')
    const linkedHome = join(symlinkFixture.dir, 'linked-home')
    mkdirSync(realHome, { mode: 0o700 })
    symlinkSync(realHome, linkedHome)
    symlinkFixture.registry.profiles[0]!.home = linkedHome
    expect(() => resolveExecution(symlinkFixture.registry, symlinkFixture.job)).toThrow(
      /canonical real directory/
    )

    const replaced = createHermesFixture()
    const marker = join(replaced.worktree, 'marker')
    const originalHome = replaced.registry.profiles[0]!.home
    const port = queue([])
    let authorized = false
    port.authorizeStart = async (lease, binding) => {
      authorized = true
      renameSync(originalHome, `${originalHome}.old`)
      mkdirSync(originalHome, { mode: 0o700 })
      return {
        permitId: 'permit-1',
        ...binding,
        attemptId: lease.attemptId,
        workerId: lease.workerId,
        expiresAt: lease.expiresAt
      }
    }
    await expect(createWorker(replaced, port).runClaim(envelope(replaced))).rejects.toThrow()
    expect(authorized).toBe(true)
    expect(existsSync(marker)).toBe(false)
  })

  it.each(['root', 'worktree'] as const)(
    'rejects %s inode replacement during authorization',
    async (target) => {
      const fixture = createFixture("require('node:fs').writeFileSync('marker', 'spawned')\n")
      const path = target === 'root' ? fixture.root : fixture.worktree
      const port = queue([])
      port.authorizeStart = async (lease, binding) => {
        renameSync(path, `${path}.replaced`)
        mkdirSync(path)
        return {
          permitId: 'permit-1',
          ...binding,
          attemptId: lease.attemptId,
          workerId: lease.workerId,
          expiresAt: lease.expiresAt
        }
      }
      await expect(createWorker(fixture, port).runClaim(envelope(fixture))).rejects.toThrow()
      expect(existsSync(join(fixture.worktree, 'marker'))).toBe(false)
    }
  )

  it('refuses startup before any fixture executable can spawn when ps inspection is unavailable', () => {
    const fixture = createFixture("require('node:fs').writeFileSync('marker', 'spawned')\n")
    expect(() =>
      createWorker(fixture, queue([]), 'boot-a', undefined, fixture.statePath, undefined, {
        processStart: () => null,
        processGroup: () => null
      })
    ).toThrow(/refuses startup before spawn/)
    expect(existsSync(join(fixture.worktree, 'marker'))).toBe(false)
  })

  it('fences one physical worktree across workers with different journal paths', async () => {
    const fixture = createFixture("require('node:fs').writeFileSync('marker', 'spawned')\n")
    const port = queue([])
    let enter!: () => void
    let proceed!: () => void
    const entered = new Promise<void>((resolve) => (enter = resolve))
    const gate = new Promise<void>((resolve) => (proceed = resolve))
    port.authorizeStart = async (lease, binding) => {
      enter()
      await gate
      return {
        permitId: 'permit-1',
        ...binding,
        attemptId: lease.attemptId,
        workerId: lease.workerId,
        expiresAt: lease.expiresAt
      }
    }
    const first = createWorker(fixture, port).runClaim(envelope(fixture))
    await entered
    const second = createWorker(
      fixture,
      queue([]),
      'boot-a',
      undefined,
      join(fixture.dir, 'other-state', 'attempt.json')
    )
    await expect(second.runClaim(envelope(fixture))).rejects.toThrow(/lock/)
    proceed()
    await first
    expect(readFileSync(join(fixture.worktree, 'marker'), 'utf8')).toBe('spawned')
  })

  it('fails closed on stale lock identity and never removes a replaced owner lock', () => {
    const fixture = createFixture('process.exit(0)\n')
    const stalePath = join(fixture.dir, 'stale-lock')
    mkdirSync(stalePath, { mode: 0o700 })
    writeFileSync(
      join(stalePath, 'owner.json'),
      JSON.stringify({ lockId: 'old', pid: 9, processStart: null, bootId: 'old-boot' })
    )
    expect(() => new WorkerInstanceLock(stalePath).acquire('boot-a')).toThrow(
      /explicit reconciliation/
    )
    expect(existsSync(join(stalePath, 'owner.json'))).toBe(true)

    const changedPath = join(fixture.dir, 'changed-lock')
    const lock = new WorkerInstanceLock(changedPath)
    lock.acquire('boot-a')
    writeFileSync(
      join(changedPath, 'owner.json'),
      JSON.stringify({
        lockId: 'replacement',
        pid: process.pid,
        processStart: null,
        bootId: 'boot-a'
      })
    )
    expect(() => lock.release()).toThrow(/identity changed/)
    expect(existsSync(changedPath)).toBe(true)
  })

  it('caps output and wall time then reports failure with retained bounded tail', async () => {
    const fixture = createFixture(
      "process.stdout.write('x'.repeat(100000)); setInterval(() => {}, 1000)\n"
    )
    const calls: string[] = []
    await createWorker(fixture, queue(calls)).runClaim(
      envelope(fixture, { outputBytes: 128, wallTimeMs: 2500 })
    )
    expect(calls).toContain('settle:false')
    const saved = JSON.parse(readFileSync(fixture.statePath, 'utf8')) as {
      outputBytes: number
      outputTail: string
    }
    expect(saved.outputBytes).toBeGreaterThan(128)
    expect(Buffer.from(saved.outputTail, 'base64').byteLength).toBeLessThanOrEqual(64 * 1024)
  })

  it('escalates TERM-ignoring wall-time and output-cap fixtures to bounded cleanup', async () => {
    const wall = createFixture("process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)\n")
    const wallCalls: string[] = []
    const start = Date.now()
    await createWorker(wall, queue(wallCalls)).runClaim(
      envelope(wall, { wallTimeMs: 200, outputBytes: 4096 })
    )
    expect(Date.now() - start).toBeLessThan(3500)
    expect(wallCalls).toContain('settle:false')
    expect(wallCalls).toContain('stop_reason:wall-time')

    const output = createFixture(
      "process.on('SIGTERM',()=>{}); process.stdout.write('x'.repeat(100000)); setInterval(()=>{},1000)\n"
    )
    const outputCalls: string[] = []
    await createWorker(output, queue(outputCalls)).runClaim(
      envelope(output, { wallTimeMs: 3000, outputBytes: 64 })
    )
    expect(outputCalls).toContain('settle:false')
    expect(outputCalls).toContain('stop_reason:output-cap')
  })

  it('serializes renewals and rejects a receipt for another attempt', async () => {
    const fixture = createFixture('setTimeout(() => process.exit(0), 220)\n')
    const port = queue([])
    let inFlight = 0
    let maxInFlight = 0
    let renewals = 0
    port.heartbeat = async (lease) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      renewals += 1
      await new Promise((resolve) => setTimeout(resolve, 45))
      inFlight -= 1
      return { ...lease, expiresAt: lease.expiresAt + 1000 }
    }
    const calls: string[] = []
    const serialQueue = {
      ...port,
      settle: async (
        _lease: WorkerLease,
        result: { succeeded: boolean; exitCode: number | null; evidence: string[] }
      ) => {
        calls.push(`settle:${result.succeeded}`)
      }
    }
    await createWorker(fixture, serialQueue, 'boot-a', undefined, fixture.statePath, 10).runClaim(
      envelope(fixture)
    )
    expect(renewals).toBeGreaterThan(1)
    expect(maxInFlight).toBe(1)

    const invalid = createFixture("process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)\n")
    const invalidCalls: string[] = []
    const invalidQueue = queue(invalidCalls)
    invalidQueue.heartbeat = async (lease) => ({
      ...lease,
      attemptId: 'other-attempt',
      expiresAt: lease.expiresAt + 1000
    })
    await createWorker(invalid, invalidQueue, 'boot-a', undefined, invalid.statePath, 10).runClaim(
      envelope(invalid)
    )
    const invalidRecord = JSON.parse(readFileSync(invalid.statePath, 'utf8')) as {
      phase: string
      pid: number
    }
    expect(invalidRecord.phase).toBe('ambiguous')
    expect(processStart(invalidRecord.pid)).toBeNull()
    expect(invalidCalls.some((call) => call.startsWith('settle:'))).toBe(false)
  })

  it('fences a blocked old heartbeat from writing after the journal advances', async () => {
    const fixture = createFixture('setTimeout(() => process.exit(0), 100)\n')
    let releaseHeartbeat!: (lease: WorkerLease) => void
    const port = queue([])
    port.heartbeat = (_lease) => new Promise((resolve) => (releaseHeartbeat = resolve))
    const worker = createWorker(fixture, port, 'boot-a', undefined, fixture.statePath, 10)
    const running = worker.runClaim(envelope(fixture))
    await waitFor(() => Boolean(releaseHeartbeat))
    await running
    const journal = new AttemptJournal(fixture.statePath, fixture.leaseSealer)
    const nextJob = { ...fixture.job, id: 'job-next', attemptId: 'attempt-next' }
    const nextLease = { ...leaseFor(fixture), attemptId: 'attempt-next' }
    const nextRecord = createAttemptRecord(
      nextJob,
      nextLease,
      fixture.root,
      fixture.worktree,
      'next-incarnation',
      'boot-a',
      Date.now()
    )
    nextRecord.phase = 'settled'
    journal.write(nextRecord)
    releaseHeartbeat({ ...leaseFor(fixture), expiresAt: leaseFor(fixture).expiresAt + 1000 })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(journal.read()?.attemptId).toBe('attempt-next')
    expect(journal.read()?.phase).toBe('settled')
  })

  it('hashes only recipe-allowlisted artifacts and refuses output beyond the byte cap', async () => {
    const fixture = createFixture(
      "require('node:fs').writeFileSync('result.txt','artifact-proof'); process.exit(0)\n"
    )
    fixture.registry.recipes[0]!.artifactPaths = ['result.txt']
    const calls: string[] = []
    await createWorker(fixture, queue(calls)).runClaim(envelope(fixture))
    expect(calls.some((call) => call.startsWith('artifact:result.txt:14:'))).toBe(true)
    const oversized = createFixture(
      "require('node:fs').writeFileSync('result.txt','x'.repeat(2049)); process.exit(0)\n"
    )
    oversized.registry.recipes[0]!.artifactPaths = ['result.txt']
    const oversizedCalls: string[] = []
    await createWorker(oversized, queue(oversizedCalls)).runClaim(envelope(oversized))
    expect(oversizedCalls).toContain('artifact_evidence:invalid-or-over-cap')
    expect(oversizedCalls).toContain('settle:false')
  })

  it('requires two unique Hermes homes/worktrees and fails closed on profile reuse', () => {
    const profiles = HERMES_PROFILE_IDS.map((id, index) => ({
      id,
      home: `/private/tmp/hermes-${index}`,
      worktreeId: `worktree-${index}`,
      allowedRoots: ['root-1'],
      allowedRecipes: ['recipe-1'],
      credentialRef: `secret-ref-${index}`,
      authVerified: false,
      runtimeVerified: false
    }))
    expect(validateHermesProfileRegistrations(profiles)).toHaveLength(2)
    expect(() =>
      validateHermesProfileRegistrations([
        profiles[0]!,
        { ...profiles[1]!, home: profiles[0]!.home }
      ])
    ).toThrow(/exclusive/)
    expect(() =>
      validateHermesProfileRegistrations([
        profiles[0]!,
        { ...profiles[1]!, worktreeId: profiles[0]!.worktreeId }
      ])
    ).toThrow(/exclusive/)
    expect(() => validateHermesProfileRegistrations([profiles[0]!])).toThrow(/Exactly two/)
    expect(() => validateHermesProfileRegistrations([profiles[0]!, profiles[0]!])).toThrow(
      /Exactly two/
    )
    const legacyProfiles = [
      ...profiles,
      { ...profiles[0]!, id: 'hermes-3', home: '/private/tmp/third', worktreeId: 'third' }
    ] as unknown as HermesProfileRegistration[]
    expect(() => validateHermesProfileRegistrations(legacyProfiles)).toThrow(/Exactly two/)
  })

  it('cancels the owned process group including descendants and keeps duplicate cancellation fenced', async () => {
    const fixture = createFixture(
      "const fs=require('node:fs'); const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)\"],{stdio:'ignore',detached:true}); fs.writeFileSync(__CHILD_PID_FILE__,String(c.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)\n"
    )
    const worker = createWorker(fixture, queue([]))
    const running = worker.runClaim(envelope(fixture))
    await waitFor(
      () =>
        existsSync(fixture.childPidPath) && readFileSync(fixture.childPidPath, 'utf8').length > 0
    )
    const lease = leaseFor(fixture)
    const receipt = await worker.cancel(lease, 50)
    expect(receipt.descendantsAbsent).toBe(true)
    expect(receipt.containment).toBe('posix-process-group')
    await running
    await expect(worker.cancel(lease, 10)).rejects.toThrow()
  })

  it('reconciles after reboot as ambiguous and never reruns an unresolved attempt', async () => {
    const fixture = createFixture('setInterval(() => {},1000)\n')
    const worker = createWorker(fixture, queue([]), 'boot-a')
    const running = worker.runClaim(envelope(fixture, { wallTimeMs: 4000 }))
    await waitFor(
      () =>
        existsSync(fixture.statePath) &&
        JSON.parse(readFileSync(fixture.statePath, 'utf8')).phase === 'running'
    )
    const afterRestart = createWorker(fixture, queue([]), 'boot-b')
    expect(await afterRestart.reconcile()).toBe('ambiguous')
    await expect(afterRestart.runClaim(envelope(fixture))).rejects.toThrow(/stale|durable attempt/)
    await worker.cancel(leaseFor(fixture), 50)
    await running
  })

  it('reattaches to the same process identity after supervisor restart without replay', async () => {
    const fixture = createFixture("process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)\n")
    const child = spawn(fixture.executable, [], {
      cwd: fixture.worktree,
      detached: true,
      shell: false,
      stdio: 'ignore'
    })
    await waitFor(() => Boolean(child.pid && processStart(child.pid)))
    const pid = child.pid!
    const start = processStart(pid)!
    const pgid = processGroup(pid)!
    const lease = leaseFor(fixture)
    const journal = new AttemptJournal(fixture.statePath, fixture.leaseSealer)
    const record = createAttemptRecord(
      fixture.job,
      lease,
      fixture.root,
      fixture.worktree,
      'old-incarnation',
      'boot-a',
      Date.now()
    )
    Object.assign(record, { phase: 'running', pid, processStart: start, processGroupId: pgid })
    journal.write(record)
    const calls: string[] = []
    const restarted = createWorker(fixture, queue(calls), 'boot-a')
    expect(await restarted.reconcile()).toBe('running')
    await restarted.cancel(lease, 50)
    await restarted.drainRecovery()
    expect(calls).toContain('stopped:true')
    expect(JSON.parse(readFileSync(fixture.statePath, 'utf8')).phase).toBe('settled')
  })

  it('catches and journals recovered watcher finalizer failures and resolves its drain promise', async () => {
    const fixture = createFixture('process.exit(0)\n')
    const journal = new AttemptJournal(fixture.statePath, fixture.leaseSealer)
    const record = createAttemptRecord(
      fixture.job,
      leaseFor(fixture),
      fixture.root,
      fixture.worktree,
      'recovered-incarnation',
      'boot-a',
      Date.now()
    )
    record.phase = 'settled'
    journal.write(record)
    const lock = new WorkerInstanceLock(`${fixture.statePath}.worker-lock`)
    lock.acquire('boot-a')
    const ownerPath = `${fixture.statePath}.worker-lock/owner.json`
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as { lockId: string }
    writeFileSync(ownerPath, JSON.stringify({ ...owner, lockId: 'external-replacement' }))
    await manageRecoveredWatcher(Promise.resolve(), {
      record,
      journal,
      lock,
      releaseReservationIfSettled: () => undefined,
      onFinished: () => undefined
    })
    expect(journal.read()?.phase).toBe('settled')
    expect(journal.read()?.recoveryError).toMatch(/identity changed/)
  })

  it('applies only the remaining launch wall time after recovery', async () => {
    const fixture = createFixture("process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)\n")
    fixture.job.caps = { ...fixture.job.caps, wallTimeMs: 1400 }
    const child = spawn(fixture.executable, [], {
      cwd: fixture.worktree,
      detached: true,
      shell: false,
      stdio: 'ignore'
    })
    await waitFor(() => Boolean(child.pid && processStart(child.pid)))
    const lease = leaseFor(fixture)
    const journal = new AttemptJournal(fixture.statePath, fixture.leaseSealer)
    const record = createAttemptRecord(
      fixture.job,
      lease,
      fixture.root,
      fixture.worktree,
      'previous-incarnation',
      'boot-a',
      Date.now() - 1300
    )
    Object.assign(record, {
      phase: 'running',
      pid: child.pid!,
      processStart: processStart(child.pid!)!,
      processGroupId: processGroup(child.pid!)
    })
    journal.write(record)
    const calls: string[] = []
    const restarted = createWorker(fixture, queue(calls), 'boot-a')
    const start = Date.now()
    expect(await restarted.reconcile()).toBe('running')
    await waitFor(() => JSON.parse(readFileSync(fixture.statePath, 'utf8')).phase === 'settled')
    await restarted.drainRecovery()
    expect(Date.now() - start).toBeLessThan(2500)
    expect(calls.some((call) => call.includes('stop_reason:original-wall-time-deadline'))).toBe(
      true
    )
    expect(processStart(child.pid!)).toBeNull()
  })

  it('rejects concurrent claims before a second process can start', async () => {
    const fixture = createFixture('setTimeout(() => process.exit(0), 200)\n')
    const worker = createWorker(fixture, queue([]))
    const first = worker.runClaim(envelope(fixture))
    await expect(createWorker(fixture, queue([])).runClaim(envelope(fixture))).rejects.toThrow(
      /lock/
    )
    await first
  })

  it('keeps the attempt fenced when result publication is rejected by the queue', async () => {
    const fixture = createFixture('process.exit(0)\n')
    const port = queue([])
    port.settle = async () => {
      throw new Error('lease lost')
    }
    const worker = createWorker(fixture, port)
    await worker.runClaim(envelope(fixture))
    expect(JSON.parse(readFileSync(fixture.statePath, 'utf8')).phase).toBe('ambiguous')
    await expect(worker.runClaim(envelope(fixture))).rejects.toThrow(/durable attempt/)
  })
})

type Fixture = {
  dir: string
  root: string
  worktree: string
  executable: string
  statePath: string
  childPidPath: string
  job: WorkerJob
  registry: WorkerRegistry
  leaseSealer: { seal(token: string): string; unseal(sealed: string): string }
}
function createFixture(source: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'dobius-worker-'))
  dirs.push(dir)
  const root = join(dir, 'repo')
  mkdirSync(root)
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'fixture@example.invalid'])
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Fixture'])
  writeFileSync(join(root, 'tracked.txt'), 'fixture\n')
  execFileSync('git', ['-C', root, 'add', 'tracked.txt'])
  execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture'])
  const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8'
  }).trim()
  const worktree = join(dir, 'worktree')
  execFileSync('git', ['-C', root, 'worktree', 'add', '--quiet', '--detach', worktree, revision])
  const executable = join(dir, 'fixture-executable')
  writeFileSync(
    executable,
    `#!/usr/bin/env node\n${source.replaceAll('__CHILD_PID_FILE__', JSON.stringify(join(dir, 'child.pid')))}`
  )
  chmodSync(executable, 0o700)
  const caps = {
    wallTimeMs: 5000,
    outputBytes: 4096,
    artifactBytes: 2048,
    memoryBytes: 512 * 1024 * 1024,
    cpuCount: 1
  }
  const job: WorkerJob = {
    id: 'job-1',
    attemptId: 'attempt-1',
    deviceId: 'device-1',
    recipeId: 'fixture-recipe',
    rootId: 'root-1',
    sourceRevision: revision,
    profileId: 'fixture',
    worktreeId: 'fixture-wt',
    caps
  }
  const registry: WorkerRegistry = {
    workerId: 'worker-profile-1',
    deviceId: 'device-1',
    roots: [
      {
        id: 'root-1',
        canonicalPath: root,
        allowedRecipes: ['fixture-recipe'],
        allowedWorktrees: ['fixture-wt']
      }
    ],
    worktrees: [{ id: 'fixture-wt', rootId: 'root-1', canonicalPath: realpathSync(worktree) }],
    profiles: [],
    recipes: [
      { id: 'fixture-recipe', executable, argv: ['{worktree}', '{revision}'], maxCaps: caps }
    ]
  }
  const key = randomBytes(32)
  const leaseSealer = {
    seal(token: string) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
      return `sealed:v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')}`
    },
    unseal(sealed: string) {
      const value = Buffer.from(sealed.slice('sealed:v1:'.length), 'base64')
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')
    }
  }
  return {
    dir,
    root,
    worktree,
    executable,
    statePath: join(dir, 'state', 'attempt.json'),
    childPidPath: join(dir, 'child.pid'),
    job,
    registry: {
      ...registry,
      roots: [{ ...registry.roots[0]!, canonicalPath: realpathSync(root) }]
    },
    leaseSealer
  }
}
function createHermesFixture() {
  const fixture = createFixture("require('node:fs').writeFileSync('marker', 'spawned')\n")
  fixture.job.profileId = 'hermes-1'
  fixture.registry.recipes[0]!.hermesProfileId = 'hermes-1'
  fixture.registry.profiles = HERMES_PROFILE_IDS.map((id, index) => {
    const home = join(fixture.dir, `private-home-${index}`)
    mkdirSync(home, { mode: 0o700 })
    chmodSync(home, 0o700)
    return {
      id,
      home: realpathSync(home),
      worktreeId: index === 0 ? 'fixture-wt' : `other-worktree-${index}`,
      allowedRoots: ['root-1'],
      allowedRecipes: ['fixture-recipe'],
      credentialRef: `credential-${index}`,
      authVerified: true,
      runtimeVerified: true
    }
  })
  return fixture
}
function leaseFor(fixture: Fixture): WorkerLease {
  return {
    attemptId: fixture.job.attemptId,
    workerId: fixture.registry.workerId,
    token: 't'.repeat(40),
    expiresAt: Date.now() + 60_000
  }
}
function envelope(fixture: Fixture, overrides: Partial<WorkerJob['caps']> = {}) {
  return {
    ...leaseFor(fixture),
    job: { ...fixture.job, caps: { ...fixture.job.caps, ...overrides } }
  }
}
function createWorker(
  fixture: Fixture,
  port: QueuePort,
  bootId = 'boot-a',
  now?: () => number,
  statePath = fixture.statePath,
  heartbeatMs?: number,
  processInspection?: {
    processStart(pid: number): string | null
    processGroup(pid: number): number | null
  }
) {
  return new WorkstationWorker({
    registry: fixture.registry,
    statePath,
    coordinationPath: join(fixture.dir, 'coordination'),
    queue: port,
    bootId,
    now,
    heartbeatMs,
    leaseSealer: fixture.leaseSealer,
    processInspection
  })
}
function queue(calls: string[]): QueuePort {
  return {
    claim: async () => null,
    authorizeStart: async (lease, binding) => ({
      permitId: 'permit-1',
      ...binding,
      attemptId: lease.attemptId,
      workerId: lease.workerId,
      expiresAt: lease.expiresAt
    }),
    acknowledgeStarted: async () => undefined,
    reconcile: async () => 'owned',
    heartbeat: async (lease) => lease,
    settle: async (_lease, result) => {
      calls.push(`settle:${result.succeeded}`, ...result.evidence)
    },
    acknowledgeStopped: async (_lease, receipt) => {
      calls.push(`stopped:${receipt.descendantsAbsent}`)
    }
  }
}
async function waitFor(test: () => boolean) {
  const deadline = Date.now() + 3000
  while (!test() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  if (!test()) {
    throw new Error('Fixture condition timed out.')
  }
}
