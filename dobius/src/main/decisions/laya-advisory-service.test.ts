import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('Laya advisory service', () => {
  it('defaults to unavailable and never fabricates a suggestion', async () => {
    const { service, journal } = makeService()
    const result = await service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'provider-not-deployed' })
    expect(journal.verify().records).toBe(1)
  })

  it.each([
    ['missing', null],
    ['malformed', { current: () => Number.NaN }]
  ])(
    'does not read authority or infer with a %s coherent epoch',
    async (_label, authorityEpoch) => {
      const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
      const { service, authority } = makeService({
        authorityEpoch,
        provider: provider(decide)
      })
      expect(await service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })).toMatchObject(
        {
          status: 'unavailable',
          reason: 'authority-epoch-unavailable'
        }
      )
      expect(authority.read).not.toHaveBeenCalled()
      expect(decide).not.toHaveBeenCalled()
    }
  )

  it('sends a keyed opaque revision and no raw subject ID to the provider', async () => {
    let serialized = ''
    const decide = vi.fn(async (request: LayaProviderRequest) => {
      serialized = JSON.stringify(request)
      return providerResult(request)
    })
    const { service } = makeService({ provider: provider(decide) })
    const result = await service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    expect(result.status).toBe('suggestion')
    expect(serialized).not.toContain('job-1:v1')
    expect(serialized).not.toContain('"job-1"')
    expect(serialized).toMatch(/"snapshotRevision":"[a-f0-9]{64}"/)
  })

  it('records an authority failure without including caller IDs or facts', async () => {
    const { service, journal } = makeService({
      currentSnapshot: () => {
        throw new Error('source unavailable')
      }
    })
    const result = await service.advise({ surface: 'agents', subjectIds: ['private-session-id'] })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'authority-unavailable' })
    expect(journal.verify().records).toBe(1)
  })

  it('returns surface-specific unavailable for an unsupported classifier head without inference', async () => {
    const decide = vi.fn()
    const { service } = makeService({ provider: provider(decide, false) })
    const result = await service.advise({ surface: 'verification', subjectIds: ['job-1'] })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'provider-unsupported-surface' })
    expect(decide).not.toHaveBeenCalled()
  })

  it('requires a current evaluated deployment gate before a provider call', async () => {
    const decide = vi.fn()
    const { service } = makeService({
      provider: provider(decide),
      currentGate: () => ({ status: 'missing' })
    })
    const result = await service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'deployment-gate-missing' })
    expect(decide).not.toHaveBeenCalled()
  })

  it('rejects an expired deployment gate before inference', async () => {
    const decide = vi.fn()
    const { service } = makeService({
      provider: provider(decide),
      currentGate: () => gate({ expiresAt: 1_400 })
    })
    expect(await service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })).toMatchObject({
      status: 'unavailable',
      reason: 'deployment-gate-expired'
    })
    expect(decide).not.toHaveBeenCalled()
  })

  it('refuses a deployment provenance change while inference is in flight', async () => {
    let reads = 0
    const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
    const { service } = makeService({
      provider: provider(decide),
      currentGate: () => (++reads === 1 ? gate() : gate({ checkpointRevision: '5'.repeat(40) }))
    })
    const result = await service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'deployment-gate-mismatch' })
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('coalesces duplicate requests and caches only the exact current input', async () => {
    const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
    const { service, journal, authority } = makeService({ provider: provider(decide) })
    const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
    const [first, cached] = await Promise.all([service.advise(identity), service.advise(identity)])
    const nextCached = await service.advise(identity)
    expect(first.status).toBe('suggestion')
    expect(cached).toEqual(first)
    expect(nextCached).toEqual(first)
    expect(decide).toHaveBeenCalledTimes(1)
    expect(authority.read).toHaveBeenCalledTimes(6)
    expect(journal.verify().records).toBe(1)
  })

  it('does not reuse a cached suggestion after the authoritative source revision changes', async () => {
    let revision = 'job-1:v1'
    const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
    const { service, journal } = makeService({
      currentSnapshot: (identity) =>
        snapshot({
          surface: identity.surface,
          subjectIds: identity.subjectIds,
          sourceRevision: revision,
          eligibleChoices: ['option-one']
        }),
      provider: provider(decide)
    })
    const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
    expect((await service.advise(identity)).status).toBe('suggestion')
    revision = 'job-1:v2'
    expect((await service.advise(identity)).status).toBe('suggestion')
    expect(decide).toHaveBeenCalledTimes(2)
    expect(journal.verify().records).toBe(2)
  })

  it('does not reuse a cache entry after the coherent epoch advances', async () => {
    let epoch = 1
    const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
    const { service } = makeService({ currentEpoch: () => epoch, provider: provider(decide) })
    const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
    expect((await service.advise(identity)).status).toBe('suggestion')
    epoch += 1
    expect((await service.advise(identity)).status).toBe('suggestion')
    expect(decide).toHaveBeenCalledTimes(2)
  })

  it('rechecks authority when it changes during provider availability before a cache hit', async () => {
    let revision = 'job-1:v1'
    let availabilityCalls = 0
    let releaseAvailability: (() => void) | undefined
    const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
    const configuredProvider: LayaDecisionProvider = {
      availability: async () => {
        availabilityCalls += 1
        if (availabilityCalls === 2) {
          await new Promise<void>((resolve) => {
            releaseAvailability = resolve
          })
        }
        return 'available'
      },
      decide
    }
    const { service, authority } = makeService({
      currentSnapshot: (identity) =>
        snapshot({
          surface: identity.surface,
          subjectIds: identity.subjectIds,
          sourceRevision: revision,
          eligibleChoices: ['option-one']
        }),
      provider: configuredProvider
    })
    const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
    expect((await service.advise(identity)).status).toBe('suggestion')

    const pending = service.advise(identity)
    await vi.waitFor(() => expect(releaseAvailability).toBeDefined())
    revision = 'job-1:v2'
    releaseAvailability?.()
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'stale-source' })
    expect(decide).toHaveBeenCalledTimes(1)
    expect(authority.read).toHaveBeenCalledTimes(4)
  })

  it('rechecks authority after a delayed coalesced result before returning it', async () => {
    let revision = 'job-1:v1'
    const coalescedWait = vi.spyOn(LayaAdvisoryRequestBudget.prototype, 'wait')
    let releaseProvider: (() => void) | undefined
    const decide = vi.fn(
      (request: LayaProviderRequest) =>
        new Promise((resolve) => {
          releaseProvider = () => resolve(providerResult(request))
        })
    )
    const { service, authority } = makeService({
      currentSnapshot: (identity) =>
        snapshot({
          surface: identity.surface,
          subjectIds: identity.subjectIds,
          sourceRevision: revision,
          eligibleChoices: ['option-one']
        }),
      provider: provider(decide),
      afterJournalAppend: (result) => {
        if (result.status === 'suggestion') {
          revision = 'job-1:v2'
        }
      }
    })
    const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
    const first = service.advise(identity)
    await vi.waitFor(() => expect(releaseProvider).toBeDefined())
    const second = service.advise(identity)
    await vi.waitFor(() => expect(coalescedWait).toHaveBeenCalledTimes(1))
    releaseProvider?.()
    expect(await first).toMatchObject({ status: 'suggestion' })
    expect(await second).toMatchObject({ status: 'unavailable', reason: 'stale-source' })
    expect(authority.read).toHaveBeenCalledTimes(4)
    expect(coalescedWait).toHaveBeenCalledTimes(1)
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('rechecks deployment-gate provenance after a delayed cache revalidation read', async () => {
    let currentGate = gate()
    let releaseRevalidation: (() => void) | undefined
    const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
    const { service, authority, deploymentGate } = makeService({
      currentSnapshot: async (identity, readCount) => {
        if (readCount === 4) {
          await new Promise<void>((resolve) => {
            releaseRevalidation = resolve
          })
        }
        return snapshot({ surface: identity.surface, subjectIds: identity.subjectIds })
      },
      currentGate: () => currentGate,
      provider: provider(decide)
    })
    const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
    expect((await service.advise(identity)).status).toBe('suggestion')

    const pending = service.advise(identity)
    await vi.waitFor(() => expect(releaseRevalidation).toBeDefined())
    currentGate = gate({ deploymentId: 'deployment-2' })
    releaseRevalidation?.()
    expect(await pending).toMatchObject({
      status: 'unavailable',
      reason: 'deployment-gate-mismatch'
    })
    expect(authority.read).toHaveBeenCalledTimes(4)
    expect(deploymentGate.current).toHaveBeenCalledTimes(4)
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('rejects non-finite or fractional constructor budget options', () => {
    for (const options of [
      { deadlineMs: Number.NaN },
      { maxConcurrent: Number.NaN },
      { maxRequestsPerMinute: Number.POSITIVE_INFINITY },
      { cacheTtlMs: 1.5 },
      { cacheEntries: Number.NaN }
    ]) {
      expect(() => makeService(options)).toThrow('finite safe integer')
    }
  })

  it.each([
    [
      'confidence threshold',
      (current: LayaDeploymentGate) =>
        gate({
          confidenceThresholds: { ...current.confidenceThresholds, 'job-routing': 0.95 }
        }),
      'abstained'
    ],
    ['deployment identity', () => gate({ deploymentId: 'deployment-2' }), 'suggestion'],
    [
      'held-out sample evidence',
      () => gate({ samplesPerSurface: { ...gate().samplesPerSurface, 'job-routing': 21 } }),
      'suggestion'
    ],
    ['evaluation expiry', () => gate({ expiresAt: 9_000 }), 'suggestion']
  ] as const)(
    'does not reuse cached advice when accepted gate %s changes',
    async (_label, updateGate, expectedStatus) => {
      let current = gate()
      const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
      const { service, journal } = makeService({
        currentGate: () => current,
        provider: provider(decide)
      })
      const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
      expect((await service.advise(identity)).status).toBe('suggestion')
      current = updateGate(current)
      expect((await service.advise(identity)).status).toBe(expectedStatus)
      expect(decide).toHaveBeenCalledTimes(2)
      expect(journal.verify().records).toBe(2)
    }
  )

  it.each([
    'authority',
    'availability',
    'initial gate',
    'provider',
    'post-inference gate',
    'post-inference authority'
  ])('applies one request deadline to a never-settling %s operation', async (stage) => {
    const never = () => new Promise<never>(() => {})
    let snapshotReads = 0
    let gateReads = 0
    const decide = vi.fn(async (request: LayaProviderRequest) => providerResult(request))
    let configuredProvider = provider(decide)
    const options: Parameters<typeof makeService>[0] = {
      deadlineMs: 50,
      maxConcurrent: 1,
      currentSnapshot: (identity) =>
        snapshot({ surface: identity.surface, subjectIds: identity.subjectIds }),
      currentGate: () => gate()
    }
    if (stage === 'authority') {
      options.currentSnapshot = () => never()
    } else if (stage === 'availability') {
      configuredProvider = {
        availability: async () => never(),
        decide
      }
    } else if (stage === 'initial gate') {
      options.currentGate = () => never()
    } else if (stage === 'provider') {
      configuredProvider = provider(() => never())
    } else if (stage === 'post-inference gate') {
      options.currentGate = () => (++gateReads === 1 ? gate() : never())
    } else if (stage === 'post-inference authority') {
      options.currentSnapshot = (identity, readCount) => {
        snapshotReads = readCount
        return readCount === 1
          ? snapshot({ surface: identity.surface, subjectIds: identity.subjectIds })
          : never()
      }
    }
    options.provider = configuredProvider
    const { service, authority } = makeService(options)
    expect(await service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })).toMatchObject({
      status: 'unavailable',
      reason: 'deadline'
    })
    if (stage === 'post-inference authority') {
      expect(snapshotReads).toBe(2)
    }
    if (stage === 'authority') {
      expect(await service.advise({ surface: 'job-routing', subjectIds: ['job-2'] })).toMatchObject(
        {
          status: 'unavailable',
          reason: 'backpressure'
        }
      )
      expect(authority.read).toHaveBeenCalledTimes(1)
    }
  })

  it('reserves quota before the first authority await', async () => {
    const { service, authority } = makeService({
      deadlineMs: 50,
      maxConcurrent: 2,
      maxRequestsPerMinute: 1,
      currentSnapshot: () => new Promise<never>(() => {})
    })
    const first = service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    await vi.waitFor(() => expect(authority.read).toHaveBeenCalledTimes(1))
    expect(await service.advise({ surface: 'job-routing', subjectIds: ['job-2'] })).toMatchObject({
      status: 'unavailable',
      reason: 'quota'
    })
    expect(authority.read).toHaveBeenCalledTimes(1)
    await first
  })

  it('retains execution capacity after a provider ignores abort until it settles', async () => {
    let release: ((value: unknown) => void) | undefined
    let wasAborted = false
    let calls = 0
    const { service, authority } = makeService({
      deadlineMs: 50,
      maxConcurrent: 1,
      provider: provider((request, signal) => {
        calls += 1
        if (calls > 1) {
          return Promise.resolve(providerResult(request))
        }
        signal.addEventListener('abort', () => (wasAborted = true), { once: true })
        return new Promise((resolve) => {
          release = resolve
        })
      })
    })
    const identity: LayaAdvisoryIdentity = { surface: 'job-routing', subjectIds: ['job-1'] }
    expect(await service.advise(identity)).toMatchObject({
      status: 'unavailable',
      reason: 'deadline'
    })
    expect(wasAborted).toBe(true)
    expect(await service.advise(identity)).toMatchObject({
      status: 'unavailable',
      reason: 'backpressure'
    })
    expect(authority.read).toHaveBeenCalledTimes(1)
    release?.(undefined)
    await vi.waitFor(async () => expect((await service.advise(identity)).status).toBe('suggestion'))
    expect(calls).toBe(2)
  })

  it('vetoes unsafe suggestions and rejects a source that changes during inference', async () => {
    const dirty = makeService({
      currentSnapshot: (identity) =>
        snapshot({
          surface: identity.surface,
          subjectIds: identity.subjectIds,
          facts: { dirty: true, remoteVerified: true },
          eligibleChoices: []
        }),
      provider: provider(async (request) => providerResult(request, 'archive-candidate'))
    })
    const vetoed = await dirty.service.advise({ surface: 'data', subjectIds: ['folder-1'] })
    expect(vetoed).toMatchObject({ status: 'abstained', reason: 'deterministic-veto' })

    const changed = makeService({
      currentSnapshot: (identity, readCount) =>
        snapshot({
          surface: identity.surface,
          subjectIds: identity.subjectIds,
          sourceRevision: readCount === 1 ? 'job-1:v1' : 'job-1:v2'
        }),
      provider: provider(async (request) => providerResult(request))
    })
    const stale = await changed.service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    expect(stale).toMatchObject({ status: 'unavailable', reason: 'stale-source' })
  })

  it('aborts a provider at the configured deadline and applies request quota', async () => {
    let aborted = false
    const timed = makeService({
      deadlineMs: 50,
      provider: provider(
        (_request, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true
                reject(new Error('aborted'))
              },
              { once: true }
            )
          })
      )
    })
    expect(
      await timed.service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    ).toMatchObject({ status: 'unavailable', reason: 'deadline' })
    expect(aborted).toBe(true)

    const quota = makeService({
      maxRequestsPerMinute: 1,
      provider: provider(async (request) => providerResult(request))
    })
    await quota.service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    expect(
      await quota.service.advise({ surface: 'job-routing', subjectIds: ['job-2'] })
    ).toMatchObject({ status: 'unavailable', reason: 'quota' })
  })

  it('refuses malformed provider probabilities and bounds concurrent work', async () => {
    const malformed = makeService({
      provider: provider(async (request) => ({
        ...providerResult(request),
        probabilities: { 'option-one': 0.8, 'needs-human': 0.1 }
      }))
    })
    expect(
      await malformed.service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    ).toMatchObject({ status: 'unavailable', reason: 'invalid-response' })

    let release: (() => void) | undefined
    const bounded = makeService({
      maxConcurrent: 1,
      provider: provider(
        (request) =>
          new Promise((resolve) => {
            release = () => resolve(providerResult(request))
          })
      )
    })
    const first = bounded.service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })
    await vi.waitFor(() => expect(release).toBeDefined())
    expect(
      await bounded.service.advise({ surface: 'job-routing', subjectIds: ['job-2'] })
    ).toMatchObject({ status: 'unavailable', reason: 'backpressure' })
    release?.()
    expect((await first).status).toBe('suggestion')
  })

  it('rejects a well-formed provider result bound to a different surface', async () => {
    const { service } = makeService({
      provider: provider(async (request) => ({
        ...providerResult(request),
        surface: 'data'
      }))
    })
    expect(await service.advise({ surface: 'job-routing', subjectIds: ['job-1'] })).toMatchObject({
      status: 'unavailable',
      reason: 'invalid-response'
    })
  })
})
