import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  LayaAdvisoryIdentity,
  LayaAdvisoryResult,
  LayaAuthoritySnapshot,
  LayaDeploymentGate,
  LayaProviderRequest
} from '../../shared/laya-advisory'
import { LayaAuthoritySnapshot as AuthoritySnapshotSchema } from '../../shared/laya-advisory'
import { LayaAdvisoryJournal } from './laya-advisory-journal'
import { LayaAdvisoryRequestBudget } from './laya-advisory-request-budget'
import { LayaAdvisoryService, type LayaDecisionProvider } from './laya-advisory-service'

import {
  authorityEpochMatches,
  captureAuthorityEpoch,
  createRevisionDigestKey,
  opaqueSourceRevision
} from './laya-authority-epoch'

const tempDirectories: string[] = []
const sourceRevision = '1'.repeat(40)
const checkpointRevision = '2'.repeat(40)
const evaluationDigest = '3'.repeat(64)

function snapshot(overrides: Record<string, unknown> = {}): LayaAuthoritySnapshot {
  const surface = (overrides.surface ?? 'job-routing') as LayaAdvisoryIdentity['surface']
  const factsBySurface: Record<LayaAdvisoryIdentity['surface'], Record<string, unknown>> = {
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
  return AuthoritySnapshotSchema.parse({
    schemaVersion: 1,
    surface,
    subjectIds: ['job-1'],
    sourceRevision: 'job-1:v1',
    capturedAt: 1_000,
    expiresAt: 5_000,
    evidenceRefs: ['4'.repeat(64)],
    ...overrides,
    facts: {
      ...factsBySurface[surface],
      ...(overrides.facts as Record<string, unknown> | undefined)
    },
    eligibleChoices:
      overrides.eligibleChoices ??
      (surface === 'job-routing' || surface === 'storage' ? ['option-one'] : [])
  })
}

function gate(overrides: Partial<LayaDeploymentGate> = {}): LayaDeploymentGate {
  const surfaces = ['job-routing', 'kanban', 'agents', 'data', 'storage', 'verification'] as const
  return {
    status: 'accepted',
    deploymentId: 'deployment-1',
    issuedAt: 1_000,
    expiresAt: 10_000,
    sourceRevision,
    checkpointRevision,
    evaluationReportSha256: evaluationDigest,
    schemaVersion: 1,
    policyVersion: '1',
    heldoutKind: 'independent-human-labeled',
    samplesPerSurface: Object.fromEntries(surfaces.map((surface) => [surface, 20])) as Record<
      (typeof surfaces)[number],
      number
    >,
    confidenceThresholds: Object.fromEntries(surfaces.map((surface) => [surface, 0.8])) as Record<
      (typeof surfaces)[number],
      number
    >,
    thresholdsPassed: true,
    policyViolationCount: 0,
    calibrationReviewed: true,
    fallbackTested: true,
    providerAuthenticated: true,
    twoClientReadback: true,
    privacyReviewed: true,
    ...overrides
  }
}

function providerResult(request: LayaProviderRequest, decision = 'option-one') {
  const probabilities = Object.fromEntries(
    request.choices.map((choice) => [
      choice,
      choice === decision ? 0.9 : 0.1 / Math.max(1, request.choices.length - 1)
    ])
  )
  return {
    schemaVersion: 1,
    surface: request.surface,
    requestDigest: request.requestDigest,
    snapshotRevision: request.snapshotRevision,
    sourceRevision: request.modelSourceRevision,
    checkpointRevision: request.checkpointRevision,
    evaluationReportSha256: request.evaluationReportSha256,
    policyVersion: request.policyVersion,
    decision,
    confidence: 0.9,
    probabilities,
    elapsedMs: 4,
    providerMeasuredAt: 1_500
  }
}

function makeService(
  options: {
    currentSnapshot?: (
      identity: LayaAdvisoryIdentity,
      readCount: number
    ) => LayaAuthoritySnapshot | Promise<LayaAuthoritySnapshot>
    currentGate?: () => unknown
    currentEpoch?: () => unknown
    authorityEpoch?: { current(): unknown } | null
    provider?: LayaDecisionProvider
    maxConcurrent?: number
    maxRequestsPerMinute?: number
    deadlineMs?: number
    cacheTtlMs?: number
    cacheEntries?: number
    afterJournalAppend?: (result: LayaAdvisoryResult) => void
  } = {}
) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'dobius-laya-service-'))
  tempDirectories.push(directory)
  let readCount = 0
  let epoch = 1
  const authority = {
    read: vi.fn(async (identity: LayaAdvisoryIdentity) => {
      readCount += 1
      return (
        options.currentSnapshot?.(identity, readCount) ??
        snapshot({
          surface: identity.surface,
          subjectIds: identity.subjectIds,
          eligibleChoices:
            identity.surface === 'job-routing' || identity.surface === 'storage'
              ? ['option-one']
              : []
        })
      )
    })
  }
  const deploymentGate = { current: vi.fn(async () => options.currentGate?.() ?? gate()) }
  const authorityEpoch = {
    current: vi.fn(() => (options.currentEpoch ? options.currentEpoch() : epoch))
  }
  const journal = new LayaAdvisoryJournal(join(directory, 'journal.jsonl'))
  const journaledResults: LayaAdvisoryResult[] = []
  const append = journal.appendAdvisoryResult.bind(journal)
  journal.appendAdvisoryResult = (currentSnapshot, result, metadata, createdAt) => {
    const record = append(currentSnapshot, result, metadata, createdAt)
    journaledResults.push(result)
    options.afterJournalAppend?.(result)
    return record
  }
  const service = new LayaAdvisoryService({
    authority,
    deploymentGate,
    authorityEpoch:
      options.authorityEpoch === null ? undefined : (options.authorityEpoch ?? authorityEpoch),
    journal,
    provider: options.provider,
    now: () => 1_500,
    maxConcurrent: options.maxConcurrent,
    maxRequestsPerMinute: options.maxRequestsPerMinute,
    deadlineMs: options.deadlineMs,
    cacheTtlMs: options.cacheTtlMs,
    cacheEntries: options.cacheEntries
  })
  return {
    service,
    authority,
    authorityEpoch,
    deploymentGate,
    journal,
    journaledResults,
    setEpoch: (next: number) => (epoch = next)
  }
}

function provider(decide: LayaDecisionProvider['decide'], available = true): LayaDecisionProvider {
  return { availability: async () => (available ? 'available' : 'unsupported'), decide }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Laya coherent authority epoch', () => {
  it('requires a synchronous nonnegative safe-integer ticket', () => {
    expect(captureAuthorityEpoch({ current: () => 4 })).toBe(4)
    for (const current of [
      undefined,
      null,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER
    ]) {
      expect(captureAuthorityEpoch({ current: () => current })).toBeNull()
    }
    expect(captureAuthorityEpoch(undefined)).toBeNull()
    expect(captureAuthorityEpoch({ current: () => Promise.resolve(4) })).toBeNull()
  })

  it('fails closed when reading or validating the ticket throws or changes', () => {
    let epoch: unknown = 7
    const reader = { current: vi.fn(() => epoch) }
    const ticket = captureAuthorityEpoch(reader)
    expect(ticket).toBe(7)
    expect(authorityEpochMatches(reader, ticket!)).toBe(true)
    epoch = 8
    expect(authorityEpochMatches(reader, ticket!)).toBe(false)
    expect(
      authorityEpochMatches(
        {
          current: () => {
            throw new Error('offline')
          }
        },
        ticket!
      )
    ).toBe(false)
  })

  it('creates a domain-separated keyed digest instead of exposing raw revisions', () => {
    const key = createRevisionDigestKey()
    const digest = opaqueSourceRevision(key, 'job-1:v1')
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).not.toContain('job-1:v1')
    expect(opaqueSourceRevision(key, 'job-1:v1')).toBe(digest)
    expect(opaqueSourceRevision(createRevisionDigestKey(), 'job-1:v1')).not.toBe(digest)
    expect(opaqueSourceRevision(key, 'other:v1')).not.toBe(digest)
  })
})

describe('coherent epoch decision commits', () => {
  it('rejects a cache hit if authority changes during the final gate await', async () => {
    let epoch = 1
    let revision = 'job-1:v1'
    let gateCalls = 0
    let releaseGate: (() => void) | undefined
    const delayedGate = new Promise<unknown>((resolve) => {
      releaseGate = () => resolve(gate())
    })
    const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
    const { service, journal, journaledResults } = makeService({
      currentEpoch: () => epoch,
      currentSnapshot: (identity) =>
        snapshot({
          surface: identity.surface,
          subjectIds: identity.subjectIds,
          sourceRevision: revision,
          eligibleChoices: ['option-one']
        }),
      currentGate: () => (++gateCalls === 4 ? delayedGate : gate()),
      provider: provider(decide)
    })
    const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
    expect((await service.advise(identity)).status).toBe('suggestion')
    const pending = service.advise(identity)
    await vi.waitFor(() => expect(gateCalls).toBe(4))
    revision = 'job-1:v2'
    epoch += 1
    releaseGate?.()
    expect(await pending).toMatchObject({
      status: 'unavailable',
      reason: 'authority-epoch-changed'
    })
    expect(decide).toHaveBeenCalledTimes(1)
    expect(journal.verify().records).toBe(2)
    expect(journaledResults.filter((result) => result.status === 'suggestion')).toHaveLength(1)
  })

  it('rejects a coalesced suggestion if authority changes during final gate validation', async () => {
    let epoch = 1
    let gateCalls = 0
    const coalescedWait = vi.spyOn(LayaAdvisoryRequestBudget.prototype, 'wait')
    let releaseProvider: (() => void) | undefined
    let releaseGate: (() => void) | undefined
    const delayedGate = new Promise<unknown>((resolve) => {
      releaseGate = () => resolve(gate())
    })
    const decide = vi.fn(
      (request: LayaProviderRequest) =>
        new Promise((resolve) => {
          releaseProvider = () => resolve(providerResult(request))
        })
    )
    const { service, journal, journaledResults } = makeService({
      currentEpoch: () => epoch,
      currentGate: () => (++gateCalls === 4 ? delayedGate : gate()),
      provider: provider(decide)
    })
    const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
    const first = service.advise(identity)
    await vi.waitFor(() => expect(releaseProvider).toBeDefined())
    const second = service.advise(identity)
    await vi.waitFor(() => expect(coalescedWait).toHaveBeenCalledTimes(1))
    releaseProvider?.()
    expect((await first).status).toBe('suggestion')
    await vi.waitFor(() => expect(gateCalls).toBe(4))
    epoch += 1
    releaseGate?.()
    expect(await second).toMatchObject({ status: 'unavailable', reason: 'authority-epoch-changed' })
    expect(journal.verify().records).toBe(2)
    expect(decide).toHaveBeenCalledTimes(1)
    expect(journaledResults.filter((result) => result.status === 'suggestion')).toHaveLength(1)
  })

  it('does not persist, cache, or return a suggestion after gate revocation during final authority read', async () => {
    let epoch = 1
    let authorityReads = 0
    let currentGate = gate()
    let releaseFinalAuthority: (() => void) | undefined
    const finalAuthority = new Promise<LayaAuthoritySnapshot>((resolve) => {
      releaseFinalAuthority = () => resolve(snapshot())
    })
    const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
    const { service, journaledResults } = makeService({
      currentEpoch: () => epoch,
      currentSnapshot: (identity) => {
        authorityReads += 1
        if (authorityReads === 2) {
          return finalAuthority
        }
        return snapshot({ surface: identity.surface, subjectIds: identity.subjectIds })
      },
      currentGate: () => currentGate,
      provider: provider(decide)
    })
    const pending = service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    await vi.waitFor(() => expect(authorityReads).toBe(2))
    expect(releaseFinalAuthority).toBeDefined()
    currentGate = gate({ status: 'accepted', deploymentId: 'revoked-deployment' })
    epoch += 1
    releaseFinalAuthority?.()
    expect(await pending).toMatchObject({
      status: 'unavailable',
      reason: 'authority-epoch-changed'
    })
    expect(journaledResults.map((result) => result.status)).toEqual(['unavailable'])
    expect(decide).toHaveBeenCalledTimes(1)
  })
})
