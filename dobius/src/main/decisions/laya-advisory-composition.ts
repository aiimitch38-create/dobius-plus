import {
  LayaDeploymentGate as LayaDeploymentGateSchema,
  type LayaAdvisoryIdentity
} from '../../shared/laya-advisory'
import type { LayaAdvisoryJournal } from './laya-advisory-journal'
import {
  LayaAdvisoryService,
  type LayaAuthorityReader,
  type LayaDecisionProvider,
  type LayaDeploymentGateReader
} from './laya-advisory-service'
import { LayaHttpDecisionProvider } from './laya-http-provider'
import type { LayaAuthorityEpochReader } from './laya-authority-epoch'
import { deploymentGateFailure } from './laya-advisory-policy'

export type LayaAdvisoryCompositionOptions = {
  /** False by default. No HTTP provider is constructed until explicitly enabled. */
  enabled?: boolean
  authority: LayaAuthorityReader
  deploymentGate: LayaDeploymentGateReader
  /** The same main-owned synchronous epoch is passed to both service and provider. */
  authorityEpoch: LayaAuthorityEpochReader
  journal: LayaAdvisoryJournal
  readDeploymentReceipt?: (signal: AbortSignal) => Promise<unknown>
  resolveAuthorization?: (signal: AbortSignal) => Promise<string | null>
  fetch?: typeof fetch
  now?: () => number
  monotonicNow?: () => number
  deadlineMs?: number
  maxConcurrent?: number
  maxRequestsPerMinute?: number
  cacheTtlMs?: number
  cacheEntries?: number
}

/**
 * Creates the advisory-only service. The factory exposes no execution or mutation capability.
 * The provider stays absent unless an owner explicitly enables it and supplies trusted readers.
 */
export function createLayaAdvisoryComposition(options: LayaAdvisoryCompositionOptions) {
  const now = options.now ?? Date.now
  const provider = createProvider(options, now)

  const service = new LayaAdvisoryService({
    authority: options.authority,
    deploymentGate: options.deploymentGate,
    authorityEpoch: options.authorityEpoch,
    journal: options.journal,
    provider,
    now,
    deadlineMs: options.deadlineMs,
    maxConcurrent: options.maxConcurrent,
    maxRequestsPerMinute: options.maxRequestsPerMinute,
    cacheTtlMs: options.cacheTtlMs,
    cacheEntries: options.cacheEntries
  })
  return { advise: service.advise.bind(service) }
}

function createProvider(
  options: LayaAdvisoryCompositionOptions,
  now: () => number
): LayaDecisionProvider | undefined {
  if (options.enabled !== true || !options.readDeploymentReceipt || !options.resolveAuthorization) {
    return undefined
  }

  const http = new LayaHttpDecisionProvider({
    readDeploymentReceipt: options.readDeploymentReceipt,
    resolveAuthorization: options.resolveAuthorization,
    readEpoch: () => options.authorityEpoch.current(),
    fetch: options.fetch,
    now,
    monotonicNow: options.monotonicNow,
    deadlineMs: options.deadlineMs
  })

  return {
    async availability(surface: LayaAdvisoryIdentity['surface'], signal: AbortSignal) {
      // LayaHttpDecisionProvider resolves credentials and performs authenticated health checks
      // from availability(), so require the accepted human-evaluation gate first.
      try {
        const rawGate = await options.deploymentGate.current(signal)
        const parsedGate = LayaDeploymentGateSchema.safeParse(rawGate)
        if (!parsedGate.success || deploymentGateFailure(parsedGate.data, now())) {
          return 'unavailable'
        }
      } catch {
        return 'unavailable'
      }
      return http.availability(surface, signal)
    },
    decide: (request, signal) => http.decide(request, signal)
  }
}
