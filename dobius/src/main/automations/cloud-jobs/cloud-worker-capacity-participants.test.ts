import { describe, expect, it, vi } from 'vitest'
import {
  C02_CAPACITY_INTENT,
  MANAGED_EXTERNAL_PRODUCERS,
  createCloudWorkerCapacityParticipants,
  type CapacityParticipantsOptions,
  type ParticipantFactory,
  type ParticipantObservation,
  type ReservationIntent
} from './cloud-worker-capacity-participants'

const scope = { deviceId: 'worker_test-device', filesystemId: '42' }
const generation = 'authority-7'
const now = 100_000

function factory(
  id: ParticipantFactory['id'],
  overrides: Partial<ParticipantObservation> = {},
  reserve: (intent: ReservationIntent) => unknown = vi.fn(() => ({
    revision: 1,
    changed: true,
    sourceRevisionAfter: 'r1'
  }))
): ParticipantFactory {
  const declared = MANAGED_EXTERNAL_PRODUCERS.find((participant) => participant.id === id)!
  return {
    ...declared,
    create: (boundScope, boundGeneration) => ({
      read: () => ({
        ...boundScope,
        authorityGeneration: boundGeneration,
        sourceRevision: 'r1',
        reservationRevision: 0,
        sampledAt: now,
        lifecycle: 'active',
        reservedBytes: 0,
        ...overrides
      }),
      reserve
    })
  }
}

function mutableFactory(
  id: ParticipantFactory['id'],
  state: ParticipantObservation,
  reserve: (intent: ReservationIntent) => unknown = () => undefined
): ParticipantFactory {
  const declared = MANAGED_EXTERNAL_PRODUCERS.find((participant) => participant.id === id)!
  return {
    ...declared,
    create: () => ({ read: () => state, reserve })
  }
}

function factories(): ParticipantFactory[] {
  return MANAGED_EXTERNAL_PRODUCERS.map(({ id }) => factory(id))
}

function registry(participants: readonly ParticipantFactory[] = factories(), extra = {}) {
  const options: CapacityParticipantsOptions = {
    ...scope,
    authorityGeneration: generation,
    participants,
    now: () => now,
    ...extra
  }
  return createCloudWorkerCapacityParticipants(options)
}

describe('managed cloud worker capacity participants', () => {
  it('rejects a missing expected participant and an unknown writer', () => {
    const missing = registry(factories().slice(1))
    const summary = missing.summarizeManagedEnrollment()
    expect(summary.unavailable).toContain('speech-model-cache')
    expect(summary.managedExternalReservedBytes).toBeNull()
    expect(missing.capabilityFor('speech-model-cache')).toBeNull()

    const withUnknown = [...factories(), { ...factory('speech-model-cache'), id: 'unknown-writer' }]
    expect(registry(withUnknown).summarizeManagedEnrollment().unavailable.length).toBeGreaterThan(0)
  })

  it('rejects wrong owner declarations, duplicate enrollment, device and filesystem identity', () => {
    const misdeclared = factories()
    misdeclared[0] = { ...misdeclared[0], kind: 'bounded-helper-download' }
    expect(registry(misdeclared).summarizeManagedEnrollment().unavailable.length).toBeGreaterThan(0)

    const duplicate = [...factories(), factories()[0]]
    expect(registry(duplicate).summarizeManagedEnrollment().unavailable.length).toBeGreaterThan(0)

    const overrides: Partial<ParticipantObservation>[] = [
      { deviceId: 'worker_other-device' },
      { filesystemId: '43' },
      { authorityGeneration: 'old-generation' }
    ]
    for (const override of overrides) {
      const changed = factories().map((entry, index) =>
        index === 0 ? factory(entry.id, { ...scope, ...override }) : entry
      )
      expect(registry(changed).summarizeManagedEnrollment().unavailable).toContain(changed[0].id)
    }
    expect(() => registry(factories(), { filesystemId: 'bad-id' })).toThrow(/filesystem identity/)
  })

  it('separates the two C02 worker slots from non-C02 producer intents', () => {
    expect(C02_CAPACITY_INTENT.workerSlots).toEqual(['hermes-1', 'hermes-2'])
    expect(C02_CAPACITY_INTENT.accounting).toBe('c02-job-reservations')
    const externalIds: readonly string[] = MANAGED_EXTERNAL_PRODUCERS.map(({ id }) => id)
    expect(externalIds).not.toContain('cloud-jobs')
    const summary = registry(
      factories().map((entry, index) =>
        index === 0 ? factory(entry.id, { reservedBytes: 17 }) : entry
      )
    ).summarizeManagedEnrollment()
    expect(summary.managedExternalReservedBytes).toBe(17)
    expect(summary).not.toHaveProperty('c02ReservedBytes')
  })

  it('invalidates owner capabilities when lifecycle or source revision changes', () => {
    let lifecycle: ParticipantObservation['lifecycle'] = 'active'
    let revision = 'r1'
    const reserveOnRevisionChange = vi.fn(() => ({
      revision: 1,
      changed: true,
      sourceRevisionAfter: 'r1'
    }))
    const participants = factories().map((entry, index) =>
      index === 0
        ? {
            ...entry,
            create: (boundScope: typeof scope, boundGeneration: string) => ({
              read: () => ({
                ...boundScope,
                authorityGeneration: boundGeneration,
                sourceRevision: revision,
                reservationRevision: 0,
                sampledAt: now,
                lifecycle,
                reservedBytes: 0
              }),
              reserve: reserveOnRevisionChange
            })
          }
        : entry
    )
    const subject = registry(participants)
    subject.summarizeManagedEnrollment()
    const staleOnDrain = subject.capabilityFor('speech-model-cache')!
    lifecycle = 'recovering'
    subject.summarizeManagedEnrollment()
    expect(() =>
      staleOnDrain.reserve({ reservationId: 'r1', bytes: 1, expectedRevision: 0 })
    ).toThrow(/stale/)

    lifecycle = 'active'
    subject.summarizeManagedEnrollment()
    const staleOnSourceChange = subject.capabilityFor('speech-model-cache')!
    revision = 'r2'
    expect(() =>
      staleOnSourceChange.reserve({ reservationId: 'r2', bytes: 1, expectedRevision: 0 })
    ).toThrow(/stale/)
    expect(reserveOnRevisionChange).not.toHaveBeenCalled()
  })

  it('keeps stale, throwing, reentrant and unknown lifecycle readers unavailable', () => {
    const stale = factories().map((entry, index) =>
      index === 0 ? factory(entry.id, { sampledAt: now - 6_000 }) : entry
    )
    expect(registry(stale).summarizeManagedEnrollment().unavailable).toContain('speech-model-cache')

    const throwing = factories().map((entry, index) =>
      index === 0
        ? {
            ...entry,
            create: () => ({
              read: () => {
                throw new Error('reader failure')
              },
              reserve: vi.fn()
            })
          }
        : entry
    )
    expect(registry(throwing).summarizeManagedEnrollment().unavailable).toContain(
      'speech-model-cache'
    )

    let subject: ReturnType<typeof registry>
    const reentrant = factories().map((entry, index) =>
      index === 0
        ? {
            ...entry,
            create: (boundScope: typeof scope, boundGeneration: string) => ({
              read: () => {
                subject.summarizeManagedEnrollment()
                return {
                  ...boundScope,
                  authorityGeneration: boundGeneration,
                  sourceRevision: 'r1',
                  reservationRevision: 0,
                  sampledAt: now,
                  lifecycle: 'active' as const,
                  reservedBytes: 0
                }
              },
              reserve: vi.fn()
            })
          }
        : entry
    )
    subject = registry(reentrant)
    expect(subject.summarizeManagedEnrollment().unavailable.length).toBeGreaterThan(0)
    expect(subject.capabilityFor('speech-model-cache')).toBeNull()

    const unknownState = factories().map((entry, index) =>
      index === 0 ? factory(entry.id, { lifecycle: 'unknown' }) : entry
    )
    expect(registry(unknownState).summarizeManagedEnrollment().unavailable).toContain(
      'speech-model-cache'
    )
  })

  it('never turns zero rows into complete coverage or available capacity', () => {
    const subject = registry()
    const summary = subject.summarizeManagedEnrollment()
    expect(summary.managedExternalReservedBytes).toBe(0)
    expect(summary.status).toBe('managed-enrollment-summary')
    expect(summary).not.toHaveProperty('complete')
    expect(subject.availability()).toEqual({
      status: 'unavailable',
      reason: 'managed-writer-exclusion-unproven'
    })
  })

  it('accepts a matching CAS and exact idempotent replay postcondition', () => {
    const state: ParticipantObservation = {
      ...scope,
      authorityGeneration: generation,
      sourceRevision: 'source-1',
      reservationRevision: 0,
      sampledAt: now,
      lifecycle: 'active',
      reservedBytes: 0
    }
    const reserve = vi.fn((intent: { expectedRevision: number; bytes: number }) => {
      if (intent.expectedRevision === 0) {
        Object.assign(state, {
          sourceRevision: 'source-2',
          reservationRevision: 1,
          reservedBytes: intent.bytes
        })
        return { revision: 1, changed: true, sourceRevisionAfter: 'source-2' }
      }
      return { revision: 1, changed: false, sourceRevisionAfter: 'source-2' }
    })
    const subject = registry(
      factories().map((entry) =>
        entry.id === 'speech-model-cache' ? mutableFactory(entry.id, state, reserve) : entry
      )
    )
    subject.summarizeManagedEnrollment()
    const capability = subject.capabilityFor('speech-model-cache')!
    expect(capability.scope).toEqual(scope)
    expect(
      capability.reserve({ reservationId: 'intent-1', bytes: 9, expectedRevision: 0 })
    ).toEqual({ revision: 1, changed: true, sourceRevisionAfter: 'source-2' })
    expect(subject.summarizeManagedEnrollment().managedExternalReservedBytes).toBe(9)
    const replayCapability = subject.capabilityFor('speech-model-cache')!
    expect(
      replayCapability.reserve({ reservationId: 'intent-1', bytes: 9, expectedRevision: 1 })
    ).toEqual({ revision: 1, changed: false, sourceRevisionAfter: 'source-2' })
    expect(reserve).toHaveBeenCalledTimes(2)
    expect(subject.capabilityFor('cloud-jobs')).toBeNull()
    expect(() =>
      replayCapability.reserve({ reservationId: '', bytes: 1, expectedRevision: 1 })
    ).toThrow(/intent/)
    subject.invalidateForLifecycleChange()
    expect(() =>
      replayCapability.reserve({ reservationId: 'intent-2', bytes: 1, expectedRevision: 2 })
    ).toThrow(/stale/)
  })

  it('rejects malformed, asynchronous and conflicting receipts and permanently fences retries', () => {
    const malformed: unknown[] = [
      null,
      [],
      { revision: -1, changed: false, sourceRevisionAfter: 'source-1' },
      { revision: Number.MAX_SAFE_INTEGER + 1, changed: true, sourceRevisionAfter: 'source-2' },
      { revision: 0, changed: true, sourceRevisionAfter: 'source-2' },
      { revision: 1, changed: false, sourceRevisionAfter: 'source-1' },
      { revision: 1, changed: true, sourceRevisionAfter: 'source-2', extra: true },
      Promise.resolve({ revision: 1, changed: true, sourceRevisionAfter: 'source-2' })
    ]
    for (const result of malformed) {
      const reserve = vi.fn(() => result)
      const subject = registry(
        factories().map((entry) =>
          entry.id === 'speech-model-cache' ? factory(entry.id, {}, reserve) : entry
        )
      )
      subject.summarizeManagedEnrollment()
      const capability = subject.capabilityFor('speech-model-cache')!
      expect(() =>
        capability.reserve({ reservationId: 'bad-receipt', bytes: 1, expectedRevision: 0 })
      ).toThrow(/postcondition/)
      expect(subject.summarizeManagedEnrollment().managedExternalReservedBytes).toBeNull()
      expect(() =>
        capability.reserve({ reservationId: 'retry', bytes: 1, expectedRevision: 0 })
      ).toThrow(/stale/)
    }
  })

  it('refuses stale scope, generation, lifecycle and unrelated revision changes after reserve', () => {
    const mutations: Partial<ParticipantObservation>[] = [
      { deviceId: 'worker_other-device' },
      { filesystemId: '43' },
      { authorityGeneration: 'authority-8' },
      { lifecycle: 'draining' },
      { sourceRevision: 'unrelated-change' },
      { reservationRevision: 1 }
    ]
    for (const mutation of mutations) {
      const state: ParticipantObservation = {
        ...scope,
        authorityGeneration: generation,
        sourceRevision: 'source-1',
        reservationRevision: 0,
        sampledAt: now,
        lifecycle: 'active',
        reservedBytes: 0
      }
      const reserve = vi.fn(() => {
        Object.assign(state, mutation)
        return { revision: 1, changed: true, sourceRevisionAfter: 'source-1' }
      })
      const subject = registry(
        factories().map((entry) =>
          entry.id === 'speech-model-cache' ? mutableFactory(entry.id, state, reserve) : entry
        )
      )
      subject.summarizeManagedEnrollment()
      const capability = subject.capabilityFor('speech-model-cache')!
      expect(() =>
        capability.reserve({ reservationId: 'changed-state', bytes: 1, expectedRevision: 0 })
      ).toThrow(/postcondition/)
      expect(subject.summarizeManagedEnrollment().managedExternalReservedBytes).toBeNull()
    }
  })

  it('fences a reader that fails during the required post-reservation observation', () => {
    let reads = 0
    const reserve = vi.fn(() => ({
      revision: 1,
      changed: true,
      sourceRevisionAfter: 'source-1'
    }))
    const participant = factory('speech-model-cache', {}, reserve)
    const originalCreate = participant.create
    participant.create = (boundScope, boundGeneration) => {
      const adapter = originalCreate(boundScope, boundGeneration)
      return {
        ...adapter,
        read: () => {
          reads += 1
          if (reads === 3) {
            throw new Error('post-read failed')
          }
          return adapter.read()
        }
      }
    }
    const subject = registry(
      factories().map((entry) => (entry.id === participant.id ? participant : entry))
    )
    subject.summarizeManagedEnrollment()
    const capability = subject.capabilityFor('speech-model-cache')!
    expect(() =>
      capability.reserve({ reservationId: 'post-read-failure', bytes: 1, expectedRevision: 0 })
    ).toThrow(/postcondition/)
    expect(subject.summarizeManagedEnrollment().managedExternalReservedBytes).toBeNull()
  })

  it('fences a malformed post-reservation observation without throwing through the registry', () => {
    let reads = 0
    const participant = factory(
      'speech-model-cache',
      {},
      vi.fn(() => ({ revision: 1, changed: true, sourceRevisionAfter: 'r1' }))
    )
    const originalCreate = participant.create
    participant.create = (boundScope, boundGeneration) => {
      const adapter = originalCreate(boundScope, boundGeneration)
      return {
        ...adapter,
        read: () => {
          reads += 1
          return reads === 3 ? null : adapter.read()
        }
      }
    }
    const subject = registry(
      factories().map((entry) => (entry.id === participant.id ? participant : entry))
    )
    subject.summarizeManagedEnrollment()
    const capability = subject.capabilityFor('speech-model-cache')!
    expect(() =>
      capability.reserve({ reservationId: 'null-post-read', bytes: 1, expectedRevision: 0 })
    ).toThrow(/postcondition/)
    expect(subject.summarizeManagedEnrollment().managedExternalReservedBytes).toBeNull()
  })

  it('fences reentrant reservation reads and rejects revision exhaustion before writing', () => {
    let subject: ReturnType<typeof registry>
    const reentrant = vi.fn(() => {
      subject.summarizeManagedEnrollment()
      return { revision: 1, changed: true, sourceRevisionAfter: 'source-2' }
    })
    subject = registry(
      factories().map((entry) =>
        entry.id === 'speech-model-cache' ? factory(entry.id, {}, reentrant) : entry
      )
    )
    subject.summarizeManagedEnrollment()
    const capability = subject.capabilityFor('speech-model-cache')!
    expect(() =>
      capability.reserve({ reservationId: 'reentrant', bytes: 1, expectedRevision: 0 })
    ).toThrow(/postcondition/)
    expect(subject.summarizeManagedEnrollment().managedExternalReservedBytes).toBeNull()

    const reserve = vi.fn()
    const exhausted = registry(
      factories().map((entry) =>
        entry.id === 'speech-model-cache'
          ? factory(entry.id, { reservationRevision: Number.MAX_SAFE_INTEGER }, reserve)
          : entry
      )
    )
    exhausted.summarizeManagedEnrollment()
    const exhaustedCapability = exhausted.capabilityFor('speech-model-cache')!
    expect(() =>
      exhaustedCapability.reserve({
        reservationId: 'overflow',
        bytes: 1,
        expectedRevision: Number.MAX_SAFE_INTEGER
      })
    ).toThrow(/exhausted/)
    expect(reserve).not.toHaveBeenCalled()
    expect(exhausted.summarizeManagedEnrollment().managedExternalReservedBytes).toBe(0)
  })

  it('refuses per-target and cohort byte overflow before the writer and keeps the registry usable', () => {
    const cases = [
      { targetBytes: Number.MAX_SAFE_INTEGER, otherBytes: 0 },
      { targetBytes: 0, otherBytes: Number.MAX_SAFE_INTEGER }
    ]
    for (const { targetBytes, otherBytes } of cases) {
      const reserve = vi.fn(() => undefined)
      const participants = factories().map((entry) =>
        factory(
          entry.id,
          {
            reservedBytes:
              entry.id === 'speech-model-cache'
                ? targetBytes
                : entry.id === 'browser-downloads'
                  ? otherBytes
                  : 0
          },
          entry.id === 'speech-model-cache' ? reserve : undefined
        )
      )
      const subject = registry(participants)
      const before = subject.summarizeManagedEnrollment().managedExternalReservedBytes
      const capability = subject.capabilityFor('speech-model-cache')!
      expect(() =>
        capability.reserve({ reservationId: 'overflow', bytes: 1, expectedRevision: 0 })
      ).toThrow(/overflow/)
      expect(reserve).not.toHaveBeenCalled()
      expect(subject.summarizeManagedEnrollment().managedExternalReservedBytes).toBe(before)
      expect(subject.capabilityFor('speech-model-cache')).not.toBeNull()
    }
  })

  it('allows a reservation whose target and resulting cohort sums reach the safe boundary', () => {
    const states = new Map<string, ParticipantObservation>()
    for (const { id } of MANAGED_EXTERNAL_PRODUCERS) {
      states.set(id, {
        ...scope,
        authorityGeneration: generation,
        sourceRevision: 'source-1',
        reservationRevision: 0,
        sampledAt: now,
        lifecycle: 'active',
        reservedBytes: id === 'browser-downloads' ? Number.MAX_SAFE_INTEGER - 5 : 0
      })
    }
    const target = states.get('speech-model-cache')!
    const reserve = vi.fn((intent: ReservationIntent) => {
      Object.assign(target, {
        sourceRevision: 'source-2',
        reservationRevision: 1,
        reservedBytes: intent.bytes
      })
      return { revision: 1, changed: true, sourceRevisionAfter: 'source-2' }
    })
    const subject = registry(
      MANAGED_EXTERNAL_PRODUCERS.map(({ id }) =>
        mutableFactory(id, states.get(id)!, id === 'speech-model-cache' ? reserve : undefined)
      )
    )
    subject.summarizeManagedEnrollment()
    const capability = subject.capabilityFor('speech-model-cache')!
    expect(
      capability.reserve({ reservationId: 'boundary', bytes: 5, expectedRevision: 0 })
    ).toEqual({ revision: 1, changed: true, sourceRevisionAfter: 'source-2' })
    expect(subject.summarizeManagedEnrollment().managedExternalReservedBytes).toBe(
      Number.MAX_SAFE_INTEGER
    )
  })

  it('fences a non-target reservation change even when its source revision stays constant', () => {
    const states = new Map<string, ParticipantObservation>()
    for (const { id } of MANAGED_EXTERNAL_PRODUCERS) {
      states.set(id, {
        ...scope,
        authorityGeneration: generation,
        sourceRevision: 'source-1',
        reservationRevision: 0,
        sampledAt: now,
        lifecycle: 'active',
        reservedBytes: 0
      })
    }
    const target = states.get('speech-model-cache')!
    const other = states.get('browser-downloads')!
    const reserve = vi.fn((intent: ReservationIntent) => {
      Object.assign(target, {
        sourceRevision: 'source-2',
        reservationRevision: 1,
        reservedBytes: intent.bytes
      })
      Object.assign(other, { reservationRevision: 1, reservedBytes: intent.bytes })
      return { revision: 1, changed: true, sourceRevisionAfter: 'source-2' }
    })
    const subject = registry(
      MANAGED_EXTERNAL_PRODUCERS.map(({ id }) =>
        mutableFactory(id, states.get(id)!, id === 'speech-model-cache' ? reserve : undefined)
      )
    )
    subject.summarizeManagedEnrollment()
    const capability = subject.capabilityFor('speech-model-cache')!
    expect(() =>
      capability.reserve({ reservationId: 'cross-cohort-change', bytes: 3, expectedRevision: 0 })
    ).toThrow(/postcondition/)
    expect(reserve).toHaveBeenCalledOnce()
    expect(subject.summarizeManagedEnrollment().managedExternalReservedBytes).toBeNull()
    expect(() =>
      capability.reserve({ reservationId: 'retry', bytes: 1, expectedRevision: 1 })
    ).toThrow(/stale/)
  })

  it('retains uncertainty and fences retries after an ambiguous reservation failure', () => {
    const reserve = vi.fn(() => {
      throw new Error('write outcome unknown')
    })
    const subject = registry(
      factories().map((entry) =>
        entry.id === 'speech-model-cache' ? factory(entry.id, {}, reserve) : entry
      )
    )
    subject.summarizeManagedEnrollment()
    const capability = subject.capabilityFor('speech-model-cache')!
    expect(() =>
      capability.reserve({ reservationId: 'ambiguous-1', bytes: 64, expectedRevision: 0 })
    ).toThrow(/unknown/)
    expect(reserve).toHaveBeenCalledOnce()
    expect(() =>
      capability.reserve({ reservationId: 'retry', bytes: 64, expectedRevision: 0 })
    ).toThrow(/stale/)
    expect(subject.summarizeManagedEnrollment().managedExternalReservedBytes).toBeNull()
    expect(subject.availability().status).toBe('unavailable')
  })
})
