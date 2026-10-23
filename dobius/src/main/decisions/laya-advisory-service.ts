import { randomUUID } from 'node:crypto'
import {
  LayaAdvisoryIdentity as LayaAdvisoryIdentitySchema,
  LayaAuthoritySnapshot as LayaAuthoritySnapshotSchema,
  LayaDeploymentGate as LayaDeploymentGateSchema,
  type LayaAdvisoryIdentity,
  type LayaAdvisoryResult,
  type LayaAuthoritySnapshot,
  type LayaDeploymentGate,
  type LayaProviderRequest
} from '../../shared/laya-advisory'
import type { LayaAdvisoryJournal } from './laya-advisory-journal'
import {
  executeLayaAdvisory,
  recordAuthorityUnavailableAdvisory,
  recordUnavailableAdvisory,
  revalidateAdvisoryInputs,
  unavailableLayaDecisionProvider,
  type LayaAuthorityReader,
  type LayaDecisionProvider,
  type LayaDeploymentGateReader
} from './laya-advisory-service-execution'
import {
  authorityEpochMatches,
  captureAuthorityEpoch,
  createRevisionDigestKey,
  type LayaAuthorityEpochReader
} from './laya-authority-epoch'
import {
  boundedLayaAdvisoryLimits,
  LayaAdvisoryRequestBudget,
  pruneRequestTimestamps
} from './laya-advisory-request-budget'
import {
  authoritySnapshotIsFresh,
  deploymentGateFailure,
  digestAdvisoryInput,
  isCurrentAuthorityIdentity,
  makeProviderRequest
} from './laya-advisory-policy'

export type { LayaAuthorityReader, LayaDecisionProvider, LayaDeploymentGateReader }
export type LayaAdvisoryServiceOptions = {
  authority: LayaAuthorityReader
  deploymentGate: LayaDeploymentGateReader
  authorityEpoch?: LayaAuthorityEpochReader
  journal: LayaAdvisoryJournal
  provider?: LayaDecisionProvider
  now?: () => number
  deadlineMs?: number
  maxConcurrent?: number
  maxRequestsPerMinute?: number
  cacheTtlMs?: number
  cacheEntries?: number
}

export class LayaAdvisoryService {
  private readonly provider: LayaDecisionProvider
  private readonly now: () => number
  private readonly deadlineMs: number
  private readonly maxConcurrent: number
  private readonly maxRequestsPerMinute: number
  private readonly cacheTtlMs: number
  private readonly cacheEntries: number
  private readonly revisionDigestKey = createRevisionDigestKey()
  private inFlight = 0
  private readonly requests: number[] = []
  private readonly cache = new Map<string, { expiresAt: number; result: LayaAdvisoryResult }>()
  private readonly active = new Map<string, Promise<LayaAdvisoryResult>>()

  constructor(private readonly options: LayaAdvisoryServiceOptions) {
    this.provider = options.provider ?? unavailableLayaDecisionProvider
    this.now = options.now ?? Date.now
    const limits = boundedLayaAdvisoryLimits(options)
    this.deadlineMs = limits.deadlineMs
    this.maxConcurrent = limits.maxConcurrent
    this.maxRequestsPerMinute = limits.maxRequestsPerMinute
    this.cacheTtlMs = limits.cacheTtlMs
    this.cacheEntries = limits.cacheEntries
  }
  async advise(rawIdentity: LayaAdvisoryIdentity): Promise<LayaAdvisoryResult> {
    const identity = LayaAdvisoryIdentitySchema.parse(rawIdentity)
    const unavailable = (
      reason: Extract<LayaAdvisoryResult, { status: 'unavailable' }>['reason']
    ) => recordAuthorityUnavailableAdvisory(this.options.journal, identity, reason, this.now())
    const epochTicket = captureAuthorityEpoch(this.options.authorityEpoch)
    if (epochTicket === null) {
      return unavailable('authority-epoch-unavailable')
    }
    if (new Set(identity.subjectIds).size !== identity.subjectIds.length) {
      return unavailable('authority-unavailable')
    }
    pruneRequestTimestamps(this.requests, this.now())
    if (this.inFlight >= this.maxConcurrent) {
      return unavailable('backpressure')
    }
    if (this.requests.length >= this.maxRequestsPerMinute) {
      return unavailable('quota')
    }
    this.requests.push(this.now())
    this.inFlight += 1
    const budget = new LayaAdvisoryRequestBudget(this.deadlineMs)
    try {
      return await this.adviseWithinBudget(identity, budget, epochTicket)
    } catch {
      return unavailable(budget.expired ? 'deadline' : 'provider-error')
    } finally {
      budget.close(() => {
        this.inFlight -= 1
      })
    }
  }
  private async adviseWithinBudget(
    identity: LayaAdvisoryIdentity,
    budget: LayaAdvisoryRequestBudget,
    epochTicket: number
  ): Promise<LayaAdvisoryResult> {
    let snapshot: LayaAuthoritySnapshot
    try {
      snapshot = LayaAuthoritySnapshotSchema.parse(
        await budget.run((signal) => this.options.authority.read(identity, signal))
      )
    } catch {
      return recordAuthorityUnavailableAdvisory(
        this.options.journal,
        identity,
        budget.expired ? 'deadline' : 'authority-unavailable',
        this.now()
      )
    }
    if (!isCurrentAuthorityIdentity(identity, snapshot, this.now())) {
      return this.recordUnavailable(snapshot, 'authority-unavailable')
    }

    let availability: Awaited<ReturnType<LayaDecisionProvider['availability']>> = 'unavailable'
    try {
      availability = await budget.run((signal) =>
        this.provider.availability(snapshot.surface, signal)
      )
    } catch {
      if (budget.expired) {
        return this.recordUnavailable(snapshot, 'deadline')
      }
    }
    if (availability !== 'available') {
      return this.recordUnavailable(
        snapshot,
        availability === 'unsupported' ? 'provider-unsupported-surface' : 'provider-not-deployed'
      )
    }

    let gate: LayaDeploymentGate
    try {
      gate = LayaDeploymentGateSchema.parse(
        await budget.run((signal) => this.options.deploymentGate.current(signal))
      )
    } catch {
      return this.recordUnavailable(
        snapshot,
        budget.expired ? 'deadline' : 'deployment-gate-missing'
      )
    }
    const invalidGate = deploymentGateFailure(gate, this.now())
    if (invalidGate) {
      return this.recordUnavailable(snapshot, invalidGate)
    }
    if (!authoritySnapshotIsFresh(snapshot, this.now())) {
      return this.recordUnavailable(snapshot, 'stale-source')
    }

    const request = makeProviderRequest(snapshot, gate, this.revisionDigestKey)
    const cacheKey = `${request.requestDigest}:${epochTicket}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) {
      const failure = await revalidateAdvisoryInputs(
        this.options,
        identity,
        snapshot,
        gate,
        budget,
        this.now,
        this.options.authorityEpoch,
        epochTicket
      )
      if (failure) {
        return this.recordUnavailable(snapshot, failure, request.requestDigest, randomUUID(), gate)
      }
      return authorityEpochMatches(this.options.authorityEpoch, epochTicket)
        ? cached.result
        : this.recordUnavailable(
            snapshot,
            'authority-epoch-changed',
            request.requestDigest,
            randomUUID(),
            gate
          )
    }
    const active = this.active.get(cacheKey)
    if (active) {
      try {
        const result = await budget.wait(active)
        const failure = await revalidateAdvisoryInputs(
          this.options,
          identity,
          snapshot,
          gate,
          budget,
          this.now,
          this.options.authorityEpoch,
          epochTicket
        )
        if (failure) {
          return this.recordUnavailable(
            snapshot,
            failure,
            request.requestDigest,
            randomUUID(),
            gate
          )
        }
        return authorityEpochMatches(this.options.authorityEpoch, epochTicket)
          ? result
          : this.recordUnavailable(
              snapshot,
              'authority-epoch-changed',
              request.requestDigest,
              randomUUID(),
              gate
            )
      } catch {
        return this.recordUnavailable(snapshot, 'deadline', request.requestDigest)
      }
    }
    return this.execute(snapshot, gate, request, randomUUID(), budget, epochTicket, cacheKey)
  }

  private async execute(
    snapshot: LayaAuthoritySnapshot,
    gate: LayaDeploymentGate,
    request: LayaProviderRequest,
    decisionId: string,
    budget: LayaAdvisoryRequestBudget,
    epochTicket: number,
    cacheKey: string
  ): Promise<LayaAdvisoryResult> {
    const startedAt = this.now()
    const work = executeLayaAdvisory(
      {
        authority: this.options.authority,
        deploymentGate: this.options.deploymentGate,
        authorityEpoch: this.options.authorityEpoch,
        epochTicket,
        provider: this.provider,
        journal: this.options.journal,
        now: this.now,
        cacheSuggestion: (result) => {
          if (this.cacheTtlMs > 0) {
            this.cache.set(cacheKey, {
              expiresAt: this.now() + this.cacheTtlMs,
              result
            })
            while (this.cache.size > this.cacheEntries) {
              this.cache.delete(this.cache.keys().next().value!)
            }
          }
        }
      },
      snapshot,
      gate,
      request,
      decisionId,
      budget,
      startedAt
    )
    this.active.set(cacheKey, work)
    try {
      return await work
    } finally {
      this.active.delete(cacheKey)
    }
  }

  private async recordUnavailable(
    snapshot: LayaAuthoritySnapshot,
    reason: Extract<LayaAdvisoryResult, { status: 'unavailable' }>['reason'],
    requestDigest = digestAdvisoryInput({ snapshot }),
    decisionId: string = randomUUID(),
    gate?: LayaDeploymentGate
  ): Promise<LayaAdvisoryResult> {
    return recordUnavailableAdvisory(
      this.options.journal,
      snapshot,
      reason,
      this.now(),
      requestDigest,
      decisionId,
      gate
    )
  }
}
