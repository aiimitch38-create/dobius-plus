import type { WorkerClaim, WorkerLeaseReceipt } from '../../../shared/workstation-worker'
import {
  PROFILE_IDS,
  confirmedFor,
  leaseForClaim,
  parseAuthority,
  sameLease,
  type ActiveAttempt,
  type CloudWorkerCancellationRead,
  type CloudWorkerRuntimeOptions,
  type CloudWorkerRuntimeAuthority,
  type CloudWorkerRuntimeSlot,
  type CloudWorkerRuntimeSnapshotSlot,
  type SlotState
} from './cloud-worker-runtime-contract'
import { drainCloudWorkers } from './cloud-worker-runtime-shutdown'
import { recoverWorkerSlots } from './cloud-worker-runtime-recovery'
import { cancelUnstartedClaim, refreshWorkerAttempt } from './cloud-worker-runtime-attempts'

export type {
  CloudWorkerCancellationRead,
  CloudWorkerLeaseRead,
  CloudWorkerRuntimeAuthority,
  CloudWorkerRuntimeOptions,
  CloudWorkerRuntimeSlot,
  CloudWorkerRuntimeSnapshotSlot,
  CloudWorkerUnstartedCancellation
} from './cloud-worker-runtime-contract'

/**
 * Supervises only the two constructor-enrolled Hermes slots. It owns no store,
 * command definition, provider configuration, or filesystem path.
 */
export class CloudWorkerRuntime {
  private readonly slots: { config: CloudWorkerRuntimeSlot; state: SlotState }[]
  private tickTask: Promise<void> | null = null
  private shuttingDown = false

  constructor(private readonly options: CloudWorkerRuntimeOptions) {
    if (
      options.slots.length !== 2 ||
      PROFILE_IDS.some(
        (profileId) => options.slots.filter((slot) => slot.profileId === profileId).length !== 1
      ) ||
      new Set(options.slots.map((slot) => slot.workerId)).size !== 2 ||
      options.slots.some((slot) => !slot.workerId.trim())
    ) {
      throw new Error('Runtime requires exactly two uniquely identified Hermes worker slots.')
    }
    this.slots = options.slots.map((config) => ({ config, state: { kind: 'unrecovered' } }))
  }

  private get slotsAvailable() {
    return !(
      this.shuttingDown ||
      this.slots.some(
        ({ state }) =>
          state.kind === 'unrecovered' ||
          state.kind === 'ambiguous' ||
          (state.kind === 'active' && state.attempt.cancellationUncertain)
      )
    )
  }

  get executorEligibility() {
    if (!this.slotsAvailable) {
      return false
    }
    try {
      return parseAuthority(this.options.readAuthority).ready
    } catch {
      return false
    }
  }

  get readiness() {
    if (!this.slotsAvailable) {
      return false
    }
    try {
      const authority = parseAuthority(this.options.readAuthority)
      return authority.ready && authority.dispatchEnabled
    } catch {
      return false
    }
  }

  snapshot(): CloudWorkerRuntimeSnapshotSlot[] {
    return this.slots.map(({ config, state }) => ({
      profileId: config.profileId,
      workerId: config.workerId,
      state: state.kind,
      ...(state.kind === 'ambiguous' ? { reason: state.reason } : {}),
      ...(state.kind === 'active' ? { attemptId: state.attempt.lease.attemptId } : {})
    }))
  }

  tick(): Promise<void> {
    if (this.tickTask) {
      return this.tickTask
    }
    this.tickTask = this.runTick().finally(() => {
      this.tickTask = null
    })
    return this.tickTask
  }

  async shutdown(timeoutMs: number) {
    if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs < 0) {
      throw new Error('Shutdown timeout must be a finite nonnegative integer.')
    }
    this.shuttingDown = true
    return drainCloudWorkers({
      timeoutMs,
      slots: this.slots,
      tickTask: this.tickTask,
      requestCancellation: (slot) => this.requestAndApplyCancellation(slot),
      refresh: (slot) => this.refreshActiveSlot(slot),
      snapshot: () => this.snapshot()
    })
  }

  private async runTick() {
    await recoverWorkerSlots(this.slots, this.options)
    if (this.shuttingDown) {
      return
    }

    let uncertainObservation = false
    for (const slot of this.slots) {
      if (slot.state.kind === 'active') {
        const observed = await this.observeAndApplyCancellation(slot)
        uncertainObservation ||= !observed
        await this.refreshActiveSlot(slot)
      }
    }
    if (this.shuttingDown || uncertainObservation || !this.readiness) {
      return
    }

    for (const slot of this.slots) {
      if (this.shuttingDown || !this.readiness) {
        return
      }
      if (slot.state.kind !== 'idle') {
        continue
      }
      await this.claimAndStart(slot)
    }
  }

  private async claimAndStart(slot: { config: CloudWorkerRuntimeSlot; state: SlotState }) {
    let claim: WorkerClaim | null
    try {
      claim = await slot.config.queue.claim(slot.config.workerId)
    } catch {
      return
    }
    if (!claim) {
      return
    }

    let parsed: ReturnType<typeof leaseForClaim>
    try {
      parsed = leaseForClaim(claim)
      if (
        parsed.lease.workerId !== slot.config.workerId ||
        parsed.job.profileId !== slot.config.profileId
      ) {
        throw new Error('Claim identity differs from constructor-owned slot.')
      }
    } catch {
      slot.state = {
        kind: 'ambiguous',
        reason: 'Queue returned a malformed or misrouted claim.',
        claim
      }
      return
    }
    const attempt: ActiveAttempt = {
      lease: parsed.lease,
      claim,
      runTask: null,
      cancelTask: null,
      outcome: 'running',
      started: false,
      cancellationUncertain: false
    }
    slot.state = { kind: 'active', attempt }

    let authority: CloudWorkerRuntimeAuthority
    try {
      authority = parseAuthority(this.options.readAuthority)
    } catch {
      authority = { ready: false, dispatchEnabled: false }
    }
    if (this.shuttingDown || !authority.ready || !authority.dispatchEnabled) {
      await this.cancelUnstarted(slot, claim, parsed.lease, attempt)
      return
    }

    attempt.started = true
    let task: Promise<void>
    try {
      // Keep dispatch authority and invocation in one synchronous turn; no microtask can slip in.
      task = Promise.resolve(slot.config.worker.runClaim(claim))
    } catch (error) {
      task = Promise.reject(error)
    }
    attempt.runTask = task
    void task
      .then(
        () => {
          attempt.outcome = 'resolved'
        },
        () => {
          attempt.outcome = 'rejected'
        }
      )
      .then(() => this.refreshActiveSlot(slot))
      .catch(() => {
        attempt.cancellationUncertain = true
      })
  }

  private async cancelUnstarted(
    slot: { config: CloudWorkerRuntimeSlot; state: SlotState },
    claim: WorkerClaim,
    lease: ReturnType<typeof WorkerLeaseReceipt.parse>,
    attempt: ActiveAttempt
  ) {
    await cancelUnstartedClaim(slot, claim, lease, attempt, this.options)
  }

  private async observeAndApplyCancellation(slot: {
    config: CloudWorkerRuntimeSlot
    state: SlotState
  }) {
    if (slot.state.kind !== 'active') {
      return true
    }
    const attempt = slot.state.attempt
    let observation: CloudWorkerCancellationRead
    try {
      observation = await this.options.observeCancellation(attempt.lease)
    } catch {
      observation = { kind: 'unknown' }
    }
    if (observation.kind === 'unknown' || !sameLease(observation.lease, attempt.lease)) {
      attempt.cancellationUncertain = true
      return false
    }
    attempt.cancellationUncertain = false
    if (observation.kind === 'stopping') {
      this.startExactCancel(slot, attempt)
    }
    return true
  }

  private async requestAndApplyCancellation(slot: {
    config: CloudWorkerRuntimeSlot
    state: SlotState
  }) {
    if (slot.state.kind !== 'active') {
      return
    }
    const lease = slot.state.attempt.lease
    try {
      const result = await this.options.requestActiveCancellation(lease)
      if (!confirmedFor(result, lease)) {
        slot.state.attempt.cancellationUncertain = true
        return
      }
    } catch {
      slot.state.attempt.cancellationUncertain = true
      return
    }
    await this.observeAndApplyCancellation(slot)
  }

  private startExactCancel(
    slot: { config: CloudWorkerRuntimeSlot; state: SlotState },
    attempt: ActiveAttempt
  ) {
    if (attempt.cancelTask) {
      return
    }
    const task = Promise.resolve().then(() => slot.config.worker.cancel(attempt.lease))
    attempt.cancelTask = task
    void task
      .catch(() => {
        attempt.cancellationUncertain = true
      })
      .then(() => this.refreshActiveSlot(slot))
      .catch(() => {
        attempt.cancellationUncertain = true
      })
  }

  private async refreshActiveSlot(slot: { config: CloudWorkerRuntimeSlot; state: SlotState }) {
    await refreshWorkerAttempt(slot, this.options)
  }
}
