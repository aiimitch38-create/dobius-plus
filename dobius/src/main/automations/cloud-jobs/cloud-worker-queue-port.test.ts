import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { QueuePort, WorkerClaim } from '../../../shared/workstation-worker'
import {
  CloudWorkerCapacitySample,
  CloudWorkerEnrollment,
  DEFAULT_MINIMUM_WORKING_BYTES,
  type CloudWorkerStartBinding
} from '../../../shared/cloud-worker-enrollment'
import { CloudJobStore } from './store'
import { CloudWorkerQueuePort } from './cloud-worker-queue-port'

let directory: string
let time: number
let store: CloudJobStore
const others: CloudJobStore[] = []

const input = (requestKey: string, estimatedBytes = 10) => ({
  requestKey,
  taskId: 'task-1',
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  targetDeviceId: 'laptop',
  recipeId: 'verify',
  title: 'Verify frozen source',
  sourceRevision: 'a'.repeat(40),
  estimatedBytes,
  dependencies: []
})

function makePort(
  workerId = 'worker-1',
  profileId = 'hermes-1',
  targetStore = store,
  minimumWorkingBytes = 100,
  capacitySample?: CloudWorkerCapacitySample
) {
  return new CloudWorkerQueuePort({
    store: targetStore,
    enrollment: {
      workerId,
      deviceId: 'laptop',
      capabilities: ['macos'],
      assignments: [
        {
          projectId: 'project-1',
          rootId: 'root-1',
          worktreeId: 'worktree-1',
          recipeId: 'verify',
          profileId,
          minimumWorkingBytes,
          caps: {
            wallTimeMs: 60_000,
            outputBytes: 4096,
            artifactBytes: 1024,
            memoryBytes: 512 * 1024 * 1024,
            cpuCount: 1
          }
        }
      ]
    },
    readCapacity: (deviceId) => {
      if (deviceId !== 'laptop') {
        throw new Error('Unexpected device requested')
      }
      return (
        capacitySample ?? {
          freeBytes: 1000,
          externalReservedBytes: 100,
          safetyBytes: 100,
          sampledAt: time
        }
      )
    },
    now: () => time
  })
}

function claimed(port: QueuePort, workerId = 'worker-1'): Promise<WorkerClaim> {
  return port.claim(workerId).then((claim) => {
    if (!claim) {
      throw new Error('Expected a worker claim')
    }
    return claim
  })
}

function leaseOf(claim: WorkerClaim) {
  return {
    attemptId: claim.attemptId,
    workerId: claim.workerId,
    token: claim.token,
    expiresAt: claim.expiresAt
  }
}

function identity(claim: WorkerClaim) {
  return {
    pid: 5001,
    processStart: `start-${claim.attemptId}`,
    processGroupId: 5001,
    bootId: 'boot-test',
    incarnation: `inc-${claim.attemptId}`
  }
}

function bindingOf(claim: WorkerClaim): CloudWorkerStartBinding {
  return {
    attemptId: claim.attemptId,
    workerId: claim.workerId,
    deviceId: claim.job.deviceId,
    profileId: claim.job.profileId,
    rootId: claim.job.rootId,
    worktreeId: claim.job.worktreeId,
    recipeId: claim.job.recipeId,
    sourceRevision: claim.job.sourceRevision,
    caps: claim.job.caps
  }
}

function reservationBytes(targetStore = store): number {
  return Number(
    targetStore.db
      .prepare(
        'SELECT COALESCE(sum(bytes), 0) AS bytes FROM cloud_capacity_reservations WHERE device_id=?'
      )
      .get('laptop')?.bytes
  )
}

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-worker-queue-port-')))
  time = 100_000
  store = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, { localDeviceId: 'laptop' })
  store.registerProject({
    id: 'project-1',
    deviceId: 'laptop',
    root: directory,
    recipes: ['verify'],
    capability: 'macos'
  })
  store.setDispatchEnabled(true)
})

afterEach(() => {
  others.splice(0).forEach((other) => other.close())
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('trusted in-process C02/C05 QueuePort adapter', () => {
  it('conforms to QueuePort and derives claim IDs, profile, root, worktree, recipe and caps from enrollment', async () => {
    const port: QueuePort = makePort()
    const job = store.submit(input('request-1'), 'phone')
    const claim = await claimed(port)
    expect(claim).toMatchObject({
      job: {
        id: job.id,
        attemptId: claim.attemptId,
        deviceId: 'laptop',
        recipeId: 'verify',
        rootId: 'root-1',
        worktreeId: 'worktree-1',
        profileId: 'hermes-1',
        sourceRevision: 'a'.repeat(40),
        caps: { wallTimeMs: 60_000, outputBytes: 4096 }
      },
      workerId: 'worker-1'
    })
    await expect(port.claim('other-worker')).rejects.toThrow('does not match')
  })

  it('issues an exact-binding durable permit idempotently and binds one immutable started identity', async () => {
    store.submit(input('request-1'), 'phone')
    const port = makePort()
    const claim = await claimed(port)
    const lease = leaseOf(claim)
    const binding = bindingOf(claim)
    const first = await port.authorizeStart(lease, binding)
    const replay = await port.authorizeStart(lease, binding)
    expect(replay).toEqual(first)
    expect(store.db.prepare('SELECT count(*) AS n FROM cloud_worker_permits').get()?.n).toBe(1)

    await expect(
      port.authorizeStart(lease, { ...binding, sourceRevision: 'b'.repeat(40) })
    ).rejects.toThrow('binding')
    expect(() =>
      store.acknowledgeWorkerStarted({
        attemptId: lease.attemptId,
        workerId: lease.workerId,
        token: lease.token,
        permitId: 'forged-permit',
        identityInput: identity(claim)
      })
    ).toThrow('current durable start permit')

    const process = identity(claim)
    const beforeStart = store.get(claim.job.id)
    expect(
      store
        .events()
        .filter((event) => event.reason === 'Worker confirmed bound process start receipt')
    ).toHaveLength(0)
    await port.acknowledgeStarted(lease, process)
    const afterStart = store.get(claim.job.id)
    expect(afterStart.version).toBe(beforeStart.version + 1)
    await port.acknowledgeStarted(lease, process)
    expect(store.get(claim.job.id)).toEqual(afterStart)
    const startEvents = store
      .events()
      .filter((event) => event.reason === 'Worker confirmed bound process start receipt')
    expect(startEvents).toHaveLength(1)
    const start = store.db
      .prepare('SELECT started_at FROM cloud_worker_starts WHERE attempt_id=?')
      .get(lease.attemptId)
    expect(startEvents[0].at).toBeGreaterThanOrEqual(Number(start?.started_at))
    await expect(port.authorizeStart(lease, binding)).rejects.toThrow('consumed')
    await expect(
      port.acknowledgeStarted(lease, { ...process, pid: 5002, processGroupId: 5002 })
    ).rejects.toThrow('already bound')
    expect(store.db.prepare('SELECT count(*) AS n FROM cloud_worker_starts').get()?.n).toBe(1)
  })

  it('rejects wrong worker, token, device, stale root and stale capacity before permit persistence', async () => {
    store.submit(input('request-1'), 'phone')
    const port = makePort()
    const claim = await claimed(port)
    const lease = leaseOf(claim)
    const binding = bindingOf(claim)
    await expect(port.authorizeStart({ ...lease, workerId: 'worker-2' }, binding)).rejects.toThrow()
    await expect(port.authorizeStart({ ...lease, token: 'x'.repeat(64) }, binding)).rejects.toThrow(
      'lease'
    )
    await expect(
      port.authorizeStart(lease, { ...binding, deviceId: 'other-device' })
    ).rejects.toThrow('binding')
    const stale = new CloudWorkerQueuePort({
      store,
      enrollment: {
        workerId: 'worker-1',
        deviceId: 'laptop',
        capabilities: ['macos'],
        assignments: [
          {
            projectId: 'project-1',
            rootId: 'root-1',
            worktreeId: 'worktree-1',
            recipeId: 'verify',
            profileId: 'hermes-1',
            caps: claim.job.caps
          }
        ]
      },
      readCapacity: () => ({
        freeBytes: 1000,
        externalReservedBytes: 100,
        safetyBytes: 100,
        sampledAt: time - 90_001
      }),
      now: () => time
    })
    await expect(stale.authorizeStart(lease, binding)).rejects.toThrow('stale')
    const overcommitted = makePort('worker-1', 'hermes-1', store, 100, {
      freeBytes: 1000,
      externalReservedBytes: 900,
      safetyBytes: 100,
      sampledAt: time
    })
    await expect(overcommitted.authorizeStart(lease, binding)).rejects.toThrow('capacity')
    expect(store.db.prepare('SELECT count(*) AS n FROM cloud_worker_permits').get()?.n).toBe(0)
  })

  it('holds capacity through cancel and restart until the exact C05 stop receipt is acknowledged', async () => {
    const firstJob = store.submit(input('request-1', 600), 'phone')
    const secondJob = store.submit(input('request-2', 600), 'phone')
    const port = makePort()
    const claim = await claimed(port)
    const lease = leaseOf(claim)
    const permit = await port.authorizeStart(lease, bindingOf(claim))
    await port.acknowledgeStarted(lease, identity(claim))
    const cancelledJobId = claim.job.id
    store.cancel(cancelledJobId, store.get(cancelledJobId).version)
    expect(
      store.db.prepare('SELECT status FROM cloud_attempts WHERE id=?').get(claim.attemptId)?.status
    ).toBe('stopping')
    expect(await port.reconcile(lease, identity(claim))).toBe('stopping')
    await expect(port.heartbeat(lease, { outputBytes: 0, logCursor: 0 })).rejects.toThrow('lease')
    await expect(port.authorizeStart(lease, bindingOf(claim))).rejects.toThrow('lease')
    expect(reservationBytes()).toBe(600)

    const reopened = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, {
      localDeviceId: 'laptop'
    })
    others.push(reopened)
    const resumedPort = makePort('worker-1', 'hermes-1', reopened)
    expect(await resumedPort.reconcile(lease, identity(claim))).toBe('stopping')
    const receipt = {
      attemptId: claim.attemptId,
      workerId: claim.workerId,
      processGroupId: identity(claim).processGroupId,
      observedAt: time,
      descendantsAbsent: true as const,
      containment: 'posix-process-group' as const
    }
    await expect(
      resumedPort.acknowledgeStopped(lease, {
        ...receipt,
        processGroupId: receipt.processGroupId + 1
      })
    ).rejects.toThrow('does not identify')
    expect(reservationBytes(reopened)).toBe(600)
    await resumedPort.acknowledgeStopped(lease, receipt)
    await resumedPort.acknowledgeStopped(lease, receipt)
    expect(reservationBytes(reopened)).toBe(0)
    expect(reopened.get(cancelledJobId).state).toBe('cancelled')
    expect([firstJob.id, secondJob.id]).toContain(cancelledJobId)
    expect(permit.attemptId).toBe(claim.attemptId)
  })

  it('expires leases to stopping reconciliation and retains legacy attempts without a start receipt', async () => {
    store.submit(input('request-1'), 'phone')
    const port = makePort()
    const claim = await claimed(port)
    const lease = leaseOf(claim)
    await port.authorizeStart(lease, bindingOf(claim))
    await port.acknowledgeStarted(lease, identity(claim))
    time += 60_001
    expect(await port.reconcile(lease, identity(claim))).toBe('stopping')
    const expiredReceipt = {
      attemptId: claim.attemptId,
      workerId: claim.workerId,
      processGroupId: identity(claim).processGroupId,
      observedAt: time,
      descendantsAbsent: true as const,
      containment: 'posix-process-group' as const
    }
    await port.acknowledgeStopped(lease, expiredReceipt)
    expect(reservationBytes()).toBe(0)

    store.submit(input('request-2'), 'phone')
    const legacy = store.claim(
      {
        id: 'worker-legacy',
        deviceId: 'laptop',
        capabilities: ['macos'],
        freeBytes: 1000,
        externalReservedBytes: 100,
        safetyBytes: 100,
        sampledAt: time
      },
      [{ projectId: 'project-1', recipeId: 'verify' }]
    )!
    time += 60_001
    store.reconcileExpired()
    const proof = {
      attemptId: legacy.attemptId,
      workerId: 'worker-legacy',
      processGroupId: 7001,
      observedAt: time,
      descendantsAbsent: true,
      containment: 'posix-process-group',
      identity: identity(claim),
      bindingSha256: 'f'.repeat(64)
    }
    expect(() =>
      store.acknowledgeStopped(legacy.attemptId, 'worker-legacy', legacy.leaseToken, proof)
    ).toThrow('lack a bound process receipt')
  })

  it('maps independent Hermes profiles while device capacity remains transactionally shared', async () => {
    store.submit(input('request-1', 400), 'phone')
    store.submit(input('request-2', 400), 'phone')
    const firstPort = makePort('worker-hermes-1', 'hermes-1')
    const secondPort = makePort('worker-hermes-2', 'hermes-2')
    const first = await claimed(firstPort, 'worker-hermes-1')
    const second = await claimed(secondPort, 'worker-hermes-2')
    expect(first.job.profileId).toBe('hermes-1')
    expect(second.job.profileId).toBe('hermes-2')
    expect(first.job.id).not.toBe(second.job.id)
    expect(reservationBytes()).toBe(800)
  })

  it.each([
    { label: 'same-timestamp sample', now: 100_001 },
    { label: 'sample still fresh after one minute', now: 160_000 }
  ])('subtracts external and current queue commitments for $label', async ({ now }) => {
    const firstJob = store.submit(input('request-capacity-600', 600), 'phone')
    time += 1
    const secondJob = store.submit(input('request-capacity-250', 250), 'phone')
    time = now
    const capturedBeforeClaims = {
      freeBytes: 1000,
      externalReservedBytes: 100,
      safetyBytes: 100,
      sampledAt: 100_000
    }
    const firstPort = makePort('worker-capacity-1', 'hermes-1', store, 0, capturedBeforeClaims)
    const first = await claimed(firstPort, 'worker-capacity-1')
    expect(first.job.id).toBe(firstJob.id)
    expect(reservationBytes()).toBe(600)

    const secondPort = makePort('worker-capacity-2', 'hermes-2', store, 0, capturedBeforeClaims)
    expect(await secondPort.claim('worker-capacity-2')).toBeNull()
    expect(store.get(secondJob.id).waitingReason).toContain('storage')
    expect(reservationBytes()).toBe(600)
  })

  it('fails closed on the legacy ambiguous total-reservations DTO', () => {
    expect(
      CloudWorkerCapacitySample.safeParse({
        freeBytes: 1000,
        reservedBytes: 700,
        safetyBytes: 100,
        sampledAt: time
      }).success
    ).toBe(false)
  })

  it('reserves recipe working-space floors over small estimates across workers and restart', async () => {
    const firstJob = store.submit(input('request-floor-1', 10), 'phone')
    expect(store.submit(input('request-floor-1', 10), 'phone').id).toBe(firstJob.id)
    expect(() => store.submit(input('request-floor-1', 11), 'phone')).toThrow('different work')
    time += 1
    const secondJob = store.submit(input('request-floor-2', 10), 'phone')
    const firstPort = makePort('worker-floor-1', 'hermes-1', store, 600)
    const first = await claimed(firstPort, 'worker-floor-1')
    expect(first.job.id).toBe(firstJob.id)
    expect(store.get(firstJob.id).estimatedBytes).toBe(10)
    expect(reservationBytes()).toBe(600)

    const lease = leaseOf(first)
    const binding = bindingOf(first)
    store.db
      .prepare('UPDATE cloud_capacity_reservations SET bytes=? WHERE job_id=?')
      .run(10, firstJob.id)
    await expect(firstPort.authorizeStart(lease, binding)).rejects.toThrow('reservation')
    store.db
      .prepare('UPDATE cloud_capacity_reservations SET bytes=? WHERE job_id=?')
      .run(600, firstJob.id)
    await firstPort.authorizeStart(lease, binding)
    await firstPort.acknowledgeStarted(lease, identity(first))

    const reopened = new CloudJobStore(join(directory, 'jobs.sqlite'), () => time, {
      localDeviceId: 'laptop'
    })
    others.push(reopened)
    expect(reservationBytes(reopened)).toBe(600)
    expect(reopened.get(firstJob.id).estimatedBytes).toBe(10)
    const secondPort = makePort('worker-floor-2', 'hermes-2', reopened, 600)
    expect(await secondPort.claim('worker-floor-2')).toBeNull()
    expect(reopened.get(secondJob.id).state).toBe('waiting_for_worker')
    expect(reservationBytes(reopened)).toBe(600)
  })

  it('defaults unknown recipe working space conservatively and permits explicit proven no-op zero', () => {
    const assignment = {
      projectId: 'project-1',
      rootId: 'root-1',
      worktreeId: 'worktree-1',
      recipeId: 'verify',
      profileId: 'hermes-1',
      caps: {
        wallTimeMs: 60_000,
        outputBytes: 4096,
        artifactBytes: 1024,
        memoryBytes: 512 * 1024 * 1024,
        cpuCount: 1
      }
    }
    const enrollment = CloudWorkerEnrollment.parse({
      workerId: 'worker-default-floor',
      deviceId: 'laptop',
      capabilities: ['macos'],
      assignments: [assignment]
    })
    expect(enrollment.assignments[0]?.minimumWorkingBytes).toBe(DEFAULT_MINIMUM_WORKING_BYTES)
    expect(
      CloudWorkerEnrollment.parse({
        ...enrollment,
        assignments: [{ ...assignment, minimumWorkingBytes: 0 }]
      }).assignments[0]?.minimumWorkingBytes
    ).toBe(0)
  })

  it('settles only with its exact started attempt and keeps successful work in needs_review', async () => {
    const job = store.submit(input('request-1', 250), 'phone')
    const port = makePort()
    const claim = await claimed(port)
    const lease = leaseOf(claim)
    await port.authorizeStart(lease, bindingOf(claim))
    await port.acknowledgeStarted(lease, identity(claim))
    await expect(
      port.settle(lease, { succeeded: true, exitCode: 1, evidence: ['test:pass'] })
    ).rejects.toThrow('zero exit code')
    await port.settle(lease, { succeeded: true, exitCode: 0, evidence: ['test:pass'] })
    await port.settle(lease, { succeeded: true, exitCode: 0, evidence: ['test:pass'] })
    expect(store.get(job.id).state).toBe('needs_review')
    expect(reservationBytes()).toBe(0)
  })

  it('records a failed zero-exit artifact result and releases capacity after its started attempt settles', async () => {
    const job = store.submit(input('request-artifact-invalid', 250), 'phone')
    const port = makePort()
    const claim = await claimed(port)
    const lease = leaseOf(claim)
    await port.authorizeStart(lease, bindingOf(claim))
    await port.acknowledgeStarted(lease, identity(claim))

    await expect(
      port.settle(lease, {
        succeeded: false,
        exitCode: 0,
        evidence: ['artifact_evidence:invalid:missing-required-report']
      })
    ).resolves.toBeUndefined()
    expect(store.get(job.id)).toMatchObject({
      state: 'failed',
      outcome: 'Executor exited with code 0.',
      evidence: ['artifact_evidence:invalid:missing-required-report']
    })
    expect(reservationBytes()).toBe(0)
  })

  it('rejects ambiguous or caller-added enrollment fields at construction', () => {
    const caps = {
      wallTimeMs: 60_000,
      outputBytes: 4096,
      artifactBytes: 1024,
      memoryBytes: 512 * 1024 * 1024,
      cpuCount: 1
    }
    expect(
      () =>
        new CloudWorkerQueuePort({
          store,
          enrollment: {
            workerId: 'worker-1',
            deviceId: 'laptop',
            capabilities: ['macos'],
            callerControlsRoot: true,
            assignments: []
          },
          readCapacity: () => ({
            freeBytes: 1,
            externalReservedBytes: 0,
            safetyBytes: 0,
            sampledAt: time
          })
        })
    ).toThrow()
    expect(
      () =>
        new CloudWorkerQueuePort({
          store,
          enrollment: {
            workerId: 'worker-1',
            deviceId: 'laptop',
            capabilities: ['macos'],
            assignments: [
              {
                projectId: 'project-1',
                rootId: 'r1',
                worktreeId: 'w1',
                recipeId: 'verify',
                profileId: 'hermes-1',
                caps
              },
              {
                projectId: 'project-1',
                rootId: 'r2',
                worktreeId: 'w2',
                recipeId: 'verify',
                profileId: 'hermes-2',
                caps
              }
            ]
          },
          readCapacity: () => ({
            freeBytes: 1,
            externalReservedBytes: 0,
            safetyBytes: 0,
            sampledAt: time
          })
        })
    ).toThrow()
  })
})
