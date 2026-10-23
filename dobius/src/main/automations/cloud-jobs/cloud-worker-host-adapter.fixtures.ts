import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerClaim, WorkerLease } from '../../../shared/workstation-worker'
import type { WorkerJournalLeaseObservation } from '../workstation-worker/lease-observation'
import { CloudWorkerQueuePort } from './cloud-worker-queue-port'
import { CloudJobStore } from './store'
import { createCloudWorkerHostCallbacks } from './cloud-worker-host-adapter'

export function hostFixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-worker-host-')))
  const database = join(directory, 'jobs.sqlite')
  let time = 100_000
  let store = new CloudJobStore(database, () => time, { localDeviceId: 'device' })
  store.registerProject({
    id: 'project',
    deviceId: 'device',
    root: directory,
    recipes: ['verify'],
    capability: 'portable'
  })
  store.setDispatchEnabled(true)
  const observation = new Map<string, WorkerJournalLeaseObservation>([
    ['worker-1', { kind: 'fresh' }],
    ['worker-2', { kind: 'fresh' }]
  ])
  const workers = ['worker-1', 'worker-2'].map((workerId) => ({
    workerId,
    worker: { observePrivateLease: () => observation.get(workerId)! }
  }))
  const callbacks = () => createCloudWorkerHostCallbacks(store, workers)
  const port = (workerId = 'worker-1') =>
    new CloudWorkerQueuePort({
      store,
      now: () => time,
      enrollment: {
        workerId,
        deviceId: 'device',
        capabilities: ['portable'],
        assignments: [
          {
            projectId: 'project',
            rootId: 'root',
            worktreeId: `worktree-${workerId}`,
            recipeId: 'verify',
            profileId: workerId === 'worker-1' ? 'hermes-1' : 'hermes-2',
            minimumWorkingBytes: 100,
            caps: {
              wallTimeMs: 1000,
              outputBytes: 1024,
              artifactBytes: 0,
              memoryBytes: 1024,
              cpuCount: 1
            }
          }
        ]
      },
      readCapacity: () => ({
        freeBytes: 1000,
        externalReservedBytes: 0,
        safetyBytes: 100,
        sampledAt: time
      })
    })
  const claim = async (workerId = 'worker-1', requestKey = 'request') => {
    store.submit(
      {
        requestKey,
        taskId: 'task',
        projectId: 'project',
        workspaceId: 'workspace',
        targetDeviceId: 'device',
        recipeId: 'verify',
        title: 'Synthetic verification',
        sourceRevision: 'a'.repeat(40),
        estimatedBytes: 10,
        dependencies: []
      },
      'fixture'
    )
    const result = await port(workerId).claim(workerId)
    if (!result) {
      throw new Error('Fixture claim unavailable')
    }
    return result
  }
  const reserved = () =>
    Number(
      store.db
        .prepare('SELECT COALESCE(sum(bytes),0) AS bytes FROM cloud_capacity_reservations')
        .get()!.bytes
    )
  const permit = async (claim: WorkerClaim) =>
    port(claim.workerId).authorizeStart(leaseOf(claim), {
      attemptId: claim.attemptId,
      workerId: claim.workerId,
      deviceId: claim.job.deviceId,
      profileId: claim.job.profileId,
      rootId: claim.job.rootId,
      worktreeId: claim.job.worktreeId,
      recipeId: claim.job.recipeId,
      sourceRevision: claim.job.sourceRevision,
      caps: claim.job.caps
    })
  return {
    database,
    observation,
    callbacks,
    port,
    claim,
    permit,
    reserved,
    get store() {
      return store
    },
    advance(ms: number) {
      time += ms
    },
    reopen() {
      store.close()
      store = new CloudJobStore(database, () => time, { localDeviceId: 'device' })
    },
    cleanup() {
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

export function leaseOf(claim: WorkerClaim): WorkerLease {
  return {
    attemptId: claim.attemptId,
    workerId: claim.workerId,
    token: claim.token,
    expiresAt: claim.expiresAt
  }
}
