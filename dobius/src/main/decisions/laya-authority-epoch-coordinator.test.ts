import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LayaAdvisoryIdentity as IdentitySchema,
  LayaAuthoritySnapshot as SnapshotSchema,
  type LayaAdvisoryIdentity,
  type LayaAuthoritySnapshot,
  type LayaDeploymentGate,
  type LayaProviderRequest
} from '../../shared/laya-advisory'
import { LayaAdvisoryJournal } from './laya-advisory-journal'
import { LayaAdvisoryService } from './laya-advisory-service'
import {
  LAYA_AUTHORITY_PARTICIPANT_SURFACES,
  LayaAuthorityEpochCoordinator,
  type LayaAuthorityEpochParticipant,
  type LayaAuthorityParticipantId,
  type LayaAuthoritySourceRevision
} from './laya-authority-epoch-coordinator'
import { gate } from './laya-http-provider.fixtures'

const directories: string[] = []
const sourceIds = Object.keys(LAYA_AUTHORITY_PARTICIPANT_SURFACES) as LayaAuthorityParticipantId[]

function participants() {
  const versions = Object.fromEntries(sourceIds.map((id) => [id, 1])) as Record<
    LayaAuthorityParticipantId,
    number
  >
  const readers = Object.fromEntries(
    sourceIds.map((participantId) => [
      participantId,
      () => revision(participantId, versions[participantId])
    ])
  ) as Record<LayaAuthorityParticipantId, () => unknown>
  const roster = sourceIds.map((participantId) => ({
    participantId,
    surfaces: LAYA_AUTHORITY_PARTICIPANT_SURFACES[participantId],
    readRevision: readers[participantId]
  })) as LayaAuthorityEpochParticipant[]
  return { roster, versions, readers }
}

function revision(
  participantId: LayaAuthorityParticipantId,
  version: number
): LayaAuthoritySourceRevision {
  return {
    participantId,
    version,
    stateDigest: version.toString(16).padStart(64, '0'),
    fresh: true
  }
}

function snapshot(identity: LayaAdvisoryIdentity): LayaAuthoritySnapshot {
  const facts: Record<LayaAdvisoryIdentity['surface'], Record<string, unknown>> = {
    'job-routing': {
      nativeAppleRequired: false,
      targetSupportsNativeApple: true,
      dependenciesReady: true
    },
    kanban: { hardFailure: false, verifiedCompleted: false },
    agents: {
      permissionPrompt: false,
      hardFailure: false,
      processIdentityKnown: true,
      heartbeatFresh: true,
      testsFailed: null
    },
    data: {
      dirty: false,
      pinned: false,
      activeLease: false,
      ownerKnown: true,
      remoteVerified: true,
      inactive: true
    },
    storage: { monitorFresh: true, rootIdentityKnown: true, freeBytesKnown: true },
    verification: {
      hardFailure: false,
      evidenceIncomplete: false,
      testsFailed: null,
      httpFailure: false,
      consoleErrors: null
    }
  }
  return SnapshotSchema.parse({
    schemaVersion: 1,
    ...identity,
    sourceRevision: 'fixture:v1',
    capturedAt: 1_000,
    expiresAt: 5_000,
    evidenceRefs: ['4'.repeat(64)],
    facts: facts[identity.surface],
    eligibleChoices:
      identity.surface === 'job-routing' || identity.surface === 'storage' ? ['option-one'] : []
  })
}

function providerDecision(request: LayaProviderRequest) {
  const probabilities = Object.fromEntries(
    request.choices.map((choice) => [choice, choice === 'option-one' ? 0.9 : 0.1])
  )
  return {
    schemaVersion: 1,
    surface: request.surface,
    requestDigest: request.requestDigest,
    snapshotRevision: request.snapshotRevision,
    sourceRevision: '3cf26cbcb18725dbc2d127bb8bb2c4c43243ae63',
    checkpointRevision: '7b928d828b7b0e022f929d9bd2e44165aa270148',
    evaluationReportSha256: '3'.repeat(64),
    policyVersion: '1',
    decision: 'option-one',
    confidence: 0.9,
    probabilities,
    elapsedMs: 1,
    providerMeasuredAt: 1_500
  }
}

function serviceFixture(
  epoch: LayaAuthorityEpochCoordinator,
  decision: (request: LayaProviderRequest) => Promise<unknown>
) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'dobius-laya-coordinator-'))
  directories.push(directory)
  const journal = new LayaAdvisoryJournal(join(directory, 'journal.jsonl'))
  const identity = IdentitySchema.parse({ surface: 'job-routing', subjectIds: ['job-1'] })
  const acceptedGate: LayaDeploymentGate = gate()
  const service = new LayaAdvisoryService({
    authority: { read: async (requested) => snapshot(requested) },
    deploymentGate: { current: async () => acceptedGate },
    authorityEpoch: epoch,
    journal,
    provider: {
      availability: async () => 'available',
      decide: async (request) => decision(request)
    },
    now: () => 1_500
  })
  return { identity, journal, service }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

describe('Laya authority epoch coordinator', () => {
  it('refuses absent, duplicate, misdeclared, scalar, and timestamp-only participants', () => {
    const { roster } = participants()
    expect(new LayaAuthorityEpochCoordinator(roster.slice(1)).current()).toBeNull()
    expect(new LayaAuthorityEpochCoordinator([...roster, roster[0]!]).current()).toBeNull()
    expect(
      new LayaAuthorityEpochCoordinator([
        { ...roster[0]!, surfaces: ['storage'] },
        ...roster.slice(1)
      ]).current()
    ).toBeNull()

    const scalarRoster = roster.map((participant) => ({
      ...participant,
      readRevision: () => Date.now()
    }))
    expect(new LayaAuthorityEpochCoordinator(scalarRoster).current()).toBeNull()
    const staleRoster = roster.map((participant) => ({
      ...participant,
      readRevision: () => ({ ...revision(participant.participantId, 1), fresh: false })
    }))
    expect(new LayaAuthorityEpochCoordinator(staleRoster).current()).toBeNull()
  })

  it('keeps nested and concurrent mutations unavailable until every writer settles', () => {
    const { roster } = participants()
    const epoch = new LayaAuthorityEpochCoordinator(roster)
    const initial = epoch.current()
    const outer = epoch.beginMutation('cloud-jobs')
    const inner = epoch.beginMutation('capacity-reservations')
    expect(epoch.current()).toBeNull()
    outer.complete()
    expect(epoch.current()).toBeNull()
    inner.complete()
    expect(epoch.current()).toBeGreaterThan(initial as number)
    expect(epoch.current()).toBeGreaterThan(initial as number)
  })

  it('detects source revision changes even when a writer notification was missed', () => {
    const { roster, versions } = participants()
    const epoch = new LayaAuthorityEpochCoordinator(roster)
    const oldTicket = epoch.current() as number
    versions['cloud-jobs'] += 1
    expect(epoch.current()).toBeNull()
    expect(epoch.current()).toBeGreaterThan(oldTicket)
  })

  it('invalidates old advisory tickets while a declared writer is in progress and after settle', async () => {
    const { roster, versions } = participants()
    const epoch = new LayaAuthorityEpochCoordinator(roster)
    let releaseDecision!: (value: unknown) => void
    let started!: (request: LayaProviderRequest) => void
    const decisionStarted = new Promise<LayaProviderRequest>((resolve) => (started = resolve))
    const pendingDecision = new Promise<unknown>((resolve) => (releaseDecision = resolve))
    const fixture = serviceFixture(epoch, (request) => {
      started(request)
      return pendingDecision
    })
    const resultPromise = fixture.service.advise(fixture.identity)
    const providerRequest = await decisionStarted
    const mutation = epoch.beginMutation('cloud-jobs')
    versions['cloud-jobs'] += 1
    expect(epoch.current()).toBeNull()
    mutation.complete()
    releaseDecision(providerDecision(providerRequest))
    const result = await resultPromise
    expect(result.status).toBe('unavailable')
    expect(result.status === 'unavailable' && result.reason).toBe('authority-epoch-changed')
    expect(readFileSync(join(directories.at(-1)!, 'journal.jsonl'), 'utf8')).not.toContain(
      '"status":"suggestion"'
    )
  })

  it('fails closed on a reader throw or reentrant sample and never accepts the old ticket', () => {
    const { roster } = participants()
    const oldReader = roster.find((participant) => participant.participantId === 'agent-runtime')!
    let readThrows = false
    const throwing = new LayaAuthorityEpochCoordinator(
      roster.map((participant) =>
        participant.participantId === 'agent-runtime'
          ? {
              ...participant,
              readRevision: () => {
                if (readThrows) {
                  throw new Error('source unavailable')
                }
                return oldReader.readRevision()
              }
            }
          : participant
      )
    )
    const oldTicket = throwing.current() as number
    readThrows = true
    expect(throwing.current()).toBeNull()
    readThrows = false
    expect(throwing.current()).not.toBe(oldTicket)

    let reentrant: LayaAuthorityEpochCoordinator
    let triggerReentrant = true
    const reentrantRoster = roster.map((participant) => ({
      ...participant,
      readRevision: () => {
        if (participant.participantId === 'cloud-jobs' && triggerReentrant) {
          triggerReentrant = false
          expect(reentrant.current()).toBeNull()
        }
        return participant.readRevision()
      }
    }))
    reentrant = new LayaAuthorityEpochCoordinator(reentrantRoster)
    expect(reentrant.current()).toBeNull()
    expect(reentrant.current()).not.toBeNull()
  })

  it('makes ambiguous mutation failure and generation exhaustion permanently unavailable', () => {
    const failed = new LayaAuthorityEpochCoordinator(participants().roster)
    failed.current()
    failed.beginMutation('vertex-kanban').fail()
    expect(failed.current()).toBeNull()

    const exhausted = new LayaAuthorityEpochCoordinator(participants().roster, {
      maxGeneration: 2
    })
    expect(exhausted.current()).toBe(0)
    exhausted.beginMutation('cloud-jobs').complete()
    expect(exhausted.current()).toBe(2)
    exhausted.beginMutation('cloud-jobs')
    expect(exhausted.current()).toBeNull()
  })
})
