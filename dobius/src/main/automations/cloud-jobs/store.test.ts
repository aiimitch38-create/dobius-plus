import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CloudJobStore } from './store'
import {
  CloudJobInput,
  type CloudJobInput as CloudJobInputType,
  type CloudWorker
} from '../../../shared/cloud-jobs'
import type { CloudWorkerStartBinding } from '../../../shared/cloud-worker-enrollment'

let directory: string
let time: number
let store: CloudJobStore
const others: CloudJobStore[] = []
const input = (key = 'request-1', extra: Partial<CloudJobInputType> = {}): CloudJobInputType => ({
  requestKey: key,
  taskId: 'task-1',
  projectId: 'project-1',
  workspaceId: 'phone-space',
  targetDeviceId: 'laptop',
  recipeId: 'test',
  title: 'Verify project',
  sourceRevision: 'a'.repeat(40),
  estimatedBytes: 10,
  dependencies: [],
  ...extra
})
const worker = (extra: Partial<CloudWorker> = {}): CloudWorker => ({
  id: 'worker-1',
  deviceId: 'laptop',
  capabilities: ['macos'],
  freeBytes: 1000,
  externalReservedBytes: 100,
  safetyBytes: 100,
  sampledAt: time,
  ...extra
})
function claim() {
  const result = store.claim(worker())
  if (!result) {
    throw new Error('Expected claim')
  }
  return result
}
function finish() {
  const lease = claim()
  startFor(lease)
  const review = store.settle(lease.attemptId, 'worker-1', lease.leaseToken, {
    succeeded: true,
    evidence: ['test-result:sha256:a'],
    outcome: 'Tests passed'
  })
  return store.accept(review.id, review.version, 'independent-review:sha256:b')
}

function startFor(lease: ReturnType<typeof claim>) {
  const job = store.getWorkerAttemptJob({
    attemptId: lease.attemptId,
    workerId: 'worker-1',
    token: lease.leaseToken
  })
  const binding: CloudWorkerStartBinding = {
    attemptId: lease.attemptId,
    workerId: 'worker-1',
    deviceId: 'laptop',
    profileId: 'hermes-1',
    rootId: 'root-1',
    worktreeId: 'worktree-1',
    recipeId: job.recipeId,
    sourceRevision: job.sourceRevision,
    caps: {
      wallTimeMs: 60_000,
      outputBytes: 1024,
      artifactBytes: 0,
      memoryBytes: 1024 * 1024,
      cpuCount: 1
    }
  }
  const permit = store.authorizeWorkerStart({
    attemptId: lease.attemptId,
    workerId: 'worker-1',
    token: lease.leaseToken,
    deviceId: 'laptop',
    projectId: job.projectId,
    minimumWorkingBytes: 0,
    bindingInput: binding,
    permitInput: {
      ...binding,
      permitId: `permit-${lease.attemptId}`,
      expiresAt: Math.min(lease.leaseExpiresAt, time + 15_000)
    },
    capacityInput: {
      freeBytes: 1000,
      externalReservedBytes: 100,
      safetyBytes: 100,
      sampledAt: time
    }
  })
  const identity = {
    pid: 4242,
    processStart: `start-${lease.attemptId}`,
    processGroupId: 4242,
    bootId: 'boot-test',
    incarnation: `inc-${lease.attemptId}`
  }
  store.acknowledgeWorkerStarted({
    attemptId: lease.attemptId,
    workerId: 'worker-1',
    token: lease.leaseToken,
    permitId: permit.permitId,
    identityInput: identity
  })
  return { identity }
}

function stopProof(lease: ReturnType<typeof claim>, workerId = 'worker-1') {
  const start = store.getWorkerStartRecord(lease.attemptId, 'worker-1', lease.leaseToken)
  return {
    attemptId: lease.attemptId,
    workerId,
    processGroupId: start.identity.processGroupId,
    observedAt: time,
    descendantsAbsent: true as const,
    containment: 'posix-process-group' as const,
    identity: start.identity,
    bindingSha256: start.bindingHash
  }
}

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-cloud-queue-')))
  time = 100_000
  store = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, {
    localDeviceId: 'laptop'
  })
  store.registerProject({
    id: 'project-1',
    deviceId: 'laptop',
    root: directory,
    recipes: ['test'],
    capability: 'macos'
  })
})
afterEach(() => {
  others.splice(0).forEach((other) => other.close())
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('durable cloud jobs', () => {
  it('starts paused, persists explicit enablement and preserves jobs after reopening', () => {
    const job = store.submit(input(), 'phone-1')
    expect(store.claim(worker())).toBeNull()
    store.setDispatchEnabled(true)
    const other = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, {
      localDeviceId: 'laptop'
    })
    others.push(other)
    expect(other.isDispatchEnabled()).toBe(true)
    expect(other.get(job.id)).toEqual(job)
  })

  it('deduplicates exact submissions but refuses request-key reuse with other content', () => {
    const job = store.submit(input(), 'phone-1')
    expect(store.submit(input(), 'phone-1')).toEqual(job)
    expect(() => store.submit(input('request-1', { title: 'Different work' }), 'phone-1')).toThrow(
      'different work'
    )
    expect(store.list()).toHaveLength(1)
    expect(store.events()).toHaveLength(1)
  })

  it('refuses unknown projects, mismatched targets, undeclared recipes and missing dependencies', () => {
    for (const extra of [
      { projectId: 'unknown' },
      { targetDeviceId: 'vps' },
      { recipeId: 'delete-everything' },
      { dependencies: ['unknown'] }
    ]) {
      expect(() => store.submit(input('bad', extra), 'phone-1')).toThrow()
    }
    expect(store.list()).toEqual([])
  })

  it('keeps local project roots bound to real directories and rechecks them before claims', () => {
    const localRoot = join(directory, 'project-root')
    mkdirSync(localRoot)
    store.registerProject({
      id: 'local-project',
      deviceId: 'laptop',
      root: localRoot,
      recipes: ['test'],
      capability: 'macos'
    })
    const alias = join(directory, 'project-root-link')
    symlinkSync(localRoot, alias)
    expect(() =>
      store.registerProject({
        id: 'symlink-project',
        deviceId: 'laptop',
        root: alias,
        recipes: ['test'],
        capability: 'macos'
      })
    ).toThrow('not verified')
    store.setDispatchEnabled(true)
    const job = store.submit(input('local-root', { projectId: 'local-project' }), 'phone-1')
    rmdirSync(localRoot)
    expect(store.claim(worker())).toBeNull()
    expect(store.get(job.id).waitingReason).toContain('Project root changed')
  })

  it('two independent connections cannot claim the same job', () => {
    store.setDispatchEnabled(true)
    const job = store.submit(input(), 'phone-1')
    const other = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, {
      localDeviceId: 'laptop'
    })
    others.push(other)
    expect(claim().job.id).toBe(job.id)
    expect(other.claim(worker({ id: 'worker-2' }))).toBeNull()
    expect(store.events().map((event) => event.state)).toEqual(['queued', 'running'])
  })

  it('blocks dispatch on low space and releases waiting only after a fresh safe report', () => {
    store.setDispatchEnabled(true)
    const job = store.submit(input(), 'phone-1')
    expect(store.claim(worker({ freeBytes: 105 }))).toBeNull()
    expect(store.get(job.id).waitingReason).toContain('storage')
    expect(store.claim(worker({ freeBytes: 105 }))).toBeNull()
    expect(store.events()).toHaveLength(2)
    expect(claim().job.state).toBe('running')
  })

  it('accepts only 40- or 64-character lowercase hexadecimal source revisions', () => {
    for (const length of [40, 64]) {
      expect(
        CloudJobInput.parse(input('revision', { sourceRevision: 'a'.repeat(length) }))
      ).toBeDefined()
    }
    for (const length of [39, 41, 63, 65]) {
      expect(() =>
        CloudJobInput.parse(input('revision', { sourceRevision: 'a'.repeat(length) }))
      ).toThrow()
    }
    expect(() =>
      CloudJobInput.parse(input('revision', { sourceRevision: 'A'.repeat(40) }))
    ).toThrow()
  })

  it('reserves capacity transactionally across worker IDs for the same device', () => {
    store.setDispatchEnabled(true)
    const first = store.submit(input('request-1', { estimatedBytes: 600 }), 'phone-1')
    time += 1
    const second = store.submit(input('request-2', { estimatedBytes: 600 }), 'phone-1')
    expect(store.claim(worker({ id: 'worker-1' }))?.job.id).toBe(first.id)
    expect(store.claim(worker({ id: 'worker-2' }))).toBeNull()
    expect(store.get(second.id).waitingReason).toContain('storage')
    expect(
      store.db
        .prepare('SELECT sum(bytes) AS reserved FROM cloud_capacity_reservations WHERE device_id=?')
        .get('laptop')?.reserved
    ).toBe(600)
  })

  it('adds persisted queue reservations once to explicit external capacity components', () => {
    store.setDispatchEnabled(true)
    const first = store.submit(input('request-1', { estimatedBytes: 600 }), 'phone-1')
    time += 1
    const second = store.submit(input('request-2', { estimatedBytes: 150 }), 'phone-1')
    expect(store.claim(worker({ id: 'worker-1' }))?.job.id).toBe(first.id)
    // Queue-owned bytes are stored separately; the sample reports only external commitments.
    expect(store.claim(worker({ id: 'worker-2', externalReservedBytes: 100 }))?.job.id).toBe(
      second.id
    )
  })

  it('rejects stale, future and invalid capacity readings or incompatible workers', () => {
    store.setDispatchEnabled(true)
    const job = store.submit(input(), 'phone-1')
    for (const extra of [
      { sampledAt: 1 },
      { sampledAt: time + 1 },
      { freeBytes: NaN },
      { capabilities: ['linux'] }
    ]) {
      expect(store.claim(worker(extra))).toBeNull()
      expect(store.get(job.id).state).toBe('waiting_for_worker')
    }
  })

  it('success requires separate evidence-bearing acceptance and stale acceptance fails', () => {
    store.setDispatchEnabled(true)
    store.submit(input(), 'phone-1')
    const lease = claim()
    startFor(lease)
    const review = store.settle(lease.attemptId, 'worker-1', lease.leaseToken, {
      succeeded: true,
      evidence: ['artifact:one'],
      outcome: 'Exit 0'
    })
    expect(review.state).toBe('needs_review')
    expect(() => store.accept(review.id, review.version - 1, 'review:one')).toThrow()
    expect(() => store.accept(review.id, review.version, '')).toThrow()
    expect(store.accept(review.id, review.version, 'review:one').state).toBe('completed')
  })

  it('will not accept a successful execution with missing evidence', () => {
    store.setDispatchEnabled(true)
    store.submit(input(), 'phone-1')
    const lease = claim()
    startFor(lease)
    const review = store.settle(lease.attemptId, 'worker-1', lease.leaseToken, {
      succeeded: true,
      evidence: [],
      outcome: 'Claimed success'
    })
    expect(() => store.accept(review.id, review.version, 'review')).toThrow('evidence')
  })

  it('dependencies wait for verified completion rather than agent success', () => {
    store.setDispatchEnabled(true)
    const first = store.submit(input(), 'phone-1')
    const next = store.submit(input('request-2', { dependencies: [first.id] }), 'phone-1')
    const lease = claim()
    startFor(lease)
    const review = store.settle(lease.attemptId, 'worker-1', lease.leaseToken, {
      succeeded: true,
      evidence: ['test:pass'],
      outcome: 'Ready'
    })
    expect(store.claim(worker())).toBeNull()
    expect(store.get(next.id).waitingReason).toContain('dependency')
    store.accept(first.id, review.version, 'review:pass')
    expect(claim().job.id).toBe(next.id)
  })

  it('expired lease fences late success and holds the worker until process cleanup', () => {
    store.setDispatchEnabled(true)
    const job = store.submit(input(), 'phone-1')
    const lease = claim()
    startFor(lease)
    time += 60_001
    expect(store.claim(worker())).toBeNull()
    expect(store.get(job.id).state).toBe('interrupted')
    expect(() =>
      store.settle(lease.attemptId, 'worker-1', lease.leaseToken, {
        succeeded: true,
        evidence: ['late'],
        outcome: 'Late'
      })
    ).toThrow('lease')
    expect(() => store.retry(job.id, store.get(job.id).version)).toThrow('reconciled')
    store.acknowledgeStopped(lease.attemptId, 'worker-1', lease.leaseToken, stopProof(lease))
    const updated = store.get(job.id)
    store.retry(job.id, updated.version)
    expect(claim().job.attemptCount).toBe(2)
  })

  it('cancel fences heartbeat, retains the worker slot and requires owned cleanup receipt', () => {
    store.setDispatchEnabled(true)
    store.submit(input(), 'phone-1')
    time += 1
    store.submit(input('request-2'), 'phone-1')
    const lease = claim()
    startFor(lease)
    expect(() => store.cancel(lease.job.id, lease.job.version - 1)).toThrow('changed')
    store.cancel(lease.job.id, store.get(lease.job.id).version)
    expect(() => store.heartbeat(lease.attemptId, 'worker-1', lease.leaseToken)).toThrow('lease')
    expect(store.claim(worker())).toBeNull()
    expect(() =>
      store.acknowledgeStopped(
        lease.attemptId,
        'other-worker',
        lease.leaseToken,
        stopProof(lease, 'other-worker')
      )
    ).toThrow('does not own')
    store.acknowledgeStopped(lease.attemptId, 'worker-1', lease.leaseToken, stopProof(lease))
    expect(claim().job.requestKey).toBe('request-2')
  })

  it('holds a cancelled job reservation through stop cleanup, then releases it', () => {
    store.setDispatchEnabled(true)
    const cancelled = store.submit(input('request-1', { estimatedBytes: 600 }), 'phone-1')
    time += 1
    const next = store.submit(input('request-2', { estimatedBytes: 600 }), 'phone-1')
    const lease = claim()
    startFor(lease)
    store.cancel(cancelled.id, store.get(cancelled.id).version)
    expect(store.claim(worker({ id: 'worker-2' }))).toBeNull()
    expect(
      store.db
        .prepare('SELECT bytes FROM cloud_capacity_reservations WHERE job_id=?')
        .get(cancelled.id)?.bytes
    ).toBe(600)
    expect(() =>
      store.acknowledgeStopped(
        lease.attemptId,
        'worker-2',
        lease.leaseToken,
        stopProof(lease, 'worker-2')
      )
    ).toThrow('does not own')
    store.acknowledgeStopped(lease.attemptId, 'worker-1', lease.leaseToken, stopProof(lease))
    expect(
      store.db.prepare('SELECT 1 FROM cloud_capacity_reservations WHERE job_id=?').get(cancelled.id)
    ).toBeUndefined()
    expect(store.claim(worker({ id: 'worker-2' }))?.job.id).toBe(next.id)
  })

  it('keeps expired interrupted reservations across reopen until owner-confirmed cleanup', () => {
    store.setDispatchEnabled(true)
    const active = store.submit(input('request-1', { estimatedBytes: 600 }), 'phone-1')
    time += 1
    const next = store.submit(input('request-2', { estimatedBytes: 600 }), 'phone-1')
    const lease = claim()
    startFor(lease)
    time += 60_001
    const reopened = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, {
      localDeviceId: 'laptop'
    })
    others.push(reopened)
    reopened.reconcileExpired()
    expect(reopened.get(active.id).state).toBe('interrupted')
    expect(reopened.claim(worker({ id: 'worker-2' }))).toBeNull()
    const afterRestart = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, {
      localDeviceId: 'laptop'
    })
    others.push(afterRestart)
    expect(
      afterRestart.db
        .prepare('SELECT bytes FROM cloud_capacity_reservations WHERE job_id=?')
        .get(active.id)?.bytes
    ).toBe(600)
    afterRestart.acknowledgeStopped(lease.attemptId, 'worker-1', lease.leaseToken, {
      ...stopProof(lease),
      identity: store.getWorkerStartRecord(lease.attemptId, 'worker-1', lease.leaseToken).identity
    })
    expect(afterRestart.claim(worker({ id: 'worker-2' }))?.job.id).toBe(next.id)
  })

  it('rejects stolen worker identity/token and renews only the actual active lease', () => {
    store.setDispatchEnabled(true)
    store.submit(input(), 'phone-1')
    const lease = claim()
    expect(() => store.heartbeat(lease.attemptId, 'worker-2', lease.leaseToken)).toThrow()
    expect(() => store.heartbeat(lease.attemptId, 'worker-1', 'wrong')).toThrow()
    time += 10_000
    expect(store.heartbeat(lease.attemptId, 'worker-1', lease.leaseToken)).toBe(time + 60_000)
    expect(
      readFileSync(join(directory, 'jobs.sqlite')).includes(Buffer.from(lease.leaseToken))
    ).toBe(false)
  })

  it('returns ordered bounded events for reconnects without inventing past states', () => {
    store.setDispatchEnabled(true)
    store.submit(input(), 'phone-1')
    const done = finish()
    const events = store.events()
    expect(events.map((event) => event.state)).toEqual([
      'queued',
      'running',
      'running',
      'needs_review',
      'completed'
    ])
    expect(events.every((event) => event.jobId === done.id)).toBe(true)
    expect(store.events(events[1].sequence, 1)).toEqual([events[2]])
    expect(() => store.events(-1)).toThrow()
  })

  it('does not reenable dispatch or silently retry after reopening a paused active queue', () => {
    store.setDispatchEnabled(true)
    const job = store.submit(input(), 'phone-1')
    claim()
    store.setDispatchEnabled(false)
    time += 60_001
    const other = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, {
      localDeviceId: 'laptop'
    })
    others.push(other)
    expect(other.claim(worker())).toBeNull()
    expect(other.isDispatchEnabled()).toBe(false)
    expect(other.get(job.id).state).toBe('interrupted')
    expect(other.get(job.id).attemptCount).toBe(1)
  })

  it('backfills active capacity reservations during the schema v1 migration', () => {
    store.setDispatchEnabled(true)
    const job = store.submit(input('migration', { estimatedBytes: 456 }), 'phone-1')
    claim()
    store.db.prepare('DELETE FROM cloud_capacity_reservations WHERE job_id=?').run(job.id)
    store.db.pragma('user_version = 1')
    const migrated = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, {
      localDeviceId: 'laptop'
    })
    others.push(migrated)
    expect(migrated.db.pragma('user_version', { simple: true })).toBe(4)
    expect(
      migrated.db
        .prepare('SELECT device_id, bytes FROM cloud_capacity_reservations WHERE job_id=?')
        .get(job.id)
    ).toEqual({ device_id: 'laptop', bytes: 456 })
  })

  it('migrates v2 active reservations without inventing a started process receipt', () => {
    store.setDispatchEnabled(true)
    const job = store.submit(input('v2-active', { estimatedBytes: 456 }), 'phone-1')
    const lease = claim()
    store.db.exec('DROP TABLE cloud_worker_starts; DROP TABLE cloud_worker_permits;')
    store.db.pragma('user_version = 2')
    const migrated = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, {
      localDeviceId: 'laptop'
    })
    others.push(migrated)
    expect(migrated.db.pragma('user_version', { simple: true })).toBe(4)
    expect(migrated.get(job.id).state).toBe('running')
    expect(
      migrated.db
        .prepare('SELECT bytes FROM cloud_capacity_reservations WHERE job_id=?')
        .get(job.id)?.bytes
    ).toBe(456)
    time += 60_001
    migrated.reconcileExpired()
    expect(migrated.get(job.id).state).toBe('interrupted')
    expect(() =>
      migrated.acknowledgeStopped(lease.attemptId, 'worker-1', lease.leaseToken, {
        attemptId: lease.attemptId,
        workerId: 'worker-1',
        processGroupId: 4242,
        observedAt: time,
        descendantsAbsent: true,
        containment: 'posix-process-group',
        identity: {
          pid: 4242,
          processStart: 'unknown-legacy-start',
          processGroupId: 4242,
          bootId: 'unknown-legacy-boot',
          incarnation: 'unknown-legacy-incarnation'
        },
        bindingSha256: 'f'.repeat(64)
      })
    ).toThrow('lack a bound process receipt')
    expect(
      migrated.db
        .prepare('SELECT bytes FROM cloud_capacity_reservations WHERE job_id=?')
        .get(job.id)?.bytes
    ).toBe(456)
  })

  it('fails closed on a corrupt row and future schema without overwriting it', () => {
    const job = store.submit(input(), 'phone-1')
    store.db.prepare('UPDATE cloud_jobs SET document=? WHERE id=?').run('{broken', job.id)
    expect(() => store.list()).toThrow()
    expect(
      store.db.prepare('SELECT document FROM cloud_jobs WHERE id=?').get(job.id)?.document
    ).toBe('{broken')
    store.db.pragma('user_version = 5')
    expect(() => new CloudJobStore(join(directory, 'jobs.sqlite'))).toThrow('newer')
  })

  it('creates private database/WAL files and rejects symlinked database targets', () => {
    expect(statSync(join(directory, 'jobs.sqlite')).mode & 0o777).toBe(0o600)
    expect(statSync(join(directory, 'jobs.sqlite-wal')).mode & 0o777).toBe(0o600)
    const link = join(directory, 'linked.sqlite')
    symlinkSync(join(directory, 'jobs.sqlite'), link)
    expect(() => new CloudJobStore(link)).toThrow('regular file')
  })

  it('exports a consistent SQLite backup that reopens with jobs and live reservations', async () => {
    store.setDispatchEnabled(true)
    const active = store.submit(input('backup-active', { estimatedBytes: 321 }), 'phone-1')
    claim()
    const backupPath = join(directory, 'jobs-export.sqlite')
    expect(await store.exportBackup(backupPath)).toBeGreaterThan(0)
    expect(statSync(backupPath).mode & 0o777).toBe(0o600)
    const restored = new CloudJobStore(backupPath, () => time, { localDeviceId: 'laptop' })
    others.push(restored)
    expect(restored.get(active.id).state).toBe('running')
    expect(
      restored.db
        .prepare('SELECT bytes FROM cloud_capacity_reservations WHERE job_id=?')
        .get(active.id)?.bytes
    ).toBe(321)
    expect(restored.isDispatchEnabled()).toBe(true)
    await expect(store.exportBackup(join(directory, 'jobs.sqlite'))).rejects.toThrow()
  })

  it('fails closed for remote roots without fresh exact authenticated enrollment authority', () => {
    let identity: {
      projectId: string
      deviceId: string
      root: string
      issuedAt: number
      expiresAt: number
    } | null = {
      projectId: 'remote-project',
      deviceId: 'remote-laptop',
      root: 'C:\\Users\\carson\\work',
      issuedAt: time,
      expiresAt: time + 30_000
    }
    const remote = new CloudJobStore(join(directory, 'remote.sqlite'), () => time, {
      localDeviceId: 'server',
      rootAuthority: { getFreshRoot: () => identity }
    })
    others.push(remote)
    const project = {
      id: 'remote-project',
      deviceId: 'remote-laptop',
      root: 'untrusted caller path',
      recipes: ['test'],
      capability: 'windows' as const
    }
    const withoutAuthority = new CloudJobStore(
      join(directory, 'remote-without-authority.sqlite'),
      () => time,
      { localDeviceId: 'server' }
    )
    others.push(withoutAuthority)
    expect(() => withoutAuthority.registerProject(project)).toThrow('not verified')
    identity = null
    expect(() => remote.registerProject(project)).toThrow('not verified')
    identity = {
      projectId: 'remote-project',
      deviceId: 'remote-laptop',
      root: 'C:\\Users\\carson\\work',
      issuedAt: time,
      expiresAt: time + 30_000
    }
    remote.registerProject(project)
    remote.setDispatchEnabled(true)
    const remoteJob = remote.submit(
      input('remote-job', { projectId: project.id, targetDeviceId: project.deviceId }),
      'phone-1'
    )
    identity = null
    expect(
      remote.claim(worker({ deviceId: 'remote-laptop', capabilities: ['windows'] }))
    ).toBeNull()
    identity = {
      projectId: 'remote-project',
      deviceId: 'remote-laptop',
      root: 'C:\\Users\\carson\\work',
      issuedAt: time - 90_001,
      expiresAt: time + 30_000
    }
    expect(
      remote.claim(worker({ deviceId: 'remote-laptop', capabilities: ['windows'] }))
    ).toBeNull()
    identity = {
      projectId: 'remote-project',
      deviceId: 'other-device',
      root: 'C:\\Users\\carson\\work',
      issuedAt: time,
      expiresAt: time + 30_000
    }
    expect(
      remote.claim(worker({ deviceId: 'remote-laptop', capabilities: ['windows'] }))
    ).toBeNull()
    expect(remote.get(remoteJob.id).state).toBe('waiting_for_worker')
  })
})
