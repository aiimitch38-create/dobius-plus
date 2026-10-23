import type { LayaAdvisorySurface } from '../../shared/laya-advisory'
import type { LayaAuthorityEpochReader } from './laya-authority-epoch'

export const LAYA_AUTHORITY_PARTICIPANT_SURFACES = {
  'cloud-jobs': ['job-routing'],
  'vertex-kanban': ['kanban'],
  'agent-configuration': ['agents'],
  'agent-runtime': ['agents'],
  'data-catalog': ['data'],
  'storage-monitor': ['storage'],
  'capacity-reservations': ['job-routing', 'storage'],
  'verification-evidence': ['verification'],
  'policy-permissions': ['job-routing', 'kanban', 'agents', 'data', 'storage', 'verification']
} as const satisfies Record<string, readonly LayaAdvisorySurface[]>

export type LayaAuthorityParticipantId = keyof typeof LAYA_AUTHORITY_PARTICIPANT_SURFACES
export type LayaAuthoritySourceRevision = {
  participantId: LayaAuthorityParticipantId
  version: number
  stateDigest: string
  fresh: true
}
export type LayaAuthorityEpochParticipant = {
  participantId: LayaAuthorityParticipantId
  surfaces: readonly LayaAdvisorySurface[]
  /** Return null for a missing, incomplete, stale, or internally inconsistent authority view. */
  readRevision(): unknown
}
export type LayaAuthorityEpochMutation = {
  complete(): void
  fail(): void
}
export type LayaAuthorityEpochCoordinatorOptions = {
  /** A lower cap is useful for bounded exhaustion fixtures; production defaults to safe integers. */
  maxGeneration?: number
}

const participantIds = Object.keys(
  LAYA_AUTHORITY_PARTICIPANT_SURFACES
) as LayaAuthorityParticipantId[]
const maximumSafeGeneration = Number.MAX_SAFE_INTEGER - 1

function validRevision(
  participantId: LayaAuthorityParticipantId,
  value: unknown
): value is LayaAuthoritySourceRevision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const revision = value as Record<string, unknown>
  return (
    Object.keys(revision).length === 4 &&
    revision.participantId === participantId &&
    Number.isSafeInteger(revision.version) &&
    Number(revision.version) >= 0 &&
    Number(revision.version) < Number.MAX_SAFE_INTEGER &&
    typeof revision.stateDigest === 'string' &&
    /^[a-f0-9]{64}$/.test(revision.stateDigest) &&
    revision.fresh === true
  )
}

function sameRevision(left: LayaAuthoritySourceRevision, right: LayaAuthoritySourceRevision) {
  return (
    left.participantId === right.participantId &&
    left.version === right.version &&
    left.stateDigest === right.stateDigest
  )
}

function hasExactSurfaceCoverage(participant: LayaAuthorityEpochParticipant): boolean {
  const expected = LAYA_AUTHORITY_PARTICIPANT_SURFACES[participant.participantId]
  return (
    participant.surfaces.length === expected.length &&
    expected.every((surface) => participant.surfaces.includes(surface))
  )
}

/**
 * Coordinates synchronous source revisions; it does not certify that real production writers
 * are registered. Keep it unwired until each participant is backed by its actual authority.
 */
export class LayaAuthorityEpochCoordinator implements LayaAuthorityEpochReader {
  private readonly participants = new Map<
    LayaAuthorityParticipantId,
    LayaAuthorityEpochParticipant
  >()
  private readonly maxGeneration: number
  private readonly activeMutations = new Set<symbol>()
  private lastRevisions: Map<LayaAuthorityParticipantId, LayaAuthoritySourceRevision> | null = null
  private generation = 0
  private sampling = false
  private reentrantSample = false
  private unavailable = false
  private readonly completeRoster: boolean

  constructor(
    participants: readonly LayaAuthorityEpochParticipant[],
    options: LayaAuthorityEpochCoordinatorOptions = {}
  ) {
    this.maxGeneration = options.maxGeneration ?? maximumSafeGeneration
    if (
      !Number.isSafeInteger(this.maxGeneration) ||
      this.maxGeneration < 1 ||
      this.maxGeneration > maximumSafeGeneration
    ) {
      this.unavailable = true
    }
    for (const participant of participants) {
      if (
        !participantIds.includes(participant.participantId) ||
        this.participants.has(participant.participantId) ||
        !hasExactSurfaceCoverage(participant) ||
        typeof participant.readRevision !== 'function'
      ) {
        this.unavailable = true
        continue
      }
      this.participants.set(participant.participantId, participant)
    }
    this.completeRoster =
      participants.length === participantIds.length &&
      participantIds.every((participantId) => this.participants.has(participantId))
    if (!this.completeRoster) {
      this.unavailable = true
    }
  }

  current(): unknown {
    if (this.sampling) {
      this.reentrantSample = true
      return null
    }
    if (this.unavailable || this.activeMutations.size > 0 || !this.completeRoster) {
      return null
    }

    const generationAtStart = this.generation
    this.sampling = true
    this.reentrantSample = false
    let revisions: Map<LayaAuthorityParticipantId, LayaAuthoritySourceRevision>
    try {
      revisions = this.readAllRevisions()
    } catch {
      this.advanceOrFail()
      this.lastRevisions = null
      return null
    } finally {
      this.sampling = false
    }

    if (
      this.reentrantSample ||
      this.unavailable ||
      this.activeMutations.size > 0 ||
      this.generation !== generationAtStart
    ) {
      this.advanceOrFail()
      this.lastRevisions = revisions
      return null
    }

    if (this.lastRevisions && !this.sameRevisionSet(this.lastRevisions, revisions)) {
      this.advanceOrFail()
      this.lastRevisions = revisions
      return null
    }
    this.lastRevisions = revisions
    return this.generation
  }

  beginMutation(participantId: LayaAuthorityParticipantId): LayaAuthorityEpochMutation {
    if (this.unavailable || !this.completeRoster || !this.participants.has(participantId)) {
      this.unavailable = true
      throw new Error('Laya authority epoch participant is unavailable.')
    }
    this.advanceOrFail()
    const token = Symbol(participantId)
    this.activeMutations.add(token)
    let settled = false
    return {
      complete: () => this.finishMutation(token, settled, () => (settled = true), false),
      fail: () => this.finishMutation(token, settled, () => (settled = true), true)
    }
  }

  private finishMutation(
    token: symbol,
    settled: boolean,
    markSettled: () => void,
    failed: boolean
  ): void {
    if (settled || !this.activeMutations.delete(token)) {
      this.unavailable = true
      return
    }
    markSettled()
    if (failed) {
      this.unavailable = true
    }
    this.advanceOrFail()
  }

  private readAllRevisions(): Map<LayaAuthorityParticipantId, LayaAuthoritySourceRevision> {
    const revisions = new Map<LayaAuthorityParticipantId, LayaAuthoritySourceRevision>()
    for (const participantId of participantIds) {
      const participant = this.participants.get(participantId)
      if (!participant) {
        throw new Error('Required Laya authority participant is missing.')
      }
      const raw = participant.readRevision()
      if (!validRevision(participantId, raw)) {
        throw new Error('Laya authority participant revision is unavailable or malformed.')
      }
      revisions.set(participantId, {
        participantId,
        version: raw.version,
        stateDigest: raw.stateDigest,
        fresh: true
      })
    }
    return revisions
  }

  private sameRevisionSet(
    left: Map<LayaAuthorityParticipantId, LayaAuthoritySourceRevision>,
    right: Map<LayaAuthorityParticipantId, LayaAuthoritySourceRevision>
  ): boolean {
    return participantIds.every((participantId) => {
      const oldRevision = left.get(participantId)
      const newRevision = right.get(participantId)
      return !!oldRevision && !!newRevision && sameRevision(oldRevision, newRevision)
    })
  }

  private advanceOrFail(): void {
    if (this.generation >= this.maxGeneration) {
      this.unavailable = true
      return
    }
    this.generation += 1
  }
}
