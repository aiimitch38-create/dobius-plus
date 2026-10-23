import { describe, expect, it, vi } from 'vitest'
import type { AdamTokenResult } from '../../adam-connection'
import {
  canonicalCloudJobAdamJson,
  canonicalCloudJobAdamSha256,
  CloudJobAdamReceipt
} from '../../../shared/cloud-job-adam-receipts'
import { CloudJobAdamClient } from './cloud-job-adam-client'
import {
  adamAck,
  adamBindingGrant,
  adamBindingResponse,
  adamJobInput,
  adamReceipt
} from './cloud-job-adam-client.fixtures'

const target =
  (endpoint = 'http://127.0.0.1:8791') =>
  () => ({ ok: true as const, endpoint })
const token = async () => ({ token: 'synthetic-token' })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const client = (
  fetchImpl: typeof fetch,
  extra: {
    now?: () => number
    resolveTarget?: () => ReturnType<ReturnType<typeof target>>
    resolveToken?: () => Promise<AdamTokenResult>
    readAuthorityEpoch?: () => string | null
    deadlineMs?: number
  } = {}
) =>
  new CloudJobAdamClient({
    resolveTarget: extra.resolveTarget ?? target(),
    resolveToken: extra.resolveToken ?? token,
    readAuthorityEpoch: extra.readAuthorityEpoch ?? (() => 'synthetic-authority-1'),
    fetch: fetchImpl,
    now: extra.now ?? (() => 6_000),
    deadlineMs: extra.deadlineMs
  })

describe('CloudJobAdamClient', () => {
  it('requires tests with injected target or token to inject a trusted epoch reader', () => {
    expect(
      () =>
        new CloudJobAdamClient({
          resolveTarget: target(),
          resolveToken: token,
          fetch: vi.fn<typeof fetch>()
        })
    ).toThrow(/trusted authority epoch/)
  })

  it('canonicalizes key order and rejects unbounded or non-JSON values', () => {
    expect(canonicalCloudJobAdamJson({ z: 1, a: { y: true, x: null } })).toBe(
      '{"a":{"x":null,"y":true},"z":1}'
    )
    expect(canonicalCloudJobAdamSha256({ z: 1, a: 'b' })).toBe(
      'db47b35af23e0e7dca1fef53db7bff6c0d24fc5b8a45a5acc8e560526c1a4094'
    )
    expect(() => canonicalCloudJobAdamJson({ value: Number.NaN })).toThrow()
    expect(() => canonicalCloudJobAdamJson({ value: 'x'.repeat(70_000) })).toThrow(/size limit/)
  })

  it('consumes only a fresh grant bound to the canonical project request and exact response digest', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe('manual')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' })
      const sent = JSON.parse(String(init?.body)) as {
        capability: string
        binding: { projectId: string }
      }
      expect(sent.capability).toBe(adamBindingGrant().capability)
      expect(sent.binding.projectId).toBe('project-1')
      return json(adamBindingResponse())
    })
    const result = await client(fetchImpl).consumeBinding(adamBindingGrant(), adamJobInput())
    expect(result.state).toBe('accepted')
    expect(JSON.stringify(result)).not.toContain(adamBindingGrant().capability)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses request fingerprint, project, and expired-grant mismatches before network access', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const grant = adamBindingGrant()
    expect(
      (await client(fetchImpl).consumeBinding(grant, { ...adamJobInput(), title: 'changed' })).state
    ).toBe('unavailable')
    expect(
      (
        await client(fetchImpl).consumeBinding(grant, {
          ...adamJobInput(),
          projectId: 'other-project'
        })
      ).state
    ).toBe('unavailable')
    expect(
      (
        await client(fetchImpl).consumeBinding(grant, {
          ...adamJobInput(),
          projectId: '/Users/private/project'
        })
      ).state
    ).toBe('unavailable')
    expect(
      (
        await client(fetchImpl, { now: () => grant.expiresAtMs }).consumeBinding(
          grant,
          adamJobInput()
        )
      ).state
    ).toBe('unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not return a binding response that arrives after the grant expires', async () => {
    let reads = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => json(adamBindingResponse()))
    const result = await client(fetchImpl, {
      now: () => (reads++ === 0 ? 6_000 : 9_000)
    }).consumeBinding(adamBindingGrant(), adamJobInput())
    expect(result).toEqual({ state: 'unavailable', reason: 'expired-binding' })
  })

  it('does not send a resolved token if the configured endpoint changes during token lookup', async () => {
    let calls = 0
    const resolveTarget = () => {
      calls += 1
      return {
        ok: true as const,
        endpoint: calls === 1 ? 'http://127.0.0.1:8791' : 'http://127.0.0.1:8792'
      }
    }
    const fetchImpl = vi.fn<typeof fetch>()
    const result = await client(fetchImpl, {
      resolveTarget,
      readAuthorityEpoch: () => 'epoch-1'
    }).consumeBinding(adamBindingGrant(), adamJobInput())
    expect(result).toEqual({ state: 'unavailable', reason: 'endpoint-changed' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not send a token when its synchronous authority epoch changes during token lookup', async () => {
    let currentEpoch = 'epoch-1'
    let finishToken!: (result: { token: string }) => void
    const resolveToken = () =>
      new Promise<{ token: string }>((resolve) => {
        finishToken = resolve
      })
    const fetchImpl = vi.fn<typeof fetch>()
    const pending = client(fetchImpl, {
      resolveToken,
      readAuthorityEpoch: () => currentEpoch
    }).consumeBinding(adamBindingGrant(), adamJobInput())
    await vi.waitFor(() => expect(finishToken).toBeTypeOf('function'))
    currentEpoch = 'epoch-2'
    finishToken({ token: 'rotated-synthetic-token' })
    expect(await pending).toEqual({ state: 'unavailable', reason: 'auth-unavailable' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not accept a response when its authority epoch changes while fetch is pending', async () => {
    let currentEpoch = 'epoch-1'
    let fetchStarted!: () => void
    let releaseFetch!: (response: Response) => void
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve
    })
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetch = resolve
          fetchStarted()
        })
    )
    const pending = client(fetchImpl, {
      readAuthorityEpoch: () => currentEpoch
    }).consumeBinding(adamBindingGrant(), adamJobInput())
    await started
    currentEpoch = 'epoch-2'
    releaseFetch(json(adamBindingResponse()))
    expect(await pending).toEqual({ state: 'unavailable', reason: 'auth-unavailable' })
  })

  it('refuses missing authority epochs before reading credentials or sending', async () => {
    const resolveToken = vi.fn(token)
    const fetchImpl = vi.fn<typeof fetch>()
    const result = await client(fetchImpl, {
      resolveToken,
      readAuthorityEpoch: () => null
    }).consumeBinding(adamBindingGrant(), adamJobInput())
    expect(result).toEqual({ state: 'unavailable', reason: 'auth-unavailable' })
    expect(resolveToken).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('retires a response if the endpoint changes while fetch is pending', async () => {
    let endpoint = 'http://127.0.0.1:8791'
    let fetchStarted!: () => void
    let releaseFetch!: (response: Response) => void
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve
    })
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetch = resolve
          fetchStarted()
        })
    )
    const pending = client(fetchImpl, {
      resolveTarget: () => ({ ok: true, endpoint }),
      readAuthorityEpoch: () => 'epoch-1'
    }).consumeBinding(adamBindingGrant(), adamJobInput())
    await started
    endpoint = 'http://127.0.0.1:8792'
    releaseFetch(json(adamBindingResponse()))
    expect(await pending).toEqual({ state: 'unavailable', reason: 'endpoint-changed' })
  })

  it('retires a response if endpoint or authority changes while its body is pending', async () => {
    const makePendingBody = () => {
      let controller!: ReadableStreamDefaultController<Uint8Array>
      let onRead!: () => void
      let releasePull!: () => void
      const readStarted = new Promise<void>((resolve) => {
        onRead = resolve
      })
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value
        },
        pull() {
          onRead()
          return new Promise<void>((resolve) => {
            releasePull = resolve
          })
        }
      })
      return {
        response: new Response(body, { status: 200 }),
        readStarted,
        release(value: unknown) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(value)))
          controller.close()
          releasePull()
        }
      }
    }

    for (const revoke of ['endpoint', 'epoch'] as const) {
      let endpoint = 'http://127.0.0.1:8791'
      let currentEpoch = 'epoch-1'
      const pendingBody = makePendingBody()
      const pending = client(
        vi.fn<typeof fetch>(async () => pendingBody.response),
        {
          resolveTarget: () => ({ ok: true, endpoint }),
          readAuthorityEpoch: () => currentEpoch
        }
      ).consumeBinding(adamBindingGrant(), adamJobInput())
      await pendingBody.readStarted
      if (revoke === 'endpoint') {
        endpoint = 'http://127.0.0.1:8792'
      } else {
        currentEpoch = 'epoch-2'
      }
      pendingBody.release(adamBindingResponse())
      expect(await pending).toEqual({
        state: 'unavailable',
        reason: revoke === 'endpoint' ? 'endpoint-changed' : 'auth-unavailable'
      })
    }
  })

  it('cancels a stalled response reader at the deadline without waiting for the read', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {})
      },
      cancel() {
        cancelled = true
        return new Promise<void>(() => {})
      }
    })
    const result = await client(
      vi.fn<typeof fetch>(async () => new Response(body)),
      {
        deadlineMs: 100
      }
    ).consumeBinding(adamBindingGrant(), adamJobInput())
    expect(result).toEqual({ state: 'unavailable', reason: 'timeout' })
    expect(cancelled).toBe(true)
  })

  it('rejects a server binding response that changes context or parent version', async () => {
    const changed = adamBindingResponse()
    const response = {
      ...changed,
      binding: {
        ...changed.binding,
        parentObjectiveVersion: changed.binding.parentObjectiveVersion + 1
      }
    }
    const result = await client(vi.fn<typeof fetch>(async () => json(response))).consumeBinding(
      adamBindingGrant(),
      adamJobInput()
    )
    expect(result).toEqual({ state: 'unavailable', reason: 'receipt-binding-mismatch' })
  })

  it('treats an unsupported endpoint and every redirect as unavailable', async () => {
    const notInstalled = await client(
      vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }))
    ).submitReceipt(adamBindingResponse(), adamReceipt())
    expect(notInstalled).toEqual({ state: 'unavailable', reason: 'unsupported' })

    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe('manual')
      return new Response(null, { status: 307, headers: { Location: 'https://other.invalid/' } })
    })
    expect(
      (await client(fetchImpl).submitReceipt(adamBindingResponse(), adamReceipt())).state
    ).toBe('unavailable')
  })

  it('caps response bytes before parsing and never returns remote body details', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('x'.repeat(1_100)))
    const result = await new CloudJobAdamClient({
      resolveTarget: target(),
      resolveToken: token,
      readAuthorityEpoch: () => 'synthetic-authority-1',
      fetch: fetchImpl,
      now: () => 6_000,
      maxResponseBytes: 1_024
    }).submitReceipt(adamBindingResponse(), adamReceipt())
    expect(result).toEqual({ state: 'unavailable', reason: 'response-too-large' })
    expect(JSON.stringify(result)).not.toContain('x'.repeat(100))
  })

  it('accepts only an ack for the same canonical receipt digest with parentStateChanged false', async () => {
    const receipt = adamReceipt()
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const sent = JSON.parse(String(init?.body)) as { payloadSha256: string; receipt: unknown }
      expect(sent.receipt).toEqual(CloudJobAdamReceipt.parse(receipt))
      expect(sent.payloadSha256).toBe(adamAck(receipt).payloadSha256)
      return json(adamAck(receipt))
    })
    expect((await client(fetchImpl).submitReceipt(adamBindingResponse(), receipt)).state).toBe(
      'accepted'
    )

    const changedAck = { ...adamAck(receipt), payloadSha256: 'e'.repeat(64) }
    const badDigest = await client(vi.fn<typeof fetch>(async () => json(changedAck))).submitReceipt(
      adamBindingResponse(),
      receipt
    )
    expect(badDigest).toEqual({ state: 'unavailable', reason: 'receipt-ack-mismatch' })

    const changedParent = { ...adamAck(receipt), parentStateChanged: true }
    const badParent = await client(
      vi.fn<typeof fetch>(async () => json(changedParent))
    ).submitReceipt(adamBindingResponse(), receipt)
    expect(badParent).toEqual({ state: 'unavailable', reason: 'receipt-ack-mismatch' })
  })

  it('rejects receipts linked to another parent and malformed strict payloads before fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const receipt = { ...adamReceipt(), parentObjectiveVersion: 8 }
    expect((await client(fetchImpl).submitReceipt(adamBindingResponse(), receipt)).state).toBe(
      'unavailable'
    )
    expect(
      (
        await client(fetchImpl).submitReceipt(adamBindingResponse(), {
          ...adamReceipt(),
          secret: 'no'
        })
      ).state
    ).toBe('unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps successful execution in child review and requires paired attempt identity', () => {
    expect(
      CloudJobAdamReceipt.safeParse({ ...adamReceipt(), cloudJobState: 'completed' }).success
    ).toBe(false)
    expect(CloudJobAdamReceipt.safeParse({ ...adamReceipt(), attemptId: null }).success).toBe(false)
  })

  it('bounds token lookup by the request deadline', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const pendingToken = new CloudJobAdamClient({
      resolveTarget: target(),
      resolveToken: () => new Promise(() => {}),
      readAuthorityEpoch: () => 'synthetic-authority-1',
      fetch: fetchImpl,
      now: () => 6_000,
      deadlineMs: 100
    })
    expect(await pendingToken.consumeBinding(adamBindingGrant(), adamJobInput())).toEqual({
      state: 'unavailable',
      reason: 'timeout'
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('caps unresolved post-deadline token work instead of accumulating unbounded requests', async () => {
    const pendingTokens: ((result: { token: string }) => void)[] = []
    const fetchImpl = vi.fn<typeof fetch>()
    const syntheticClient = client(fetchImpl, {
      resolveToken: () =>
        new Promise<{ token: string }>((resolve) => {
          pendingTokens.push(resolve)
        }),
      deadlineMs: 100
    })
    const requests = Array.from({ length: 8 }, () =>
      syntheticClient.consumeBinding(adamBindingGrant(), adamJobInput())
    )
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(8))
    expect(await syntheticClient.consumeBinding(adamBindingGrant(), adamJobInput())).toEqual({
      state: 'unavailable',
      reason: 'busy'
    })
    expect(await Promise.all(requests)).toEqual(
      Array.from({ length: 8 }, () => ({ state: 'unavailable', reason: 'timeout' }))
    )
    for (const resolve of pendingTokens) {
      resolve({ token: 'synthetic-token' })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
