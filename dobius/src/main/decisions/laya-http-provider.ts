import { performance } from 'node:perf_hooks'
import type {
  LayaAdvisorySurface as Surface,
  LayaProviderDecision as ProviderDecision,
  LayaProviderRequest as ProviderRequest
} from '../../shared/laya-advisory'
import type { LayaDecisionProvider } from './laya-advisory-service-execution'
import { deploymentGateFailure } from './laya-advisory-policy'
import {
  EXPECTED_CHECKPOINT_REVISION,
  EXPECTED_SOURCE_REVISION,
  MAX_REQUEST_BYTES,
  TrustedDeploymentReceipt,
  assertNotAborted,
  authorizationHeader,
  boundedDeadline,
  linkedDeadline,
  loopbackEndpoint,
  isSupportedSurface,
  parseChoiceResponse,
  parseHealth,
  readJsonBounded,
  strictLayaProviderRequest,
  validEpoch,
  type LayaHttpProviderOptions,
  type Receipt
} from './laya-http-provider-contract'

export { strictLayaProviderRequest } from './laya-http-provider-contract'
export type { LayaHttpProviderOptions } from './laya-http-provider-contract'

/**
 * Invoke through LayaAdvisoryService so its request budget bounds dependencies that ignore abort.
 * This adapter signals cancellation at its own deadline but cannot force an uncooperative promise to settle.
 */
export class LayaHttpDecisionProvider implements LayaDecisionProvider {
  private readonly fetchImpl: typeof fetch
  private readonly deadlineMs: number
  private readonly now: () => number
  private readonly monotonicNow: () => number
  private inFlight = false

  constructor(private readonly options: LayaHttpProviderOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.deadlineMs = boundedDeadline(options.deadlineMs)
    this.now = options.now ?? Date.now
    this.monotonicNow = options.monotonicNow ?? performance.now.bind(performance)
  }

  async availability(
    surface: Surface,
    parentSignal: AbortSignal
  ): Promise<'available' | 'unsupported' | 'unavailable'> {
    if (!isSupportedSurface(surface)) {
      return 'unsupported'
    }
    if (this.inFlight) {
      return 'unavailable'
    }
    this.inFlight = true
    const linked = linkedDeadline(parentSignal, this.deadlineMs)
    try {
      const epoch = this.captureEpoch()
      const receipt = await this.readReceipt(epoch, linked.signal)
      const token = await this.options.resolveAuthorization(linked.signal)
      assertNotAborted(linked.signal)
      const authorization = authorizationHeader(token)
      const current = await this.readReceipt(epoch, linked.signal)
      this.assertSameDeployment(receipt, current)
      const healthy = await this.readHealth(epoch, current, authorization, linked.signal)
      await this.assertCurrent(epoch, current, linked.signal)
      return healthy ? 'available' : 'unavailable'
    } catch {
      return 'unavailable'
    } finally {
      linked.dispose()
      this.inFlight = false
    }
  }

  async decide(rawRequest: ProviderRequest, parentSignal: AbortSignal): Promise<ProviderDecision> {
    const request = strictLayaProviderRequest(rawRequest)
    if (this.inFlight) {
      throw new Error('Laya provider is already handling one request.')
    }
    this.inFlight = true
    const started = this.monotonicNow()
    const linked = linkedDeadline(parentSignal, this.deadlineMs)
    try {
      const epoch = this.captureEpoch()
      const receipt = await this.readReceipt(epoch, linked.signal, request)
      const token = await this.options.resolveAuthorization(linked.signal)
      assertNotAborted(linked.signal)
      const authorization = authorizationHeader(token)
      const current = await this.readReceipt(epoch, linked.signal, request)
      this.assertSameDeployment(receipt, current)
      if (!(await this.readHealth(epoch, current, authorization, linked.signal))) {
        throw new Error(
          'Authenticated Laya health did not prove the pinned multilingual checkpoint is loaded.'
        )
      }
      await this.assertCurrent(epoch, current, linked.signal, request)

      const body = JSON.stringify({
        // The fork treats model/task as routing controls; pin only the trusted checkpoint.
        model: current.model,
        state: JSON.stringify({ surface: request.surface, facts: request.facts }),
        questions: {
          dobius_decision: { type: 'choice', criteria: request.choices }
        }
      })
      if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
        throw new Error('Laya request exceeds the configured size limit.')
      }
      // Keep this synchronous check adjacent to fetch: no asynchronous gap may separate the
      // trusted epoch proof from sending the bearer-authenticated request.
      this.assertEpoch(epoch)
      const response = await this.fetchImpl(new URL('/v1/systemone', current.endpoint).toString(), {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: linked.signal,
        headers: { authorization, 'content-type': 'application/json', accept: 'application/json' },
        body
      })
      assertNotAborted(linked.signal)
      await this.assertCurrent(epoch, current, linked.signal, request)
      if (!response.ok || response.redirected) {
        throw new Error('Laya inference request was refused.')
      }
      const raw = await readJsonBounded(response)
      assertNotAborted(linked.signal)
      const afterResponse = await this.readReceipt(epoch, linked.signal, request)
      this.assertSameDeployment(current, afterResponse)
      if (!(await this.readHealth(epoch, afterResponse, authorization, linked.signal))) {
        throw new Error(
          'Authenticated Laya health no longer proves the pinned checkpoint is loaded.'
        )
      }
      await this.assertCurrent(epoch, afterResponse, linked.signal, request)
      const parsed = parseChoiceResponse(raw, afterResponse, request, this.now())
      return {
        ...parsed,
        elapsedMs: Math.max(0, this.monotonicNow() - started)
      }
    } finally {
      linked.dispose()
      this.inFlight = false
    }
  }

  private captureEpoch(): number {
    const value = this.options.readEpoch()
    if (!validEpoch(value)) {
      throw new Error('Trusted Laya deployment epoch is unavailable.')
    }
    return value
  }

  private async readReceipt(
    epoch: number,
    signal: AbortSignal,
    request?: ProviderRequest
  ): Promise<Receipt> {
    this.assertEpoch(epoch)
    const raw = await this.options.readDeploymentReceipt(signal)
    assertNotAborted(signal)
    this.assertEpoch(epoch)
    const receipt = TrustedDeploymentReceipt.parse(raw)
    loopbackEndpoint(receipt.endpoint)
    if (deploymentGateFailure(receipt.gate, this.now())) {
      throw new Error('Trusted Laya deployment receipt is not current.')
    }
    if (
      receipt.gate.sourceRevision !== EXPECTED_SOURCE_REVISION ||
      receipt.gate.checkpointRevision !== EXPECTED_CHECKPOINT_REVISION
    ) {
      throw new Error(
        'Trusted Laya deployment receipt does not match the pinned source/checkpoint.'
      )
    }
    if (
      request &&
      (request.modelSourceRevision !== receipt.gate.sourceRevision ||
        request.checkpointRevision !== receipt.gate.checkpointRevision ||
        request.evaluationReportSha256 !== receipt.gate.evaluationReportSha256 ||
        request.policyVersion !== receipt.gate.policyVersion)
    ) {
      throw new Error('Laya request pins do not match the trusted deployment receipt.')
    }
    return receipt
  }

  private async readHealth(
    epoch: number,
    receipt: Receipt,
    authorization: string,
    signal: AbortSignal
  ) {
    // This check must remain immediately before every authenticated health fetch.
    this.assertEpoch(epoch)
    const response = await this.fetchImpl(new URL('/health', receipt.endpoint).toString(), {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal,
      headers: { authorization, accept: 'application/json' }
    })
    assertNotAborted(signal)
    if (!response.ok || response.redirected) {
      return false
    }
    const raw = await readJsonBounded(response)
    assertNotAborted(signal)
    return parseHealth(raw, receipt)
  }

  private async assertCurrent(
    epoch: number,
    receipt: Receipt,
    signal: AbortSignal,
    request?: ProviderRequest
  ) {
    const current = await this.readReceipt(epoch, signal, request)
    this.assertSameDeployment(receipt, current)
    return current
  }

  private assertEpoch(epoch: number) {
    if (this.options.readEpoch() !== epoch) {
      throw new Error('Trusted Laya deployment epoch changed.')
    }
  }

  private assertSameDeployment(before: Receipt, after: Receipt) {
    if (
      before.endpoint !== after.endpoint ||
      before.model !== after.model ||
      before.gate.deploymentId !== after.gate.deploymentId ||
      before.gate.sourceRevision !== after.gate.sourceRevision ||
      before.gate.checkpointRevision !== after.gate.checkpointRevision ||
      before.gate.evaluationReportSha256 !== after.gate.evaluationReportSha256 ||
      JSON.stringify(before.gate) !== JSON.stringify(after.gate)
    ) {
      throw new Error('Trusted Laya deployment receipt changed during the request.')
    }
  }
}
