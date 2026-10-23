import { describe, expect, it } from 'vitest'
import type { WorkerClaim } from '../../../shared/workstation-worker'
import { CloudWorkerRuntime } from './cloud-worker-runtime'
import { claimFor, deferred, leaseFor, runtimeHarness } from './cloud-worker-runtime.fixtures'

async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
  }
}

describe('CloudWorkerRuntime', () => {
  it('requires exactly the two distinct enrolled profiles and worker identities', () => {
    const { options } = runtimeHarness()
    expect(() => new CloudWorkerRuntime({ ...options, slots: [options.slots[0]!] })).toThrow(
      /exactly two/
    )
    expect(
      () =>
        new CloudWorkerRuntime({
          ...options,
          slots: [options.slots[0]!, { ...options.slots[1]!, profileId: 'hermes-1' }]
        })
    ).toThrow(/exactly two/)
    expect(
      () =>
        new CloudWorkerRuntime({
          ...options,
          slots: [options.slots[0]!, { ...options.slots[1]!, workerId: options.slots[0]!.workerId }]
        })
    ).toThrow(/uniquely identified/)
    const { slots } = runtimeHarness()
    expect(slots).toHaveLength(2)
  })

  it('recovers both worker journals before it claims either slot', async () => {
    const harness = runtimeHarness()
    await harness.runtime.tick()
    const firstClaim = harness.events.findIndex((event) => event.startsWith('claim:'))
    expect(firstClaim).toBeGreaterThan(
      Math.max(
        harness.events.indexOf('reconcile:worker-1'),
        harness.events.indexOf('reconcile:worker-2')
      )
    )
    expect(harness.calls.claims).toEqual(['worker-1', 'worker-2'])
  })

  it('gates all claims when either recovery journal is ambiguous', async () => {
    const harness = runtimeHarness({
      workerReconcile: async (workerId) => (workerId === 'worker-2' ? 'ambiguous' : 'idle')
    })
    await harness.runtime.tick()
    expect(harness.calls.claims).toEqual([])
    expect(harness.runtime.readiness).toBe(false)
  })

  it('retains a recovered active lease and claims only the other profile', async () => {
    const recovered = claimFor('worker-1', 'hermes-1', 9)
    const harness = runtimeHarness({
      workerReconcile: async (workerId) => (workerId === 'worker-1' ? 'running' : 'idle'),
      activeLease: async (workerId) =>
        workerId === 'worker-1' ? { kind: 'active', lease: leaseFor(recovered) } : { kind: 'idle' }
    })
    await harness.runtime.tick()
    expect(harness.runtime.snapshot()[0]).toMatchObject({
      state: 'active',
      attemptId: recovered.attemptId
    })
    expect(harness.calls.claims).toEqual(['worker-2'])
    expect(harness.calls.runs.map((claim) => claim.workerId)).toEqual(['worker-2'])
  })

  it('cancels a just-claimed unstarted lease if readiness pauses before dispatch', async () => {
    let reads = 0
    const cancelled: WorkerClaim[] = []
    const harness = runtimeHarness({
      authority: () => ({ ready: ++reads < 3, dispatchEnabled: true }),
      cancelUnstarted: async (claim) => {
        cancelled.push(claim)
        return {
          confirmed: true,
          attemptId: claim.attemptId,
          workerId: claim.workerId,
          token: claim.token
        }
      }
    })
    await harness.runtime.tick()
    expect(harness.calls.runs).toHaveLength(0)
    expect(harness.calls.claims).toEqual(['worker-1'])
    expect(cancelled).toHaveLength(1)
    expect(cancelled[0]?.workerId).toBe('worker-1')
    expect(harness.runtime.snapshot()[0]?.state).toBe('idle')
  })

  it('keeps a just-claimed slot uncertain when cancellation and worker idle are proven but host idle is unknown', async () => {
    let reads = 0
    let claimReturned = false
    const cancelled: WorkerClaim[] = []
    const harness = runtimeHarness({
      authority: () => ({ ready: ++reads < 3, dispatchEnabled: true }),
      beforeClaim: async (workerId) => {
        if (workerId !== 'worker-1') {
          return null
        }
        claimReturned = true
        return claimFor(workerId, 'hermes-1', 35)
      },
      activeLease: async (workerId) =>
        workerId === 'worker-1' && claimReturned ? { kind: 'unknown' } : { kind: 'idle' },
      cancelUnstarted: async (claim) => {
        cancelled.push(claim)
        return {
          confirmed: true,
          attemptId: claim.attemptId,
          workerId: claim.workerId,
          token: claim.token
        }
      }
    })

    await harness.runtime.tick()

    expect(harness.calls.runs).toHaveLength(0)
    expect(cancelled).toHaveLength(1)
    expect(harness.runtime.snapshot()[0]?.state).toBe('active')
    expect(harness.runtime.executorEligibility).toBe(false)
  })

  it('cancels instead of invoking when the post-claim authority read is disabled or throws', async () => {
    for (const failRead of ['disabled', 'throw'] as const) {
      let reads = 0
      const cancelled: WorkerClaim[] = []
      const harness = runtimeHarness({
        authority: () => {
          reads += 1
          if (reads >= 3 && failRead === 'throw') {
            throw new Error('authority unavailable')
          }
          return { ready: reads < 3 || failRead !== 'disabled', dispatchEnabled: true }
        },
        cancelUnstarted: async (claim) => {
          cancelled.push(claim)
          return {
            confirmed: true,
            attemptId: claim.attemptId,
            workerId: claim.workerId,
            token: claim.token
          }
        }
      })
      await harness.runtime.tick()
      expect(harness.calls.runs).toHaveLength(0)
      expect(cancelled).toHaveLength(1)
    }
  })

  it('invokes runClaim in the same turn as the enabled authority check', async () => {
    let enabled = true
    let reads = 0
    const observedAtRun: boolean[] = []
    const harness = runtimeHarness({
      authority: () => {
        reads += 1
        if (reads === 3) {
          queueMicrotask(() => {
            enabled = false
          })
        }
        return { ready: true, dispatchEnabled: enabled }
      },
      workerRun: async () => {
        observedAtRun.push(enabled)
      }
    })
    await harness.runtime.tick()
    await flushMicrotasks()
    expect(observedAtRun).toEqual([true])
    expect(enabled).toBe(false)
    expect(harness.calls.runs.map((claim) => claim.workerId)).toEqual(['worker-1'])
  })

  it('exposes executor eligibility while startup dispatch is paused without claiming', async () => {
    let dispatchEnabled = false
    const harness = runtimeHarness({
      authority: () => ({ ready: true, dispatchEnabled })
    })
    expect(harness.runtime.executorEligibility).toBe(false)
    await harness.runtime.tick()
    expect(harness.runtime.executorEligibility).toBe(true)
    expect(harness.runtime.readiness).toBe(false)
    expect(harness.calls.claims).toHaveLength(0)
    dispatchEnabled = true
    await harness.runtime.tick()
    expect(harness.calls.claims).toEqual(['worker-1', 'worker-2'])
  })

  it('retains an unstarted claim when the host cannot prove cancellation', async () => {
    let reads = 0
    const harness = runtimeHarness({
      authority: () => ({ ready: ++reads < 3, dispatchEnabled: true }),
      cancelUnstarted: async () => ({ confirmed: false })
    })
    await harness.runtime.tick()
    expect(harness.calls.runs).toHaveLength(0)
    expect(harness.runtime.snapshot()[0]?.state).toBe('active')
    expect(harness.runtime.readiness).toBe(false)
  })

  it('coalesces overlapping ticks while a claim is pending', async () => {
    const waiting = deferred<WorkerClaim | null>()
    const harness = runtimeHarness({ beforeClaim: async () => waiting.promise })
    const one = harness.runtime.tick()
    const two = harness.runtime.tick()
    expect(two).toBe(one)
    await flushMicrotasks()
    expect(harness.calls.claims).toEqual(['worker-1'])
    waiting.resolve(null)
    await one
    expect(harness.calls.claims).toEqual(['worker-1', 'worker-2'])
  })

  it('cancels only the exact lease with authoritative stopping state', async () => {
    const run = deferred<void>()
    const harness = runtimeHarness({
      workerRun: async () => run.promise,
      cancellation: async (lease) => ({
        kind: lease.workerId === 'worker-1' ? 'stopping' : 'not-stopping',
        lease
      })
    })
    await harness.runtime.tick()
    await flushMicrotasks()
    await harness.runtime.tick()
    expect(harness.calls.cancels).toEqual([leaseFor(harness.calls.runs[0]!)])
    expect(harness.calls.cancels[0]?.workerId).toBe('worker-1')
  })

  it('fails readiness closed for missing or mismatched cancellation observation', async () => {
    const run = deferred<void>()
    const harness = runtimeHarness({
      workerRun: async () => run.promise,
      cancellation: async () => ({ kind: 'unknown' })
    })
    await harness.runtime.tick()
    await flushMicrotasks()
    await harness.runtime.tick()
    expect(harness.calls.cancels).toHaveLength(0)
    expect(harness.runtime.readiness).toBe(false)
    expect(harness.runtime.executorEligibility).toBe(false)
    expect(harness.calls.claims).toHaveLength(2)
  })

  it('retains a rejected run and reservation when worker reconciliation is ambiguous', async () => {
    const run = deferred<void>()
    const reconciliations = new Map<string, number>()
    const harness = runtimeHarness({
      workerRun: async () => run.promise,
      workerReconcile: async (workerId) => {
        const count = (reconciliations.get(workerId) ?? 0) + 1
        reconciliations.set(workerId, count)
        return count === 1 ? 'idle' : 'ambiguous'
      }
    })
    await harness.runtime.tick()
    await flushMicrotasks()
    expect(harness.calls.runs).toHaveLength(2)
    run.reject(new Error('worker journal remains fenced'))
    await flushMicrotasks()
    await harness.runtime.tick()
    expect(harness.runtime.readiness).toBe(false)
    expect(harness.runtime.snapshot().every((slot) => slot.state !== 'idle')).toBe(true)
  })

  it('cancels a rejected pre-permit claim with an unknown lease read only after both authorities prove idle', async () => {
    const claim = claimFor('worker-1', 'hermes-1', 31)
    let claimed = false
    let leaseReads = 0
    const cancelled: WorkerClaim[] = []
    const harness = runtimeHarness({
      beforeClaim: async (workerId) => {
        if (workerId !== 'worker-1') {
          return null
        }
        claimed = true
        return claim
      },
      workerRun: async () => {
        throw new Error('Rejected before start permit was durable.')
      },
      activeLease: async (workerId) => {
        if (workerId !== 'worker-1' || !claimed) {
          return { kind: 'idle' }
        }
        leaseReads += 1
        return leaseReads === 1 ? { kind: 'unknown' } : { kind: 'idle' }
      },
      workerReconcile: async () => 'idle',
      cancelUnstarted: async (value) => {
        cancelled.push(value)
        return {
          confirmed: true,
          attemptId: value.attemptId,
          workerId: value.workerId,
          token: value.token
        }
      }
    })

    await harness.runtime.tick()
    await flushMicrotasks()

    expect(cancelled).toEqual([claim])
    expect(leaseReads).toBe(2)
    expect(harness.runtime.snapshot()[0]?.state).toBe('idle')
  })

  it('keeps a rejected claim fenced when start-permit cancellation is refused', async () => {
    let claimed = false
    const cancelled: WorkerClaim[] = []
    const harness = runtimeHarness({
      beforeClaim: async (workerId) => {
        if (workerId !== 'worker-1') {
          return null
        }
        claimed = true
        return claimFor(workerId, 'hermes-1', 32)
      },
      workerRun: async () => {
        throw new Error('The start-permit state is not provable.')
      },
      activeLease: async (workerId) =>
        workerId === 'worker-1' && claimed ? { kind: 'unknown' } : { kind: 'idle' },
      workerReconcile: async () => 'idle',
      cancelUnstarted: async (claim) => {
        cancelled.push(claim)
        return { confirmed: false }
      }
    })

    await harness.runtime.tick()
    await flushMicrotasks()

    expect(cancelled).toHaveLength(1)
    expect(harness.runtime.snapshot()[0]?.state).toBe('active')
    expect(harness.runtime.executorEligibility).toBe(false)
  })

  it('does not cancel a rejected claim when an orphan different lease owns the worker', async () => {
    let claimed = false
    const cancelled: WorkerClaim[] = []
    const otherLease = leaseFor(claimFor('worker-1', 'hermes-1', 99))
    const harness = runtimeHarness({
      beforeClaim: async (workerId) => {
        if (workerId !== 'worker-1') {
          return null
        }
        claimed = true
        return claimFor(workerId, 'hermes-1', 33)
      },
      workerRun: async () => {
        throw new Error('A different durable attempt is present.')
      },
      activeLease: async (workerId) =>
        workerId === 'worker-1' && claimed
          ? { kind: 'active', lease: otherLease }
          : { kind: 'idle' },
      workerReconcile: async () => 'idle',
      cancelUnstarted: async (claim) => {
        cancelled.push(claim)
        return { confirmed: false }
      }
    })

    await harness.runtime.tick()
    await flushMicrotasks()

    expect(cancelled).toHaveLength(0)
    expect(harness.runtime.snapshot()[0]?.state).toBe('active')
    expect(harness.runtime.executorEligibility).toBe(false)
  })

  it('settles a rejected worker task, refreshes cleanup evidence, and reports an unproven drain without throwing', async () => {
    const run = deferred<void>()
    let claimed = false
    const harness = runtimeHarness({
      beforeClaim: async (workerId) => {
        if (workerId !== 'worker-1') {
          return null
        }
        claimed = true
        return claimFor(workerId, 'hermes-1', 34)
      },
      workerRun: async () => run.promise,
      activeLease: async (workerId) =>
        workerId === 'worker-1' && claimed ? { kind: 'unknown' } : { kind: 'idle' },
      workerReconcile: async () => 'idle',
      cancelUnstarted: async () => ({ confirmed: false })
    })

    await harness.runtime.tick()
    const shutdown = harness.runtime.shutdown(5_000)
    run.reject(new Error('Worker stopped before settlement receipt.'))
    const result = await shutdown

    expect(result.timedOut).toBe(false)
    expect(result.cleanupProven).toBe(false)
    expect(result.slots[0]?.state).toBe('active')
    expect(harness.runtime.executorEligibility).toBe(false)
  })

  it('keeps timed-out shutdown slots occupied until run settlement and reconciliation', async () => {
    const run = deferred<void>()
    const events: string[] = []
    const harness = runtimeHarness({
      workerRun: async () => run.promise,
      cancellation: async (lease) => {
        events.push(`observe:${lease.workerId}`)
        return { kind: 'stopping', lease }
      },
      requestCancellation: async (lease) => {
        events.push(`request:${lease.workerId}`)
        return {
          confirmed: true,
          attemptId: lease.attemptId,
          workerId: lease.workerId,
          token: lease.token
        }
      },
      workerCancel: async (lease) => {
        events.push(`cancel:${lease.workerId}`)
      }
    })
    await harness.runtime.tick()
    await flushMicrotasks()
    expect(harness.calls.runs).toHaveLength(2)
    const result = await harness.runtime.shutdown(1)
    expect(result.cleanupProven).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.slots.some((slot) => slot.state === 'active')).toBe(true)
    expect(harness.runtime.readiness).toBe(false)
    expect(harness.runtime.executorEligibility).toBe(false)
    expect(events).toContain('request:worker-1')
    expect(events.indexOf('request:worker-1')).toBeLessThan(events.indexOf('observe:worker-1'))
    expect(events.indexOf('observe:worker-1')).toBeLessThan(events.indexOf('cancel:worker-1'))
    harness.active.clear()
    run.resolve()
    await flushMicrotasks()
    expect(harness.runtime.snapshot().every((slot) => slot.state === 'idle')).toBe(true)
  })
})
