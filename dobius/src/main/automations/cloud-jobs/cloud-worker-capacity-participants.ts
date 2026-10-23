import {
  parseReservationReceipt,
  reservationFitsKnownTotals,
  reservationPostconditionMatches,
  validateCapacityParticipantScope,
  validateReservationIntent,
  type CapacityAdmissionAvailability,
  type CapacityParticipantsOptions,
  type ManagedCapacitySummary,
  type ParticipantAdapter,
  type ParticipantObservation,
  type ReservationIntent,
  type ReservationReceipt
} from './cloud-worker-capacity-reservation-postconditions'
import {
  nonTargetCohortUnchanged,
  readValidSampleTime,
  snapshotParticipantCohort,
  snapshotParticipantObservation
} from './cloud-worker-capacity-cohort-snapshot'

export type {
  CapacityParticipantScope,
  CapacityAdmissionAvailability,
  CapacityParticipantsOptions,
  ManagedCapacitySummary,
  ParticipantAdapter,
  ParticipantFactory,
  ParticipantLifecycle,
  ParticipantObservation,
  ReservationIntent,
  ReservationReceipt
} from './cloud-worker-capacity-reservation-postconditions'

const MAX_SAFE = Number.MAX_SAFE_INTEGER

export const C02_CAPACITY_INTENT = Object.freeze({
  owner: 'cloud-jobs',
  accounting: 'c02-job-reservations',
  workerSlots: Object.freeze(['hermes-1', 'hermes-2'] as const)
})

export const MANAGED_EXTERNAL_PRODUCERS = Object.freeze([
  { id: 'speech-model-cache', kind: 'speech-model-download-extract-migrate' },
  { id: 'scrcpy-helper-download', kind: 'bounded-helper-download' },
  { id: 'browser-downloads', kind: 'browser-download' },
  { id: 'native-downloads', kind: 'bounded-native-download' },
  { id: 'ssh-transfers', kind: 'remote-file-transfer' },
  { id: 'build-package-install', kind: 'operator-build-package-install' },
  { id: 'temporary-state', kind: 'temporary-log-database-growth' }
] as const)

export type ManagedProducerId = (typeof MANAGED_EXTERNAL_PRODUCERS)[number]['id']
export function createCloudWorkerCapacityParticipants(options: CapacityParticipantsOptions) {
  const scope = validateCapacityParticipantScope(options)
  if (typeof options.authorityGeneration !== 'string' || !options.authorityGeneration.trim()) {
    throw new Error('Capacity authority generation is invalid.')
  }
  const now = options.now ?? Date.now

  const expected = new Map<string, string>(
    MANAGED_EXTERNAL_PRODUCERS.map(({ id, kind }) => [id, kind])
  )
  const factories = new Map<string, ParticipantAdapter>()
  let invalidConfiguration = options.participants.length !== expected.size
  for (const factory of options.participants) {
    const expectedKind = expected.get(factory.id)
    if (!expectedKind || expectedKind !== factory.kind || factories.has(factory.id)) {
      invalidConfiguration = true
      continue
    }
    try {
      factories.set(
        factory.id,
        factory.create(Object.freeze({ ...scope }), options.authorityGeneration)
      )
    } catch {
      invalidConfiguration = true
    }
  }
  let epoch = 1,
    sampling = false,
    reservationCallbackActive = false,
    reservationReentered = false,
    permanentlyUnavailable = invalidConfiguration
  const revisions = new Map<string, string>(),
    handles = new Map<string, number>(),
    observations = new Map<string, ParticipantObservation>()

  const invalidate = (): void => {
    if (epoch < MAX_SAFE) {
      epoch += 1
    } else {
      permanentlyUnavailable = true
    }
    handles.clear()
  }
  const unavailableSummary = (): ManagedCapacitySummary<ManagedProducerId> => ({
    ...scope,
    status: 'managed-enrollment-summary',
    registryGeneration: epoch,
    enrolled: [],
    unavailable: MANAGED_EXTERNAL_PRODUCERS.map(({ id }) => id),
    managedExternalReservedBytes: null
  })

  const readSummary = (): ManagedCapacitySummary<ManagedProducerId> => {
    if (reservationCallbackActive) {
      reservationReentered = true
      invalidate()
      permanentlyUnavailable = true
      return unavailableSummary()
    }
    const enrolled: ManagedProducerId[] = []
    const unavailable: ManagedProducerId[] = []
    let total = 0
    const sampledAt = readValidSampleTime(now)
    if (sampledAt === null) {
      invalidate()
      return unavailableSummary()
    }
    if (sampling) {
      invalidate()
      return unavailableSummary()
    }
    sampling = true
    const startingEpoch = epoch
    try {
      observations.clear()
      for (const { id } of MANAGED_EXTERNAL_PRODUCERS) {
        const participant = factories.get(id)
        if (!participant || permanentlyUnavailable) {
          unavailable.push(id)
          continue
        }
        let observation: ParticipantObservation | null
        try {
          observation = snapshotParticipantObservation(
            participant.read(),
            scope,
            options.authorityGeneration,
            sampledAt
          )
        } catch {
          invalidate()
          permanentlyUnavailable = true
          unavailable.push(id)
          continue
        }
        if (!observation) {
          invalidate()
          unavailable.push(id)
          continue
        }
        observations.set(id, observation)
        const prior = revisions.get(id)
        if (prior !== undefined && prior !== observation.sourceRevision) {
          invalidate()
          revisions.set(id, observation.sourceRevision)
          unavailable.push(id)
          continue
        }
        revisions.set(id, observation.sourceRevision)
        if (observation.lifecycle !== 'active') {
          invalidate()
          unavailable.push(id)
          continue
        }
        if (total > MAX_SAFE - observation.reservedBytes) {
          invalidate()
          unavailable.push(id)
          continue
        }
        total += observation.reservedBytes
        enrolled.push(id)
      }
    } finally {
      sampling = false
    }
    if (epoch !== startingEpoch || permanentlyUnavailable || unavailable.length > 0) {
      handles.clear()
      return {
        ...scope,
        status: 'managed-enrollment-summary',
        registryGeneration: epoch,
        enrolled,
        unavailable: unavailable.length
          ? unavailable
          : MANAGED_EXTERNAL_PRODUCERS.map(({ id }) => id),
        managedExternalReservedBytes: null
      }
    }
    for (const id of enrolled) {
      handles.set(id, epoch)
    }
    return {
      ...scope,
      status: 'managed-enrollment-summary',
      registryGeneration: epoch,
      enrolled,
      unavailable,
      managedExternalReservedBytes: total
    }
  }

  return {
    summarizeManagedEnrollment: readSummary,
    availability(): CapacityAdmissionAvailability {
      const summary = readSummary()
      return {
        status: 'unavailable',
        reason: summary.unavailable.length
          ? 'participant-coverage-unverified'
          : 'managed-writer-exclusion-unproven'
      }
    },
    invalidateForLifecycleChange(): void {
      invalidate()
      permanentlyUnavailable = true
    },
    capabilityFor(id: string) {
      const producer = MANAGED_EXTERNAL_PRODUCERS.find((entry) => entry.id === id)
      if (!producer || !factories.has(producer.id)) {
        return null
      }
      const participant = factories.get(producer.id)!
      const issuedEpoch = handles.get(producer.id)
      if (issuedEpoch === undefined || issuedEpoch !== epoch || permanentlyUnavailable) {
        return null
      }
      return Object.freeze({
        producerId: producer.id,
        scope: Object.freeze({ ...scope }),
        reserve(intent: ReservationIntent): ReservationReceipt {
          if (
            issuedEpoch !== epoch ||
            handles.get(producer.id) !== issuedEpoch ||
            permanentlyUnavailable
          ) {
            throw new Error('Capacity participant capability is stale.')
          }
          validateReservationIntent(intent)
          if (intent.expectedRevision === MAX_SAFE) {
            throw new Error('Capacity reservation revision is exhausted.')
          }
          const current = readSummary()
          const beforeCohort = snapshotParticipantCohort(observations)
          const before = beforeCohort.get(producer.id)
          if (
            current.unavailable.length ||
            !before ||
            issuedEpoch !== epoch ||
            before.reservationRevision !== intent.expectedRevision
          ) {
            throw new Error('Capacity participant capability is stale.')
          }
          if (!reservationFitsKnownTotals(intent, before, current.managedExternalReservedBytes)) {
            throw new Error('Capacity reservation would overflow known safe byte totals.')
          }
          let rawReceipt: unknown
          reservationReentered = false
          reservationCallbackActive = true
          try {
            rawReceipt = participant.reserve(Object.freeze({ ...intent }))
          } catch (error) {
            invalidate()
            permanentlyUnavailable = true
            throw new Error('Capacity reservation outcome is unknown.', { cause: error })
          } finally {
            reservationCallbackActive = false
          }
          let receipt: ReservationReceipt | null = null
          try {
            receipt = parseReservationReceipt(rawReceipt)
          } catch {
            // An untrusted result cannot define a revision baseline for the post-write read.
          }
          if (receipt?.changed) {
            revisions.set(producer.id, receipt.sourceRevisionAfter)
          }
          const afterSummary = readSummary()
          const afterCohort = snapshotParticipantCohort(observations)
          const after = afterCohort.get(producer.id)
          const validPostcondition =
            !reservationReentered &&
            receipt !== null &&
            afterSummary.unavailable.length === 0 &&
            afterSummary.managedExternalReservedBytes !== null &&
            issuedEpoch === epoch &&
            handles.get(producer.id) === issuedEpoch &&
            after !== undefined &&
            nonTargetCohortUnchanged(
              beforeCohort,
              afterCohort,
              producer.id,
              MANAGED_EXTERNAL_PRODUCERS
            ) &&
            reservationPostconditionMatches(before, after, intent, receipt) &&
            (!receipt.changed || intent.expectedRevision < MAX_SAFE)
          if (!receipt || !validPostcondition) {
            invalidate()
            permanentlyUnavailable = true
            throw new Error('Capacity reservation postcondition is unknown.')
          }
          return receipt
        }
      })
    }
  }
}
