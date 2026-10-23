import { WorkerLeaseReceipt } from '../../../shared/workstation-worker'
import type { CloudWorkerRuntimeOptions, RuntimeSlotState } from './cloud-worker-runtime-contract'

export async function recoverWorkerSlots(
  slots: RuntimeSlotState[],
  options: CloudWorkerRuntimeOptions
) {
  const pending = slots.filter(
    ({ state }) =>
      state.kind === 'unrecovered' || (state.kind === 'ambiguous' && state.retryRecovery)
  )
  if (pending.length === 0) {
    return
  }
  const reconciled = await Promise.all(
    pending.map(async ({ config }) => {
      try {
        return await config.worker.reconcile()
      } catch {
        return 'ambiguous' as const
      }
    })
  )
  const reads = await Promise.all(
    pending.map(({ config }) =>
      options.readActiveLease(config.workerId).catch(() => ({ kind: 'unknown' as const }))
    )
  )
  pending.forEach((slot, index) => {
    const status = reconciled[index]
    const read = reads[index]
    if (status === 'ambiguous' || read.kind === 'unknown') {
      slot.state = {
        kind: 'ambiguous',
        reason: 'Recovery or durable lease observation is unavailable.',
        retryRecovery: true
      }
      return
    }
    if (status === 'idle' && read.kind === 'idle') {
      slot.state = { kind: 'idle' }
      return
    }
    if (status === 'running' && read.kind === 'active') {
      const lease = WorkerLeaseReceipt.safeParse(read.lease)
      slot.state =
        lease.success && lease.data.workerId === slot.config.workerId
          ? {
              kind: 'active',
              attempt: {
                lease: lease.data,
                runTask: null,
                cancelTask: null,
                outcome: 'running',
                started: true,
                cancellationUncertain: false
              }
            }
          : {
              kind: 'ambiguous',
              reason: 'Recovered lease identity does not match its enrolled worker.',
              retryRecovery: true
            }
      return
    }
    slot.state = {
      kind: 'ambiguous',
      reason: 'Worker journal and durable lease disagree.',
      retryRecovery: true
    }
  })
}
