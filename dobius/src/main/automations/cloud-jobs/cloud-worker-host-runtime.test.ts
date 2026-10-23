import { afterEach, describe, expect, it } from 'vitest'
import { createCloudWorkerHostRuntime } from './cloud-worker-host-runtime'
import { CloudWorkerQueuePort } from './cloud-worker-queue-port'
import { deferred, hostRuntimeFixture, waitFor } from './cloud-worker-host-runtime.fixtures'
import type { WorkstationWorker } from '../workstation-worker/worker'

const fixtures: ReturnType<typeof hostRuntimeFixture>[] = []
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()))
function fixture(options: Parameters<typeof hostRuntimeFixture>[0] = {}) {
  const result = hostRuntimeFixture(options)
  fixtures.push(result)
  return result
}

function host(f: ReturnType<typeof fixture>, pollIntervalMs = 20) {
  return createCloudWorkerHostRuntime({
    store: f.store,
    slots: f.slots,
    readAuthority: () => ({ ready: true }),
    readCapacity: () => ({
      freeBytes: 1000,
      externalReservedBytes: 0,
      safetyBytes: 100,
      sampledAt: f.now()
    }),
    now: f.now,
    pollIntervalMs,
    tickTimeoutMs: 100
  })
}

describe('two-Hermes cloud worker host runtime', () => {
  it('recovers both journals with dispatch closed, then exposes eligibility independently', async () => {
    const f = fixture({ dispatchEnabled: true })
    f.submit('one')
    f.submit('two')
    const runtime = host(f)
    expect(f.workerQueues).toHaveLength(2)
    expect(f.workerQueues[0]).toBeInstanceOf(CloudWorkerQueuePort)
    expect(f.workerQueues[1]).toBeInstanceOf(CloudWorkerQueuePort)
    expect(f.workerQueues[0]).not.toBe(f.workerQueues[1])

    await runtime.start()
    expect(f.events).toEqual(['reconcile:worker-1', 'reconcile:worker-2'])
    expect(runtime.executorEligibility).toBe(true)
    expect(f.runs).toHaveLength(0)

    await waitFor(() => f.runs.length === 2)
    expect(f.runs.map(({ job }) => f.store.get(job.id).state)).toEqual(['running', 'running'])
    expect(f.reservedBytes()).toBe(200)
    expect(f.runs.map(({ workerId }) => workerId).sort()).toEqual(['worker-1', 'worker-2'])
    expect(f.events.indexOf('run:worker-1')).toBeGreaterThan(f.events.indexOf('reconcile:worker-2'))
    expect(f.events.indexOf('run:worker-2')).toBeGreaterThan(f.events.indexOf('reconcile:worker-2'))
    expect(await runtime.stop(5)).toEqual({ drained: false })
  })

  it('keeps dispatch paused while eligible, starts only after the store switch, and stops scheduling', async () => {
    const f = fixture()
    f.submit('paused')
    const runtime = host(f, 10)

    await runtime.start()
    expect(runtime.executorEligibility).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(f.runs).toHaveLength(0)

    f.store.setDispatchEnabled(true)
    await waitFor(() => f.runs.length === 1)
    const stopped = await runtime.stop(5)
    const countAtStop = f.runs.length
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(stopped.drained).toBe(false)
    expect(f.runs).toHaveLength(countAtStop)
    expect(runtime.executorEligibility).toBe(false)
    expect(f.store.isDispatchEnabled()).toBe(true)
  })

  it('shares concurrent start calls and a stop before the first schedule prevents claims', async () => {
    const f = fixture({ dispatchEnabled: true })
    f.submit('not-started')
    const runtime = host(f, 10)
    const first = runtime.start()
    const concurrent = runtime.start()
    expect(concurrent).toBe(first)
    await first

    expect(await runtime.stop(100)).toEqual({ drained: true })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(f.runs).toHaveLength(0)
    expect(f.events.filter((event) => event.startsWith('reconcile:'))).toHaveLength(2)
    // The host never owns or closes this database.
    expect(f.store.isDispatchEnabled()).toBe(true)
  })

  it('requires exactly the two unique Hermes enrollments on one device', () => {
    const f = fixture()
    expect(() =>
      createCloudWorkerHostRuntime({
        store: f.store,
        slots: f.slots.slice(0, 1),
        readAuthority: () => ({ ready: true }),
        readCapacity: () => ({
          freeBytes: 1000,
          externalReservedBytes: 0,
          safetyBytes: 0,
          sampledAt: f.now()
        })
      })
    ).toThrow(/exactly two/)

    const duplicated = [{ ...f.slots[0]! }, { ...f.slots[1]!, enrollment: f.slots[0]!.enrollment }]
    expect(() =>
      createCloudWorkerHostRuntime({
        store: f.store,
        slots: duplicated,
        readAuthority: () => ({ ready: true }),
        readCapacity: () => ({
          freeBytes: 1000,
          externalReservedBytes: 0,
          safetyBytes: 0,
          sampledAt: f.now()
        })
      })
    ).toThrow(/distinct Hermes profiles and worker IDs/)
  })

  it('refuses one worker object reused across both enrolled slots', () => {
    const f = fixture()
    const sameWorker = {
      observePrivateLease: () => ({ kind: 'fresh' as const }),
      async reconcile() {
        return 'idle' as const
      },
      async runClaim() {},
      async cancel() {}
    } as unknown as WorkstationWorker
    const slots = f.slots.map((slot) => ({ ...slot, createWorker: () => sameWorker }))

    expect(() =>
      createCloudWorkerHostRuntime({
        store: f.store,
        slots,
        readAuthority: () => ({ ready: true }),
        readCapacity: () => ({
          freeBytes: 1000,
          externalReservedBytes: 0,
          safetyBytes: 0,
          sampledAt: f.now()
        })
      })
    ).toThrow(/distinct worker instance/)
  })

  it('does not treat unresolved recovery as executor eligibility', async () => {
    const f = fixture()
    const hold = deferred<void>()
    const original = f.slots[0]!.createWorker
    f.slots[0]!.createWorker = (queue) => {
      const worker = original(queue) as unknown as { reconcile: () => Promise<'idle'> }
      worker.reconcile = async () => {
        f.events.push('reconcile:worker-1')
        await hold.promise
        return 'idle'
      }
      return worker as unknown as WorkstationWorker
    }
    const runtime = host(f)
    let started = false
    const starting = runtime.start().then(() => {
      started = true
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(runtime.executorEligibility).toBe(false)
    expect(started).toBe(false)
    hold.resolve()
    await starting
    expect(runtime.executorEligibility).toBe(true)
    expect(await runtime.stop(100)).toEqual({ drained: true })
  })

  it('does not open eligibility after stop races startup and allows a later drain retry', async () => {
    const f = fixture({ dispatchEnabled: true })
    f.submit('stop-race')
    const hold = deferred<void>()
    const original = f.slots[0]!.createWorker
    f.slots[0]!.createWorker = (queue) => {
      const worker = original(queue) as unknown as { reconcile: () => Promise<'idle'> }
      worker.reconcile = async () => {
        f.events.push('reconcile:worker-1-held')
        await hold.promise
        return 'idle'
      }
      return worker as unknown as WorkstationWorker
    }
    const runtime = host(f, 10)
    let started = false
    const starting = runtime.start().then(() => {
      started = true
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const firstStop = await runtime.stop(1)
    expect(firstStop.drained).toBe(false)
    expect(runtime.executorEligibility).toBe(false)

    hold.resolve()
    await starting
    expect(started).toBe(true)
    expect(runtime.executorEligibility).toBe(false)
    expect(f.runs).toHaveLength(0)
    expect(await runtime.stop(100)).toEqual({ drained: true })
  })

  it('accepts a zero-millisecond shutdown timeout as a bounded immediate refusal', async () => {
    const f = fixture()
    const runtime = host(f)
    await expect(runtime.stop(0)).resolves.toEqual({ drained: false })
    expect(f.store.isDispatchEnabled()).toBe(false)
  })
})
