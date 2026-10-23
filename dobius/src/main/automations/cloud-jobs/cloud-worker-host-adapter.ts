import { WorkerLeaseReceipt } from '../../../shared/workstation-worker'
import type { WorkstationWorker } from '../workstation-worker/worker'
import type { CloudWorkerRuntimeOptions } from './cloud-worker-runtime-contract'
import type { CloudJobStore } from './store'

type HostWorker = { workerId: string; worker: Pick<WorkstationWorker, 'observePrivateLease'> }

/** All callbacks share the API's existing store; no second connection or token registry. */
export function createCloudWorkerHostCallbacks(
  store: CloudJobStore,
  workers: readonly HostWorker[]
): Pick<
  CloudWorkerRuntimeOptions,
  'readActiveLease' | 'observeCancellation' | 'cancelUnstartedClaim' | 'requestActiveCancellation'
> {
  if (workers.length !== 2 || new Set(workers.map(({ workerId }) => workerId)).size !== 2) {
    throw new Error('Host requires two distinct enrolled workers.')
  }
  const enrolled = new Map(workers.map(({ workerId, worker }) => [workerId, worker]))
  const isEnrolled = (input: unknown) => {
    const lease = WorkerLeaseReceipt.safeParse(input)
    return lease.success && enrolled.has(lease.data.workerId)
  }
  return {
    readActiveLease: async (workerId) => {
      try {
        const worker = enrolled.get(workerId)
        return worker
          ? store.readWorkerHostLease(workerId, worker.observePrivateLease())
          : { kind: 'unknown' }
      } catch {
        return { kind: 'unknown' }
      }
    },
    observeCancellation: async (lease) => {
      try {
        return isEnrolled(lease) ? store.observeWorkerHostCancellation(lease) : { kind: 'unknown' }
      } catch {
        return { kind: 'unknown' }
      }
    },
    cancelUnstartedClaim: async (claim) => {
      try {
        const lease = {
          attemptId: claim.attemptId,
          workerId: claim.workerId,
          token: claim.token,
          expiresAt: claim.expiresAt
        }
        return isEnrolled(lease) ? store.cancelWorkerUnstartedClaim(claim) : { confirmed: false }
      } catch {
        return { confirmed: false }
      }
    },
    requestActiveCancellation: async (lease) => {
      try {
        return isEnrolled(lease) ? store.requestWorkerHostCancellation(lease) : { confirmed: false }
      } catch {
        return { confirmed: false }
      }
    }
  }
}
