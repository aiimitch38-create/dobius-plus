import type {
  CapacityParticipantScope,
  ManagedProducerId,
  ParticipantObservation
} from './cloud-worker-capacity-participants'

const LIFECYCLES = ['active', 'starting', 'recovering', 'draining', 'stopped', 'unknown'] as const

export function readValidSampleTime(readNow: () => number): number | null {
  try {
    const value = readNow()
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

export function snapshotParticipantObservation(
  value: unknown,
  scope: CapacityParticipantScope,
  authorityGeneration: string,
  now: number
): ParticipantObservation | null {
  if (!isRecord(value)) {
    return null
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return null
  }
  const fields = Object.getOwnPropertyDescriptors(value)
  const keys = [
    'deviceId',
    'filesystemId',
    'authorityGeneration',
    'sourceRevision',
    'reservationRevision',
    'sampledAt',
    'lifecycle',
    'reservedBytes'
  ]
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !fields[key] || !('value' in fields[key]))
  ) {
    return null
  }
  const deviceId: unknown = fields.deviceId?.value
  const filesystemId: unknown = fields.filesystemId?.value
  const observedAuthorityGeneration: unknown = fields.authorityGeneration?.value
  const sourceRevision: unknown = fields.sourceRevision?.value
  const reservationRevision: unknown = fields.reservationRevision?.value
  const sampledAt: unknown = fields.sampledAt?.value
  const rawLifecycle: unknown = fields.lifecycle?.value
  const reservedBytes: unknown = fields.reservedBytes?.value
  const lifecycle = LIFECYCLES.find((candidate) => candidate === rawLifecycle)
  if (
    typeof deviceId !== 'string' ||
    deviceId !== scope.deviceId ||
    typeof filesystemId !== 'string' ||
    filesystemId !== scope.filesystemId ||
    typeof observedAuthorityGeneration !== 'string' ||
    observedAuthorityGeneration !== authorityGeneration ||
    typeof sourceRevision !== 'string' ||
    !sourceRevision ||
    typeof reservationRevision !== 'number' ||
    !Number.isSafeInteger(reservationRevision) ||
    reservationRevision < 0 ||
    typeof sampledAt !== 'number' ||
    !Number.isSafeInteger(sampledAt) ||
    sampledAt > now ||
    now - sampledAt > 5_000 ||
    !lifecycle ||
    typeof reservedBytes !== 'number' ||
    !Number.isSafeInteger(reservedBytes) ||
    reservedBytes < 0
  ) {
    return null
  }
  const observation: ParticipantObservation = {
    deviceId,
    filesystemId,
    authorityGeneration: observedAuthorityGeneration,
    sourceRevision,
    reservationRevision,
    sampledAt,
    lifecycle,
    reservedBytes
  }
  return Object.freeze(observation)
}

export function snapshotParticipantCohort(
  observations: ReadonlyMap<string, ParticipantObservation>
): ReadonlyMap<string, ParticipantObservation> {
  return new Map(
    [...observations].map(([id, observation]) => [id, Object.freeze({ ...observation })])
  )
}

export function nonTargetCohortUnchanged(
  before: ReadonlyMap<string, ParticipantObservation>,
  after: ReadonlyMap<string, ParticipantObservation>,
  target: ManagedProducerId,
  participants: readonly { id: ManagedProducerId }[]
): boolean {
  const ids = participants.map(({ id }) => id)
  if (before.size !== ids.length || after.size !== ids.length) {
    return false
  }
  return ids.every((id) => {
    if (id === target) {
      return true
    }
    const initial = before.get(id)
    const current = after.get(id)
    return Boolean(
      initial &&
      current &&
      initial.deviceId === current.deviceId &&
      initial.filesystemId === current.filesystemId &&
      initial.authorityGeneration === current.authorityGeneration &&
      initial.sourceRevision === current.sourceRevision &&
      initial.reservationRevision === current.reservationRevision &&
      initial.lifecycle === current.lifecycle &&
      initial.reservedBytes === current.reservedBytes
    )
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
