import { describe, expect, it, vi } from 'vitest'
import type { AdamTokenResult } from '../../adam-connection'
import { canonicalCloudJobAdamSha256 } from '../../../shared/cloud-job-adam-receipts'
import { CloudJobAdamClient } from './cloud-job-adam-client'
import {
  adamBindingGrant,
  adamBindingResponse,
  adamJobInput
} from './cloud-job-adam-client.fixtures'

const target =
  (endpoint = 'http://127.0.0.1:8791') =>
  () => ({ ok: true as const, endpoint })
const token = async () => ({ token: 'synthetic-token' })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

function createClient(
  fetchImpl: typeof fetch,
  options: {
    now?: () => number
    resolveTarget?: () => ReturnType<ReturnType<typeof target>>
    readAuthorityEpoch?: () => string | null
  } = {}
) {
  return new CloudJobAdamClient({
    resolveTarget: options.resolveTarget ?? target(),
    resolveToken: token,
    readAuthorityEpoch: options.readAuthorityEpoch ?? (() => 'epoch-1'),
    fetch: fetchImpl,
    now: options.now ?? (() => 10_000)
  })
}

describe('CloudJobAdamClient recovery consume', () => {
  it('replays an exact consumed response after expiry while normal consume remains fresh-only', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(adamBindingResponse()))
    const grant = adamBindingGrant()
    const client = createClient(fetchImpl, { now: () => grant.expiresAtMs + 1 })

    const recovered = await client.consumeBindingForRecovery(grant, adamJobInput())
    expect(recovered).toEqual({ state: 'accepted', value: adamBindingResponse() })
    expect(await client.consumeBinding(grant, adamJobInput())).toEqual({
      state: 'unavailable',
      reason: 'expired-binding'
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(recovered)).not.toContain(grant.capability)
  })

  it('rejects an expired unconsumed server response without accepting or falling back', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ ok: false, error: 'conflict' }, 409))
    const result = await createClient(fetchImpl).consumeBindingForRecovery(
      adamBindingGrant(),
      adamJobInput()
    )
    expect(result).toEqual({ state: 'unavailable', reason: 'remote-error' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects a response bound at expiry and an exact-identity mismatch', async () => {
    const grant = adamBindingGrant()
    const atExpiry = { ...adamBindingResponse(), boundAtMs: grant.expiresAtMs }
    const expired = await createClient(
      vi.fn<typeof fetch>(async () => json(atExpiry))
    ).consumeBindingForRecovery(grant, adamJobInput())
    expect(expired).toEqual({ state: 'unavailable', reason: 'expired-binding' })

    const wrongInstance = {
      ...adamBindingResponse(),
      binding: { ...adamBindingResponse().binding, adamInstanceId: 'other-adam' }
    }
    wrongInstance.bindingDigest = canonicalCloudJobAdamSha256(wrongInstance.binding)
    const mismatch = await createClient(
      vi.fn<typeof fetch>(async () => json(wrongInstance))
    ).consumeBindingForRecovery(grant, adamJobInput())
    expect(mismatch).toEqual({ state: 'unavailable', reason: 'receipt-binding-mismatch' })
  })

  it('rejects a malformed response without exposing the capability', async () => {
    const grant = adamBindingGrant()
    const malformed = { ...adamBindingResponse(), unexpected: grant.capability }
    const result = await createClient(
      vi.fn<typeof fetch>(async () => json(malformed))
    ).consumeBindingForRecovery(grant, adamJobInput())
    expect(result).toEqual({ state: 'unavailable', reason: 'malformed-response' })
    expect(JSON.stringify(result)).not.toContain(grant.capability)
  })

  it('rejects endpoint and authorization epoch changes during recovery transport', async () => {
    let targetReads = 0
    const endpointFetch = vi.fn<typeof fetch>(async () => json(adamBindingResponse()))
    const endpointResult = await createClient(endpointFetch, {
      resolveTarget: () => {
        targetReads += 1
        return targetReads < 3
          ? { ok: true as const, endpoint: 'http://127.0.0.1:8791' }
          : { ok: true as const, endpoint: 'http://127.0.0.1:8792' }
      }
    }).consumeBindingForRecovery(adamBindingGrant(), adamJobInput())
    expect(endpointResult).toEqual({ state: 'unavailable', reason: 'endpoint-changed' })
    expect(endpointFetch).toHaveBeenCalledTimes(1)

    let epoch = 'epoch-1'
    const epochFetch = vi.fn<typeof fetch>(async () => {
      epoch = 'epoch-2'
      return json(adamBindingResponse())
    })
    const epochResult = await createClient(epochFetch, {
      readAuthorityEpoch: () => epoch
    }).consumeBindingForRecovery(adamBindingGrant(), adamJobInput())
    expect(epochResult).toEqual({ state: 'unavailable', reason: 'auth-unavailable' })
    expect(epochFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps recovery unavailable when the bounded transport times out', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const client = new CloudJobAdamClient({
      resolveTarget: target(),
      resolveToken: () => new Promise<AdamTokenResult>(() => {}),
      readAuthorityEpoch: () => 'epoch-1',
      fetch: fetchImpl,
      deadlineMs: 100,
      now: () => 10_000
    })

    expect(await client.consumeBindingForRecovery(adamBindingGrant(), adamJobInput())).toEqual({
      state: 'unavailable',
      reason: 'timeout'
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
