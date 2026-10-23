import {
  confirmedFor,
  sameLease,
  type ActiveAttempt,
  type CloudWorkerRuntimeOptions,
  type RuntimeSlotState
} from './cloud-worker-runtime-contract'

export async function cancelUnstartedClaim(
  slot: RuntimeSlotState,
  claim: Parameters<CloudWorkerRuntimeOptions['cancelUnstartedClaim']>[0],
  lease: Parameters<CloudWorkerRuntimeOptions['observeCancellation']>[0],
  attempt: ActiveAttempt,
  options: Pick<CloudWorkerRuntimeOptions, 'cancelUnstartedClaim' | 'readActiveLease'>
) {
  try {
    const result = await options.cancelUnstartedClaim(claim)
    if (!confirmedFor(result, lease)) {
      retainUncertainAttempt(slot, attempt)
      return
    }

    // Both claim-rejection paths require the server and worker to prove idle after cancellation.
    const workerStatus = await slot.config.worker.reconcile()
    const hostStatus = await options.readActiveLease(slot.config.workerId)
    if (workerStatus === 'idle' && hostStatus.kind === 'idle') {
      slot.state = { kind: 'idle' }
    } else {
      retainUncertainAttempt(slot, attempt)
    }
  } catch {
    retainUncertainAttempt(slot, attempt)
  }
}

export async function refreshWorkerAttempt(
  slot: RuntimeSlotState,
  options: CloudWorkerRuntimeOptions
) {
  if (slot.state.kind !== 'active') {
    return
  }
  const attempt = slot.state.attempt
  if (attempt.runTask && attempt.outcome === 'running') {
    return
  }
  if (attempt.cancelTask && attempt.runTask && attempt.outcome === 'running') {
    return
  }

  let status: 'idle' | 'running' | 'ambiguous'
  try {
    status = await slot.config.worker.reconcile()
  } catch {
    status = 'ambiguous'
  }
  if (status !== 'idle') {
    if (status === 'ambiguous') {
      attempt.cancellationUncertain = true
    }
    return
  }
  try {
    const read = await options.readActiveLease(slot.config.workerId)
    if (read.kind === 'idle') {
      slot.state = { kind: 'idle' }
    } else {
      const mayCancelUnstarted = attempt.outcome === 'rejected' || !attempt.started
      const exactActiveLease = read.kind === 'active' && sameLease(read.lease, attempt.lease)
      if (mayCancelUnstarted && attempt.claim && (exactActiveLease || read.kind === 'unknown')) {
        await cancelRejectedOrUnstartedClaim(slot, options, attempt)
      } else {
        retainUncertainAttempt(slot, attempt)
      }
    }
  } catch {
    retainUncertainAttempt(slot, attempt)
  }
}

async function cancelRejectedOrUnstartedClaim(
  slot: RuntimeSlotState,
  options: CloudWorkerRuntimeOptions,
  attempt: ActiveAttempt
) {
  const claim = attempt.claim
  if (!claim) {
    retainUncertainAttempt(slot, attempt)
    return
  }
  const cancelled = await options.cancelUnstartedClaim(claim)
  if (!confirmedFor(cancelled, attempt.lease)) {
    retainUncertainAttempt(slot, attempt)
    return
  }

  // Unknown lease reads are safe to clear only after the durable guard, worker, and host all prove idle.
  const workerStatus = await slot.config.worker.reconcile()
  const hostStatus = await options.readActiveLease(slot.config.workerId)
  if (workerStatus === 'idle' && hostStatus.kind === 'idle') {
    slot.state = { kind: 'idle' }
    return
  }
  retainUncertainAttempt(slot, attempt)
}

function retainUncertainAttempt(slot: RuntimeSlotState, attempt: ActiveAttempt) {
  slot.state = { kind: 'active', attempt: { ...attempt, cancellationUncertain: true } }
}
