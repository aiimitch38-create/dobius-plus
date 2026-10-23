import { expect, it, vi } from 'vitest'
import { adamJobInput } from '../../../automations/cloud-jobs/cloud-job-adam-client.fixtures'
import { DobiusRuntimeRpcServer } from '../../runtime-rpc'
import { MOBILE_RPC_METHOD_CLASSES } from '../../mobile-rpc-method-classes'
import {
  audienceRuntimeId,
  bindingResponse,
  fixture,
  grant,
  intentId,
  intentIdentity,
  method,
  sealMethod,
  sealRequest,
  submitMethod,
  submitRequest
} from './adam-cloud-child-test-fixtures'

it('keeps both methods unavailable without trusted peer evidence, before crypto or store effects', async () => {
  const f = fixture({ trusted: false })
  const bodyClaim = { ...sealRequest(), peerEvidence: f.proofPeer }
  await expect(
    method(sealMethod)(bodyClaim, { ...f.context, adamPeerEvidence: undefined })
  ).rejects.toThrow('ADAM cloud intent request was refused.')
  await expect(
    method(submitMethod)(submitRequest(), { ...f.context, adamPeerEvidence: undefined })
  ).rejects.toThrow('ADAM cloud intent request was refused.')
  await expect(f.bridge.seal(sealRequest(), f.proofPeer)).rejects.toThrow(
    'ADAM cloud intent request was refused.'
  )
  expect(f.sealer.seal).not.toHaveBeenCalled()
  expect(f.unsealer.unseal).not.toHaveBeenCalled()
  expect(f.consumeBinding).not.toHaveBeenCalled()
  expect(f.store.list()).toHaveLength(0)
  expect(MOBILE_RPC_METHOD_CLASSES).not.toHaveProperty(sealMethod)
  expect(MOBILE_RPC_METHOD_CLASSES).not.toHaveProperty(submitMethod)
})

it('seals only after enrolled peer/scope verification and returns ciphertext with detached identity', async () => {
  const f = fixture()
  await f.enrollment
  const request = sealRequest()
  const response = await method(sealMethod)(request, f.context)
  expect(f.sealer.seal).toHaveBeenCalledWith(
    expect.objectContaining({ capability: grant().capability })
  )
  expect(response).toEqual({
    schemaVersion: 1,
    audienceRuntimeId,
    intentId,
    identity: intentIdentity(),
    sealedEnvelope: f.sealedEnvelope
  })
  expect(JSON.stringify(response)).not.toContain(grant().capability)
  expect(Object.isFrozen((response as { identity: object }).identity)).toBe(true)
})

it('revalidates revocation after awaited encryption and never returns stale ciphertext', async () => {
  let finish!: (value: string) => void
  const f = fixture()
  await f.enrollment
  f.sealer.seal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const pending = method(sealMethod)(sealRequest(), f.context)
  await vi.waitFor(() => expect(f.sealer.seal).toHaveBeenCalledOnce())
  await f.registry.revoke('adam', 1, {})
  finish(f.sealedEnvelope)
  await expect(pending).rejects.toThrow('ADAM cloud intent request was refused.')
})

it('detaches identity and capability before waiting on encryption', async () => {
  let finish!: (value: string) => void
  let received: unknown
  const f = fixture()
  await f.enrollment
  f.sealer.seal.mockImplementationOnce((envelope) => {
    received = envelope
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const request = sealRequest()
  const capability = request.envelope.capability
  const pending = method(sealMethod)(request, f.context)
  await vi.waitFor(() => expect(f.sealer.seal).toHaveBeenCalledOnce())
  request.envelope.capability = 'mutated-after-await-start'
  finish(f.sealedEnvelope)
  await pending
  expect(received).toMatchObject({ capability })
})

it('revalidates scope after decryption and refuses before binding consumption', async () => {
  let finish!: (value: { intentId: string; grant: ReturnType<typeof grant> }) => void
  const f = fixture()
  await f.enrollment
  f.unsealer.unseal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const pending = method(submitMethod)(submitRequest(), f.context)
  await vi.waitFor(() => expect(f.unsealer.unseal).toHaveBeenCalledOnce())
  await f.registry.revoke('adam', 1, {})
  finish({ intentId, grant: grant() })
  await expect(pending).rejects.toThrow('ADAM cloud intent request was refused.')
  expect(f.consumeBinding).not.toHaveBeenCalled()
  expect(f.store.list()).toHaveLength(0)
})

it('revalidates revoked proof after awaited consume and immediately before the child transaction', async () => {
  let finish!: (value: ReturnType<typeof bindingResponse>) => void
  const consume = () =>
    new Promise<ReturnType<typeof bindingResponse>>((resolve) => {
      finish = resolve
    })
  const f = fixture({
    consume: async () => ({ state: 'accepted' as const, value: await consume() })
  })
  await f.enrollment
  const pending = method(submitMethod)(submitRequest(), f.context)
  await vi.waitFor(() => expect(f.consumeBinding).toHaveBeenCalledOnce())
  await f.registry.revoke('adam', 1, {})
  finish(bindingResponse())
  await expect(pending).rejects.toThrow('ADAM cloud intent request was refused.')
  expect(f.store.list()).toHaveLength(0)
  expect(f.store.db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()).toHaveLength(0)
})

it('submits through the existing store only after sealed identity and payload fingerprint match', async () => {
  const f = fixture()
  await f.enrollment
  const response = await method(submitMethod)(submitRequest(f.sealedEnvelope), f.context)
  expect(response).toMatchObject({
    schemaVersion: 1,
    audienceRuntimeId,
    intentId,
    identity: intentIdentity(),
    job: { state: 'queued', createdBy: 'adam' }
  })
  expect(f.unsealer.unseal).toHaveBeenCalledWith({
    schemaVersion: 1,
    intentId,
    identity: intentIdentity(),
    sealedEnvelope: f.sealedEnvelope
  })
  expect(f.consumeBinding).toHaveBeenCalledOnce()
  expect(f.store.list()).toHaveLength(1)
  expect(f.store.db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()).toHaveLength(1)
  expect(JSON.stringify(response)).not.toContain(grant().capability)
  const duplicates = await Promise.all([
    method(submitMethod)(submitRequest(f.sealedEnvelope), f.context),
    method(submitMethod)(submitRequest(f.sealedEnvelope), f.context)
  ])
  expect(duplicates[0]).toEqual(response)
  expect(duplicates[1]).toEqual(response)
  expect(f.consumeBinding).toHaveBeenCalledTimes(3)
  expect(f.store.list()).toHaveLength(1)
  expect(f.store.db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()).toHaveLength(1)
})

it('rejects legacy plaintext submission and mismatched project/fingerprint without crypto', async () => {
  const f = fixture()
  await f.enrollment
  await expect(
    Promise.resolve().then(() =>
      method('adam.submitCloudChild')({ grant: grant(), input: adamJobInput() }, f.context)
    )
  ).rejects.toThrow('Legacy plaintext ADAM child submission is disabled.')
  await expect(
    method(submitMethod)(
      {
        ...submitRequest(),
        approvedJob: { ...adamJobInput(), projectId: 'other-project' }
      },
      f.context
    )
  ).rejects.toThrow('ADAM cloud intent request was refused.')
  expect(f.unsealer.unseal).not.toHaveBeenCalled()
  expect(f.consumeBinding).not.toHaveBeenCalled()
  expect(f.store.list()).toHaveLength(0)
})

it('returns fixed redacted errors for caller-controlled getter and proxy traps', async () => {
  const f = fixture()
  await f.enrollment
  const secret = grant().capability
  const getter = { ...sealRequest() }
  Object.defineProperty(getter, 'credential', {
    get: () => {
      throw new Error(secret)
    }
  })
  const proxy = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error(secret)
      },
      get: () => {
        throw new Error(secret)
      }
    }
  )
  for (const bad of [getter, proxy]) {
    await expect(method(sealMethod)(bad, f.context)).rejects.toMatchObject({
      name: 'AdamCloudIntentBridgeError',
      message: 'ADAM cloud intent request was refused.'
    })
  }
  expect(f.sealer.seal).not.toHaveBeenCalled()
  expect(f.unsealer.unseal).not.toHaveBeenCalled()
})

it('refuses copied, wrong-audience, wrong-project, and stale-generation credentials before crypto', async () => {
  const f = fixture()
  await f.enrollment
  for (const request of [
    { ...sealRequest(), audienceRuntimeId: 'b65e3d06-b001-45e1-821c-e20a88276f18' },
    {
      ...sealRequest(),
      envelope: {
        ...sealRequest().envelope,
        identity: { ...intentIdentity(), adamInstanceId: 'other-adam' }
      }
    },
    {
      ...sealRequest(),
      envelope: { ...sealRequest().envelope, identity: { ...intentIdentity(), projectId: 'other' } }
    },
    { ...sealRequest(), credential: Buffer.alloc(32, 8).toString('base64url') }
  ]) {
    await expect(method(sealMethod)(request, f.context)).rejects.toThrow(
      'ADAM cloud intent request was refused.'
    )
  }
  await f.registry.revoke('adam', 1, {})
  await expect(method(sealMethod)(sealRequest(), f.context)).rejects.toThrow(
    'ADAM cloud intent request was refused.'
  )
  expect(f.sealer.seal).not.toHaveBeenCalled()
})

it('refuses unregistered method/resource scopes before unsealing', async () => {
  const f = fixture({ allowedMethods: [sealMethod] })
  await f.enrollment
  await expect(method(submitMethod)(submitRequest(), f.context)).rejects.toThrow(
    'ADAM cloud intent request was refused.'
  )
  const changedResource = sealRequest()
  changedResource.envelope.intentId = '96d11ae7-c947-42af-a134-e73d01c86f0b'
  await expect(method(sealMethod)(changedResource, f.context)).rejects.toThrow(
    'ADAM cloud intent request was refused.'
  )
  expect(f.sealer.seal).not.toHaveBeenCalled()
  expect(f.unsealer.unseal).not.toHaveBeenCalled()
})

it('does not let request-body peer claims substitute for dispatcher-owned evidence', async () => {
  const f = fixture()
  await f.enrollment
  const server = new DobiusRuntimeRpcServer({
    runtime: f.runtime,
    cloudJobs: f.service,
    adamCloudIntentBridge: f.bridge,
    userDataPath: f.root
  })
  const response = await server['handleMessage'](
    JSON.stringify({
      id: 'request-1',
      method: sealMethod,
      authToken: server['authToken'],
      params: { ...sealRequest(), peerEvidence: f.proofPeer }
    })
  )
  expect(response).toMatchObject({ ok: false })
  expect(f.sealer.seal).not.toHaveBeenCalled()
})

it('disposal fences an in-flight bridge operation after crypto resolves', async () => {
  let finish!: (value: string) => void
  const f = fixture()
  await f.enrollment
  f.sealer.seal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const pending = method(sealMethod)(sealRequest(), f.context)
  await vi.waitFor(() => expect(f.sealer.seal).toHaveBeenCalledOnce())
  f.bridge.dispose()
  finish(f.sealedEnvelope)
  await expect(pending).rejects.toThrow('ADAM cloud intent request was refused.')
})
