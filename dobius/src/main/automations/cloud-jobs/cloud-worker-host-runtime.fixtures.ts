import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerClaim, WorkerLease } from '../../../shared/workstation-worker'
import type { WorkerJournalLeaseObservation } from '../workstation-worker/lease-observation'
import type { WorkstationWorker } from '../workstation-worker/worker'
import { CloudJobStore } from './store'
import type { CloudWorkerHostEnrollment } from './cloud-worker-host-runtime'
import type { CloudWorkerQueuePort } from './cloud-worker-queue-port'

export function hostRuntimeFixture(options: { dispatchEnabled?: boolean } = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-worker-runtime-')))
  let now = 100_000
  const store = new CloudJobStore(join(directory, 'jobs.sqlite'), () => now, {
    localDeviceId: 'device'
  })
  store.registerProject({
    id: 'project',
    deviceId: 'device',
    root: directory,
    recipes: ['verify'],
    capability: 'portable'
  })
  store.setDispatchEnabled(options.dispatchEnabled ?? false)

  const events: string[] = []
  const runs: WorkerClaim[] = []
  const workerQueues: CloudWorkerQueuePort[] = []
  const observations = new Map<string, WorkerJournalLeaseObservation>()
  const slots: CloudWorkerHostEnrollment[] = ['worker-1', 'worker-2'].map((workerId, index) => {
    observations.set(workerId, { kind: 'fresh' })
    return {
      createWorker(queue) {
        workerQueues.push(queue)
        const worker = {
          observePrivateLease: () => observations.get(workerId) ?? { kind: 'unknown' as const },
          async reconcile() {
            events.push(`reconcile:${workerId}`)
            return 'idle' as const
          },
          async runClaim(input: unknown) {
            const claim = input as WorkerClaim
            events.push(`run:${workerId}`)
            await queue.authorizeStart(
              {
                attemptId: claim.attemptId,
                workerId: claim.workerId,
                token: claim.token,
                expiresAt: claim.expiresAt
              },
              {
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
            )
            runs.push(claim)
            observations.set(workerId, {
              kind: 'active',
              lease: {
                attemptId: claim.attemptId,
                workerId: claim.workerId,
                token: claim.token,
                expiresAt: claim.expiresAt
              }
            })
            return new Promise<void>(() => {})
          },
          async cancel(_lease: WorkerLease) {
            events.push(`cancel:${workerId}`)
          }
        }
        return worker as unknown as WorkstationWorker
      },
      enrollment: {
        workerId,
        deviceId: 'device',
        capabilities: ['portable'],
        assignments: [
          {
            projectId: 'project',
            rootId: 'root',
            worktreeId: `worktree-${index + 1}`,
            recipeId: 'verify',
            profileId: `hermes-${index + 1}`,
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
      }
    }
  })

  return {
    store,
    slots,
    events,
    runs,
    workerQueues,
    observations,
    now: () => now,
    advance(ms: number) {
      now += ms
    },
    submit(key: string) {
      return store.submit(
        {
          requestKey: key,
          taskId: `task-${key}`,
          projectId: 'project',
          workspaceId: 'workspace',
          targetDeviceId: 'device',
          recipeId: 'verify',
          title: 'Synthetic host lifecycle test',
          sourceRevision: 'a'.repeat(40),
          estimatedBytes: 10,
          dependencies: []
        },
        'fixture'
      )
    },
    reservedBytes() {
      return Number(
        store.db
          .prepare('SELECT COALESCE(sum(bytes),0) AS bytes FROM cloud_capacity_reservations')
          .get()!.bytes
      )
    },
    cleanup() {
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export async function waitFor(predicate: () => boolean, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for host lifecycle condition.')
    }
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}
