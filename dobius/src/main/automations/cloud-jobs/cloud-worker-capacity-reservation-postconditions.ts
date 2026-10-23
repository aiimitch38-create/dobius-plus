import { WorkerId } from '../../../shared/workstation-worker'

const FILESYSTEM_ID = /^(0|[1-9][0-9]*)$/
export type CapacityParticipantScope = { deviceId: string; filesystemId: string }
export type ReservationIntent = { reservationId: string; bytes: number; expectedRevision: number }
export type ReservationReceipt = {
  revision: number
  changed: boolean
  sourceRevisionAfter: string
}
export type ParticipantLifecycle =
  | 'active'
  | 'starting'
  | 'recovering'
  | 'draining'
  | 'stopped'
  | 'unknown'
export type ParticipantObservation = CapacityParticipantScope & {
  authorityGeneration: string
  sourceRevision: string
  reservationRevision: number
  sampledAt: number
  lifecycle: ParticipantLifecycle
  reservedBytes: number
}
export type ManagedCapacitySummary<TProducer extends string = string> = CapacityParticipantScope & {
  status: 'managed-enrollment-summary'
  registryGeneration: number
  enrolled: readonly TProducer[]
  unavailable: readonly TProducer[]
  managedExternalReservedBytes: number | null
}
export type CapacityAdmissionAvailability = {
  status: 'unavailable'
  reason: 'managed-writer-exclusion-unproven' | 'participant-coverage-unverified'
}
export type ParticipantAdapter = {
  read(): unknown
  reserve(intent: ReservationIntent): unknown
}
export type ParticipantFactory = {
  id: string
  kind: string
  create(scope: Readonly<CapacityParticipantScope>, authorityGeneration: string): ParticipantAdapter
}
export type CapacityParticipantsOptions = CapacityParticipantScope & {
  authorityGeneration: string
  participants: readonly ParticipantFactory[]
  now?: () => number
}

export function validateCapacityParticipantScope(
  input: CapacityParticipantScope
): CapacityParticipantScope {
  const deviceId = WorkerId.parse(input.deviceId)
  if (typeof input.filesystemId === 'string' && FILESYSTEM_ID.test(input.filesystemId)) {
    return { deviceId, filesystemId: input.filesystemId }
  }
  throw new Error('Capacity filesystem identity is invalid.')
}

export function parseReservationReceipt(value: unknown): ReservationReceipt | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return null
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== 3 ||
    !keys.includes('revision') ||
    !keys.includes('changed') ||
    !keys.includes('sourceRevisionAfter')
  ) {
    return null
  }
  const fields = Object.getOwnPropertyDescriptors(value)
  const revision = fields.revision?.value
  const changed = fields.changed?.value
  const sourceRevisionAfter = fields.sourceRevisionAfter?.value
  if (
    !fields.revision ||
    !('value' in fields.revision) ||
    !fields.changed ||
    !('value' in fields.changed) ||
    !fields.sourceRevisionAfter ||
    !('value' in fields.sourceRevisionAfter) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    typeof changed !== 'boolean' ||
    typeof sourceRevisionAfter !== 'string' ||
    !sourceRevisionAfter.trim() ||
    'then' in value
  ) {
    return null
  }
  return { revision, changed, sourceRevisionAfter }
}

export function reservationPostconditionMatches(
  before: ParticipantObservation,
  after: ParticipantObservation,
  intent: ReservationIntent,
  receipt: ReservationReceipt
): boolean {
  const revision = receipt.changed ? intent.expectedRevision + 1 : intent.expectedRevision
  const bytes = receipt.changed ? before.reservedBytes + intent.bytes : before.reservedBytes
  return (
    Number.isSafeInteger(revision) &&
    Number.isSafeInteger(bytes) &&
    receipt.revision === revision &&
    after.reservationRevision === revision &&
    after.sourceRevision === receipt.sourceRevisionAfter &&
    after.reservedBytes === bytes &&
    (receipt.changed || receipt.sourceRevisionAfter === before.sourceRevision)
  )
}

export function validateReservationIntent(intent: ReservationIntent): void {
  const invalid =
    !intent ||
    typeof intent.reservationId !== 'string' ||
    !intent.reservationId.trim() ||
    !Number.isSafeInteger(intent.bytes) ||
    intent.bytes < 0 ||
    !Number.isSafeInteger(intent.expectedRevision) ||
    intent.expectedRevision < 0
  if (invalid) {
    throw new Error('Reservation intent is invalid.')
  }
}

export function reservationFitsKnownTotals(
  intent: ReservationIntent,
  before: ParticipantObservation,
  cohortTotal: number | null
): boolean {
  return (
    cohortTotal !== null &&
    Number.isSafeInteger(cohortTotal) &&
    cohortTotal >= 0 &&
    intent.bytes <= Number.MAX_SAFE_INTEGER - before.reservedBytes &&
    intent.bytes <= Number.MAX_SAFE_INTEGER - cohortTotal
  )
}
