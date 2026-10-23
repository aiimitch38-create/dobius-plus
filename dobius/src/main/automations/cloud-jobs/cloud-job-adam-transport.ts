import {
  resolveAdamTarget,
  resolveAdamToken,
  type AdamTarget,
  type AdamTokenResult
} from '../../adam-connection'
import { captureAdamAuthorizationEpoch } from '../../adam-authorization-epoch'
import {
  cancelAdamResponse,
  maxAdamResponseBytes,
  readBoundedJson,
  RequestDeadlineExceeded,
  ResponseTooLarge
} from './cloud-job-adam-response-reader'

const DEFAULT_DEADLINE_MS = 4_000
const MIN_DEADLINE_MS = 100
const MAX_DEADLINE_MS = 10_000
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_PENDING_REQUESTS = 8

export type CloudJobAdamUnavailableReason =
  | 'endpoint-blocked'
  | 'endpoint-changed'
  | 'auth-unavailable'
  | 'unsupported'
  | 'unauthorized'
  | 'remote-error'
  | 'malformed-response'
  | 'request-too-large'
  | 'response-too-large'
  | 'timeout'
  | 'transport-error'
  | 'expired-binding'
  | 'receipt-binding-mismatch'
  | 'receipt-ack-mismatch'
  | 'busy'

export type CloudJobAdamResult<T> =
  | { state: 'accepted'; value: T }
  | { state: 'unavailable'; reason: CloudJobAdamUnavailableReason }

export type CloudJobAdamTransportOptions = {
  resolveTarget?: () => AdamTarget
  resolveToken?: () => Promise<AdamTokenResult>
  readAuthorityEpoch?: () => string | null
  fetch?: typeof fetch
  deadlineMs?: number
  maxResponseBytes?: number
}

export type CloudJobAdamRoute =
  | 'v1/dobius/cloud-job-bindings/consume'
  | 'v1/dobius/cloud-job-receipts'

export class CloudJobAdamTransport {
  private readonly resolveTarget: () => AdamTarget
  private readonly resolveToken: () => Promise<AdamTokenResult>
  private readonly readAuthorityEpoch: () => string | null
  private readonly fetchImpl: typeof fetch
  private readonly deadlineMs: number
  private readonly maxResponseBytes: number
  private activeRequests = 0

  constructor(options: CloudJobAdamTransportOptions = {}) {
    if ((options.resolveTarget || options.resolveToken) && !options.readAuthorityEpoch) {
      throw new TypeError('Injected ADAM target or token requires a trusted authority epoch.')
    }
    this.resolveTarget = options.resolveTarget ?? resolveAdamTarget
    this.resolveToken = options.resolveToken ?? resolveAdamToken
    this.readAuthorityEpoch = options.readAuthorityEpoch ?? captureAdamAuthorizationEpoch
    this.fetchImpl = options.fetch ?? fetch
    this.deadlineMs = boundedInteger(
      options.deadlineMs ?? DEFAULT_DEADLINE_MS,
      MIN_DEADLINE_MS,
      MAX_DEADLINE_MS
    )
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? maxAdamResponseBytes(),
      1024,
      maxAdamResponseBytes()
    )
  }

  async postJson(path: CloudJobAdamRoute, body: string): Promise<CloudJobAdamResult<unknown>> {
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
      return unavailable('request-too-large')
    }
    if (this.activeRequests >= MAX_PENDING_REQUESTS) {
      return unavailable('busy')
    }
    this.activeRequests += 1
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new RequestDeadlineExceeded())
      }, this.deadlineMs)
    })
    const operation = this.perform(path, body, controller.signal)
    const releaseSlot = () => {
      this.activeRequests = Math.max(0, this.activeRequests - 1)
    }
    void operation.then(releaseSlot, releaseSlot)
    try {
      return await Promise.race([operation, deadline])
    } catch (error) {
      return unavailable(error instanceof RequestDeadlineExceeded ? 'timeout' : 'transport-error')
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  private async perform(
    path: CloudJobAdamRoute,
    body: string,
    signal: AbortSignal
  ): Promise<CloudJobAdamResult<unknown>> {
    const target = this.resolveTarget()
    if (!target.ok) {
      return unavailable('endpoint-blocked')
    }
    const authorityEpoch = this.readCurrentAuthorityEpoch()
    if (!authorityEpoch) {
      return unavailable('auth-unavailable')
    }
    let tokenResult: AdamTokenResult
    try {
      tokenResult = await this.resolveToken()
    } catch {
      return unavailable('auth-unavailable')
    }
    if (signal.aborted) {
      throw new RequestDeadlineExceeded()
    }
    if (!tokenResult.token?.trim()) {
      return unavailable('auth-unavailable')
    }

    // The epoch is an opaque synchronous snapshot; token lookup itself may await file I/O.
    const afterToken = this.checkSelectedAuthority(target.endpoint, authorityEpoch)
    if (afterToken) {
      return unavailable(afterToken)
    }
    if (signal.aborted) {
      throw new RequestDeadlineExceeded()
    }

    let url: URL
    try {
      url = new URL(path, `${target.endpoint.replace(/\/+$/, '')}/`)
      if (url.username || url.password || url.search || url.hash) {
        return unavailable('endpoint-blocked')
      }
    } catch {
      return unavailable('endpoint-blocked')
    }
    const response = await this.fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      cache: 'no-store',
      signal,
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body
    })
    const afterResponse = this.checkSelectedAuthority(target.endpoint, authorityEpoch)
    if (afterResponse) {
      // A sent bearer cannot be recalled; retire its response when local authority moved.
      cancelAdamResponse(response)
      return unavailable(afterResponse)
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      return unavailable('endpoint-changed')
    }
    if (response.status === 404) {
      return unavailable('unsupported')
    }
    if (response.status === 401 || response.status === 403) {
      return unavailable('unauthorized')
    }
    if (!response.ok) {
      return unavailable('remote-error')
    }
    try {
      const text = await readBoundedJson(response, this.maxResponseBytes, signal)
      const afterBody = this.checkSelectedAuthority(target.endpoint, authorityEpoch)
      if (afterBody) {
        return unavailable(afterBody)
      }
      return { state: 'accepted', value: JSON.parse(text) as unknown }
    } catch (error) {
      if (error instanceof ResponseTooLarge) {
        return unavailable('response-too-large')
      }
      if (error instanceof RequestDeadlineExceeded) {
        throw error
      }
      return unavailable('malformed-response')
    }
  }

  private readCurrentAuthorityEpoch(): string | null {
    try {
      const epoch = this.readAuthorityEpoch()
      return typeof epoch === 'string' && epoch.length > 0 ? epoch : null
    } catch {
      return null
    }
  }

  private checkSelectedAuthority(
    endpoint: string,
    expectedEpoch: string
  ): CloudJobAdamUnavailableReason | null {
    const epoch = this.readCurrentAuthorityEpoch()
    if (!epoch || epoch !== expectedEpoch) {
      return 'auth-unavailable'
    }
    const target = this.resolveTarget()
    if (!target.ok) {
      return 'endpoint-blocked'
    }
    return target.endpoint === endpoint ? null : 'endpoint-changed'
  }
}

function boundedInteger(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError('Invalid client bound.')
  }
  return value
}

function unavailable(reason: CloudJobAdamUnavailableReason): CloudJobAdamResult<never> {
  return { state: 'unavailable', reason }
}
