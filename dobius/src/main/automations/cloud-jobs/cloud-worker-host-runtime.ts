import type { WorkstationWorker } from '../workstation-worker/worker'
import {
  CloudWorkerEnrollment,
  type CloudWorkerCapacitySample
} from '../../../shared/cloud-worker-enrollment'
import type { CloudWorkerRuntimeAuthority } from './cloud-worker-runtime'
import { CloudWorkerRuntime } from './cloud-worker-runtime'
import { createCloudWorkerHostCallbacks } from './cloud-worker-host-adapter'
import { CloudWorkerQueuePort } from './cloud-worker-queue-port'
import type { CloudJobStore } from './store'

const PROFILE_IDS = ['hermes-1', 'hermes-2'] as const
const MAX_TICK_TIMEOUT_MS = 30_000
const MAX_SHUTDOWN_TIMEOUT_MS = 60_000
const MAX_POLL_INTERVAL_MS = 60_000
const DEFAULT_TICK_TIMEOUT_MS = 5_000
const DEFAULT_POLL_INTERVAL_MS = 1_000

export type CloudWorkerHostEnrollment = {
  enrollment: unknown
  createWorker: (queue: CloudWorkerQueuePort) => WorkstationWorker
}

export type CloudWorkerHostRuntimeOptions = {
  /** The host's one already-open store; this factory never opens or closes it. */
  store: CloudJobStore
  /** Exactly two real worker instances paired with their trusted enrollment. */
  slots: readonly CloudWorkerHostEnrollment[]
  /** Trusted host readiness, excluding the user-controlled dispatch switch. */
  readAuthority: () => Pick<CloudWorkerRuntimeAuthority, 'ready'>
  /** Authenticated host telemetry; queue reservations are tracked by the store. */
  readCapacity: (deviceId: string) => CloudWorkerCapacitySample
  now?: () => number
  pollIntervalMs?: number
  tickTimeoutMs?: number
}

type CloudWorkerHostTickResult = 'completed' | 'failed' | 'timed-out' | 'stopped'

function validateLimit(value: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be a positive integer no greater than ${maximum}ms.`)
  }
}

function validateShutdownTimeout(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SHUTDOWN_TIMEOUT_MS) {
    throw new Error(`Shutdown timeout must be an integer from 0 to ${MAX_SHUTDOWN_TIMEOUT_MS}ms.`)
  }
}

function enrollmentsFor(slots: readonly CloudWorkerHostEnrollment[]) {
  if (slots.length !== PROFILE_IDS.length) {
    throw new Error('Host runtime requires exactly two enrolled worker instances.')
  }
  const parsed = slots.map(({ enrollment, createWorker }) => {
    const value = CloudWorkerEnrollment.parse(enrollment)
    const profileIds = [...new Set(value.assignments.map((assignment) => assignment.profileId))]
    if (
      profileIds.length !== 1 ||
      !PROFILE_IDS.includes(profileIds[0] as (typeof PROFILE_IDS)[number])
    ) {
      throw new Error('Each enrolled worker must map to exactly one Hermes profile.')
    }
    return {
      enrollment: value,
      profileId: profileIds[0] as (typeof PROFILE_IDS)[number],
      createWorker
    }
  })
  if (
    new Set(parsed.map(({ enrollment }) => enrollment.workerId)).size !== PROFILE_IDS.length ||
    new Set(parsed.map(({ profileId }) => profileId)).size !== PROFILE_IDS.length ||
    new Set(parsed.map(({ enrollment }) => enrollment.deviceId)).size !== 1
  ) {
    throw new Error(
      'Host runtime requires two distinct Hermes profiles and worker IDs on one device.'
    )
  }
  return parsed
}

/**
 * Bounded scheduling around the existing two-slot supervisor. Timed-out work
 * stays owned by CloudWorkerRuntime, whose tick guard prevents duplicate claims.
 */
export class CloudWorkerHostRuntime {
  private timer: ReturnType<typeof setTimeout> | null = null
  private startTask: Promise<void> | null = null
  private stopping = false
  private recovered = false
  private stopTask: Promise<{ drained: boolean }> | null = null

  constructor(
    private readonly runtime: CloudWorkerRuntime,
    private readonly options: { pollIntervalMs: number; tickTimeoutMs: number },
    private readonly onRecovered: () => void
  ) {}

  get executorEligibility() {
    return this.recovered && !this.stopping && this.runtime.executorEligibility
  }

  snapshot() {
    return this.runtime.snapshot()
  }

  private async tick(timeoutMs: number): Promise<CloudWorkerHostTickResult> {
    validateLimit(timeoutMs, MAX_TICK_TIMEOUT_MS, 'Tick timeout')
    if (this.stopping) {
      return 'stopped'
    }
    const pending = this.runtime.tick().then(
      () => 'completed' as const,
      () => 'failed' as const
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      pending,
      new Promise<'timed-out'>((resolve) => {
        timer = setTimeout(() => resolve('timed-out'), timeoutMs)
      })
    ]).finally(() => {
      if (timer) {
        clearTimeout(timer)
      }
    })
    return result
  }

  start(): Promise<void> {
    if (this.startTask) {
      return this.startTask
    }
    if (this.stopping) {
      return Promise.resolve()
    }
    this.startTask = this.startLoop()
    return this.startTask
  }

  stop(timeoutMs: number): Promise<{ drained: boolean }> {
    validateShutdownTimeout(timeoutMs)
    if (this.stopTask) {
      return this.stopTask
    }
    // Stop scheduling before yielding; shutdown then drains the supervisor's current tick.
    this.stopping = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    // This runtime never closes the host-owned store.
    this.stopTask = this.runtime
      .shutdown(timeoutMs)
      .then((result) => ({ drained: result.cleanupProven }))
      .finally(() => {
        this.stopTask = null
      })
    return this.stopTask
  }

  private async startLoop() {
    await this.tick(this.options.tickTimeoutMs)
    this.openDispatchAfterRecovery()
    this.schedule(this.options.pollIntervalMs)
  }

  private openDispatchAfterRecovery() {
    if (!this.stopping && !this.recovered && this.runtime.executorEligibility) {
      this.recovered = true
      this.onRecovered()
    }
  }

  private schedule(delayMs: number) {
    if (this.stopping) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick(this.options.tickTimeoutMs).then(() => {
        this.openDispatchAfterRecovery()
        this.schedule(this.options.pollIntervalMs)
      })
    }, delayMs)
  }
}

export function createCloudWorkerHostRuntime(options: CloudWorkerHostRuntimeOptions) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const tickTimeoutMs = options.tickTimeoutMs ?? DEFAULT_TICK_TIMEOUT_MS
  validateLimit(pollIntervalMs, MAX_POLL_INTERVAL_MS, 'Poll interval')
  validateLimit(tickTimeoutMs, MAX_TICK_TIMEOUT_MS, 'Tick timeout')
  const enrolled = enrollmentsFor(options.slots)
  const boundSlots = enrolled.map(({ enrollment, profileId, createWorker }) => {
    const queue = new CloudWorkerQueuePort({
      store: options.store,
      enrollment,
      readCapacity: options.readCapacity,
      now: options.now
    })
    return { enrollment, profileId, queue, worker: createWorker(queue) }
  })
  if (new Set(boundSlots.map(({ worker }) => worker)).size !== PROFILE_IDS.length) {
    throw new Error('Each Hermes slot must be bound to a distinct worker instance.')
  }
  const hostCallbacks = createCloudWorkerHostCallbacks(
    options.store,
    boundSlots.map(({ enrollment, worker }) => ({ workerId: enrollment.workerId, worker }))
  )
  let dispatchGateOpen = false
  const runtime = new CloudWorkerRuntime({
    slots: boundSlots.map(({ enrollment, profileId, worker, queue }) => ({
      profileId,
      workerId: enrollment.workerId,
      worker,
      queue
    })),
    readAuthority: () => ({
      ready: options.readAuthority().ready,
      dispatchEnabled: dispatchGateOpen && options.store.isDispatchEnabled()
    }),
    ...hostCallbacks
  })
  return new CloudWorkerHostRuntime(runtime, { pollIntervalMs, tickTimeoutMs }, () => {
    dispatchGateOpen = true
  })
}
