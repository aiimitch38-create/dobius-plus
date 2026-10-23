import type { QueuePort, WorkerClaim, WorkerLease } from '../../../shared/workstation-worker'
import type { WorkstationWorker } from '../workstation-worker/worker'
import {
  CloudWorkerRuntime,
  type CloudWorkerRuntimeOptions,
  type CloudWorkerRuntimeSlot
} from './cloud-worker-runtime'

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function claimFor(
  workerId: string,
  profileId: 'hermes-1' | 'hermes-2',
  number = 1
): WorkerClaim {
  const attemptId = `attempt-${workerId}-${number}`
  return {
    job: {
      id: attemptId,
      attemptId,
      deviceId: 'device-1',
      recipeId: 'recipe-1',
      rootId: 'root-1',
      sourceRevision: 'a'.repeat(40),
      profileId,
      worktreeId: `worktree-${profileId}`,
      caps: {
        wallTimeMs: 1000,
        outputBytes: 1024,
        artifactBytes: 0,
        memoryBytes: 1024,
        cpuCount: 1
      }
    },
    attemptId,
    workerId,
    token: `${workerId}-${String(number).padStart(30, 'x')}`,
    expiresAt: Date.now() + 60_000
  }
}

export function leaseFor(claim: WorkerClaim): WorkerLease {
  return {
    attemptId: claim.attemptId,
    workerId: claim.workerId,
    token: claim.token,
    expiresAt: claim.expiresAt
  }
}

export function runtimeHarness(
  overrides: {
    authority?: () => { ready: boolean; dispatchEnabled: boolean }
    beforeClaim?: (workerId: string) => Promise<WorkerClaim | null>
    workerReconcile?: (workerId: string) => Promise<'idle' | 'running' | 'ambiguous'>
    workerRun?: (claim: WorkerClaim) => Promise<void>
    workerCancel?: (lease: WorkerLease) => Promise<unknown>
    activeLease?: (workerId: string) => Promise<unknown>
    cancellation?: (lease: WorkerLease) => Promise<unknown>
    cancelUnstarted?: (claim: WorkerClaim) => Promise<unknown>
    requestCancellation?: (lease: WorkerLease) => Promise<unknown>
  } = {}
) {
  const events: string[] = []
  const calls = { claims: [] as string[], runs: [] as WorkerClaim[], cancels: [] as WorkerLease[] }
  const slotClaims = new Map<string, WorkerClaim | null>([
    ['worker-1', claimFor('worker-1', 'hermes-1')],
    ['worker-2', claimFor('worker-2', 'hermes-2')]
  ])
  const active = new Map<string, WorkerLease>()
  const slots = (['hermes-1', 'hermes-2'] as const).map((profileId, index) => {
    const workerId = `worker-${index + 1}`
    const queue = {
      claim: async (requestedWorker: string) => {
        events.push(`claim:${requestedWorker}`)
        calls.claims.push(requestedWorker)
        if (overrides.beforeClaim) {
          const result = await overrides.beforeClaim(requestedWorker)
          if (result) {
            active.set(requestedWorker, leaseFor(result))
          }
          return result
        }
        const result = slotClaims.get(requestedWorker) ?? null
        slotClaims.set(requestedWorker, null)
        if (result) {
          active.set(requestedWorker, leaseFor(result))
        }
        return result
      }
    } as Pick<QueuePort, 'claim'>
    const worker = {
      reconcile: async () => {
        events.push(`reconcile:${workerId}`)
        return (await overrides.workerReconcile?.(workerId)) ?? 'idle'
      },
      runClaim: async (input: unknown) => {
        const claim = input as WorkerClaim
        events.push(`run:${claim.workerId}`)
        calls.runs.push(claim)
        await overrides.workerRun?.(claim)
        active.delete(claim.workerId)
      },
      cancel: async (input: unknown) => {
        const lease = input as WorkerLease
        events.push(`cancel:${lease.workerId}`)
        calls.cancels.push(lease)
        return overrides.workerCancel?.(lease)
      }
    } as unknown as Pick<WorkstationWorker, 'runClaim' | 'reconcile' | 'cancel'>
    return { profileId, workerId, queue, worker } satisfies CloudWorkerRuntimeSlot
  })
  const options: CloudWorkerRuntimeOptions = {
    slots,
    readAuthority: overrides.authority ?? (() => ({ ready: true, dispatchEnabled: true })),
    readActiveLease: async (workerId) => {
      if (overrides.activeLease) {
        return overrides.activeLease(workerId) as Promise<never>
      }
      const lease = active.get(workerId)
      return lease ? { kind: 'active', lease } : { kind: 'idle' }
    },
    observeCancellation: async (lease) => {
      if (overrides.cancellation) {
        return overrides.cancellation(lease) as Promise<never>
      }
      return { kind: 'not-stopping', lease }
    },
    cancelUnstartedClaim: async (claim) => {
      if (overrides.cancelUnstarted) {
        const result = (await overrides.cancelUnstarted(claim)) as { confirmed?: boolean }
        if (result.confirmed) {
          active.delete(claim.workerId)
        }
        return result as never
      }
      active.delete(claim.workerId)
      return {
        confirmed: true,
        attemptId: claim.attemptId,
        workerId: claim.workerId,
        token: claim.token
      }
    },
    requestActiveCancellation: async (lease) => {
      if (overrides.requestCancellation) {
        return overrides.requestCancellation(lease) as Promise<never>
      }
      return {
        confirmed: true,
        attemptId: lease.attemptId,
        workerId: lease.workerId,
        token: lease.token
      }
    }
  }
  return { runtime: new CloudWorkerRuntime(options), options, slots, events, calls, active }
}
