import { expect, it, vi } from 'vitest'
import { adamJobInput } from '../../../automations/cloud-jobs/cloud-job-adam-client.fixtures'
import { CloudJobService } from '../../../automations/cloud-job-service'
import { RpcDispatcher } from '../dispatcher'
import { ADAM_CLOUD_CHILD_METHODS } from './adam-cloud-child'
import {
  bindingResponse,
  fixture,
  grant,
  intentId,
  lookupMethod,
  lookupRequest,
  method,
  sealMethod,
  sealRequest,
  submitRequest
} from './adam-cloud-child-test-fixtures'

const rows = (store: ReturnType<typeof fixture>['store']) => ({
  projects: store.db.prepare('SELECT * FROM cloud_projects ORDER BY id').all(),
  jobs: store.db.prepare('SELECT * FROM cloud_jobs ORDER BY id').all(),
  bindings: store.db.prepare('SELECT * FROM cloud_job_adam_bindings ORDER BY job_id').all(),
  events: store.db.prepare('SELECT * FROM cloud_events ORDER BY sequence').all(),
  outbox: store.db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox ORDER BY receipt_id').all()
})

it('seals, submits, and recovers with distinct stable intent and binding UUIDs', async () => {
  const stableIntentId = '3f0165e3-8ba5-4872-95ac-a74bb42ac610'
  const bindingId = '9e945de5-689f-4a93-b6d4-e5ce8dff6bb3'
  const wrongIntentId = '21c76b93-bf79-4d33-adb4-9cd3a5e05a9e'
  const f = fixture({
    allowedMethods: ['adam.lookupApprovedIntent', sealMethod, 'adam.submitApprovedIntent'],
    requestIntentId: stableIntentId,
    bindingId,
    fileBacked: true,
    authorityAvailable: () => true
  })
  await f.enrollment

  const sealed = await method(sealMethod)(sealRequest(stableIntentId, bindingId), f.context)
  expect(sealed).toMatchObject({
    intentId: stableIntentId,
    identity: { bindingId }
  })
  expect(f.sealer.seal).toHaveBeenCalledWith(
    expect.objectContaining({
      intentId: stableIntentId,
      identity: expect.objectContaining({ bindingId })
    })
  )
  const submitted = await method('adam.submitApprovedIntent')(
    submitRequest(f.sealedEnvelope, stableIntentId, bindingId),
    f.context
  )
  const child = (submitted as { job: { id: string } }).job
  const before = rows(f.store)
  const consumeCalls = f.consumeBinding.mock.calls.length
  const unsealCalls = f.unsealer.unseal.mock.calls.length
  const submit = vi.spyOn(f.store, 'submitAdamBound')

  const recovered = await method(lookupMethod)(
    lookupRequest(f.sealedEnvelope, stableIntentId, bindingId),
    f.context
  )
  expect(recovered).toMatchObject({ intentId: stableIntentId, identity: { bindingId }, job: child })
  await expect(
    method(lookupMethod)(lookupRequest(f.sealedEnvelope, wrongIntentId, bindingId), f.context)
  ).rejects.toMatchObject({
    name: 'AdamCloudIntentBridgeError',
    message: 'ADAM cloud intent request was refused.'
  })
  expect(f.unsealer.unseal).toHaveBeenCalledTimes(unsealCalls + 1)
  expect(f.consumeBinding).toHaveBeenCalledTimes(consumeCalls)
  expect(submit).not.toHaveBeenCalled()
  expect(rows(f.store)).toEqual(before)
})

it('reads the exact existing child after grant expiry without consuming or writing', async () => {
  const f = fixture({ allowedMethods: [lookupMethod, sealMethod, 'adam.submitApprovedIntent'] })
  await f.enrollment
  const child = f.store.submitAdamBound(adamJobInput(), 'adam', bindingResponse())
  const before = rows(f.store)
  const consume = vi.spyOn(f, 'consumeBinding')
  const submit = vi.spyOn(f.store, 'submitAdamBound')
  const wallClock = vi.spyOn(Date, 'now').mockReturnValue(grant().expiresAtMs + 1)

  try {
    const response = await method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
    expect(response).toMatchObject({
      job: { id: child.id, createdBy: 'adam' }
    })
  } finally {
    wallClock.mockRestore()
  }

  expect(f.unsealer.unseal).toHaveBeenCalledOnce()
  expect(consume).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
  expect(rows(f.store)).toEqual(before)
})

it('returns null for absent child and rejects changed project/job identity without effects', async () => {
  const f = fixture({ allowedMethods: [lookupMethod] })
  await f.enrollment
  const before = rows(f.store)
  const absent = await method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  expect(absent).toMatchObject({ job: null })
  expect(rows(f.store)).toEqual(before)
  expect(f.consumeBinding).not.toHaveBeenCalled()

  await expect(
    method(lookupMethod)(
      {
        ...lookupRequest(f.sealedEnvelope),
        approvedJob: { ...lookupRequest(f.sealedEnvelope).approvedJob, projectId: 'other-project' }
      },
      f.context
    )
  ).rejects.toMatchObject({
    name: 'AdamCloudIntentBridgeError',
    message: 'ADAM cloud intent request was refused.'
  })
  expect(f.unsealer.unseal).toHaveBeenCalledOnce()
  expect(rows(f.store)).toEqual(before)
})

it('requires separately enrolled lookup scope and current service credential', async () => {
  const f = fixture()
  await f.enrollment
  await expect(
    method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  ).rejects.toMatchObject({ name: 'AdamCloudIntentBridgeError' })
  expect(f.unsealer.unseal).not.toHaveBeenCalled()

  const scoped = fixture({ allowedMethods: [lookupMethod] })
  await scoped.enrollment
  await scoped.registry.revoke('adam', 1, {})
  await expect(
    method(lookupMethod)(lookupRequest(scoped.sealedEnvelope), scoped.context)
  ).rejects.toMatchObject({ name: 'AdamCloudIntentBridgeError' })
  expect(scoped.unsealer.unseal).not.toHaveBeenCalled()
})

it('reauthorizes after awaited unseal and makes stale lookup inert', async () => {
  let finish!: (value: { intentId: string; grant: ReturnType<typeof grant> }) => void
  const f = fixture({ allowedMethods: [lookupMethod] })
  await f.enrollment
  f.unsealer.unseal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const before = rows(f.store)
  const pending = method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  await vi.waitFor(() => expect(f.unsealer.unseal).toHaveBeenCalledOnce())
  await f.registry.revoke('adam', 1, {})
  finish({ intentId, grant: grant() })
  await expect(pending).rejects.toMatchObject({ name: 'AdamCloudIntentBridgeError' })
  expect(rows(f.store)).toEqual(before)
  expect(f.consumeBinding).not.toHaveBeenCalled()
})

it('does not read or publish a result when bridge disposal wins an unseal race', async () => {
  let finish!: (value: { intentId: string; grant: ReturnType<typeof grant> }) => void
  const f = fixture({ allowedMethods: [lookupMethod] })
  await f.enrollment
  f.unsealer.unseal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  f.store.submitAdamBound(adamJobInput(), 'adam', bindingResponse())
  const before = rows(f.store)
  const pending = method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  await vi.waitFor(() => expect(f.unsealer.unseal).toHaveBeenCalledOnce())
  f.bridge.dispose()
  finish({ intentId, grant: grant() })

  await expect(pending).rejects.toMatchObject({
    name: 'AdamCloudIntentBridgeError',
    message: 'ADAM cloud intent request was refused.'
  })
  expect(rows(f.store)).toEqual(before)
})

it('refuses a real temporary-store replacement across awaited unseal', async () => {
  let finish!: (value: { intentId: string; grant: ReturnType<typeof grant> }) => void
  const f = fixture({ allowedMethods: [lookupMethod], fileBacked: true })
  await f.enrollment
  f.store.submitAdamBound(adamJobInput(), 'adam', bindingResponse())
  f.unsealer.unseal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const prepareLookup = vi.spyOn(f.service, 'prepareAdamBoundChildLookup')
  const submit = vi.spyOn(f.store, 'submitAdamBound')
  const pending = method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  await vi.waitFor(() => expect(f.unsealer.unseal).toHaveBeenCalledOnce())
  const replacement = f.replaceStore()
  const before = rows(replacement)
  finish({ intentId, grant: grant() })

  await expect(pending).rejects.toMatchObject({
    name: 'AdamCloudIntentBridgeError',
    message: 'ADAM cloud intent request was refused.'
  })
  expect(prepareLookup).toHaveBeenCalledOnce()
  expect(rows(replacement)).toEqual(before)
  expect(f.consumeBinding).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
})

it('refuses a real project-authority mutation across awaited unseal', async () => {
  let finish!: (value: { intentId: string; grant: ReturnType<typeof grant> }) => void
  const f = fixture({ allowedMethods: [lookupMethod], fileBacked: true })
  await f.enrollment
  f.store.submitAdamBound(adamJobInput(), 'adam', bindingResponse())
  f.unsealer.unseal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const prepareLookup = vi.spyOn(f.service, 'prepareAdamBoundChildLookup')
  const submit = vi.spyOn(f.store, 'submitAdamBound')
  const pending = method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  await vi.waitFor(() => expect(f.unsealer.unseal).toHaveBeenCalledOnce())
  f.store.registerProject({
    id: 'project-1',
    deviceId: 'worker-1',
    root: f.root,
    recipes: ['recipe-2'],
    capability: 'portable'
  })
  f.store.registerProject({
    id: 'project-1',
    deviceId: 'worker-1',
    root: f.root,
    recipes: ['recipe-1'],
    capability: 'portable'
  })
  const afterMutation = rows(f.store)
  finish({ intentId, grant: grant() })

  await expect(pending).rejects.toMatchObject({
    name: 'AdamCloudIntentBridgeError',
    message: 'ADAM cloud intent request was refused.'
  })
  expect(prepareLookup).toHaveBeenCalledOnce()
  expect(rows(f.store)).toEqual(afterMutation)
  expect(f.consumeBinding).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
})

it('refuses lookup when dynamic cloud authority is revoked during unseal', async () => {
  let authorityAvailable = true
  let finish!: (value: { intentId: string; grant: ReturnType<typeof grant> }) => void
  const f = fixture({
    allowedMethods: [lookupMethod],
    fileBacked: true,
    authorityAvailable: () => authorityAvailable
  })
  await f.enrollment
  f.store.submitAdamBound(adamJobInput(), 'adam', bindingResponse())
  const before = rows(f.store)
  f.unsealer.unseal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const submit = vi.spyOn(f.store, 'submitAdamBound')
  const pending = method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  await vi.waitFor(() => expect(f.unsealer.unseal).toHaveBeenCalledOnce())
  authorityAvailable = false
  finish({ intentId, grant: grant() })

  await expect(pending).rejects.toMatchObject({
    name: 'AdamCloudIntentBridgeError',
    message: 'ADAM cloud intent request was refused.'
  })
  expect(f.consumeBinding).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
  expect(rows(f.store)).toEqual(before)
})

it('redacts dynamic authority callback failures after awaited unseal', async () => {
  let authorityThrows = false
  let finish!: (value: { intentId: string; grant: ReturnType<typeof grant> }) => void
  const f = fixture({
    allowedMethods: [lookupMethod],
    fileBacked: true,
    authorityAvailable: () => {
      if (authorityThrows) {
        throw new Error('synthetic private policy detail')
      }
      return true
    }
  })
  await f.enrollment
  f.store.submitAdamBound(adamJobInput(), 'adam', bindingResponse())
  const before = rows(f.store)
  f.unsealer.unseal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const submit = vi.spyOn(f.store, 'submitAdamBound')
  const pending = method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  await vi.waitFor(() => expect(f.unsealer.unseal).toHaveBeenCalledOnce())
  authorityThrows = true
  finish({ intentId, grant: grant() })

  await expect(pending).rejects.toMatchObject({
    name: 'AdamCloudIntentBridgeError',
    message: 'ADAM cloud intent request was refused.'
  })
  expect(f.consumeBinding).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
  expect(rows(f.store)).toEqual(before)
})

it('refuses initially disabled authority before unsealing', async () => {
  let authorityAvailable = true
  const f = fixture({
    allowedMethods: [lookupMethod],
    fileBacked: true,
    authorityAvailable: () => authorityAvailable
  })
  await f.enrollment
  const before = rows(f.store)
  authorityAvailable = false

  await expect(
    method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  ).rejects.toMatchObject({
    name: 'AdamCloudIntentBridgeError',
    message: 'ADAM cloud intent request was refused.'
  })
  expect(f.unsealer.unseal).not.toHaveBeenCalled()
  expect(f.consumeBinding).not.toHaveBeenCalled()
  expect(rows(f.store)).toEqual(before)
})

it('rechecks dynamic authority immediately before returning a read child', async () => {
  let checks = 0
  const f = fixture({
    allowedMethods: [lookupMethod],
    fileBacked: true,
    authorityAvailable: () => ++checks < 5
  })
  await f.enrollment
  f.store.submitAdamBound(adamJobInput(), 'adam', bindingResponse())
  const before = rows(f.store)
  checks = 0

  await expect(
    method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  ).rejects.toMatchObject({
    name: 'AdamCloudIntentBridgeError',
    message: 'ADAM cloud intent request was refused.'
  })
  expect(checks).toBeGreaterThanOrEqual(5)
  expect(f.consumeBinding).not.toHaveBeenCalled()
  expect(rows(f.store)).toEqual(before)
})

it('refuses replacement of the cloud-job service while unseal is pending', async () => {
  let finish!: (value: { intentId: string; grant: ReturnType<typeof grant> }) => void
  const f = fixture({ allowedMethods: [lookupMethod], fileBacked: true })
  await f.enrollment
  f.store.submitAdamBound(adamJobInput(), 'adam', bindingResponse())
  const before = rows(f.store)
  const submit = vi.spyOn(f.store, 'submitAdamBound')
  f.unsealer.unseal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const pending = method(lookupMethod)(lookupRequest(f.sealedEnvelope), f.context)
  await vi.waitFor(() => expect(f.unsealer.unseal).toHaveBeenCalledOnce())
  const replacementService = new CloudJobService({
    openStore: () => f.store,
    canUseWorkspace: async () => false
  })
  f.setCloudJobs(replacementService)
  finish({ intentId, grant: grant() })

  await expect(pending).rejects.toMatchObject({
    name: 'AdamCloudIntentBridgeError',
    message: 'ADAM cloud intent request was refused.'
  })
  replacementService.close()
  expect(rows(f.store)).toEqual(before)
  expect(f.consumeBinding).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
})

it('takes lookup peer proof only from dispatcher transport context', async () => {
  const f = fixture({ allowedMethods: [lookupMethod] })
  await f.enrollment
  const child = f.store.submitAdamBound(adamJobInput(), 'adam', bindingResponse())
  const dispatcher = new RpcDispatcher({
    runtime: f.runtime,
    cloudJobs: f.service,
    adamCloudIntentBridge: f.bridge,
    methods: ADAM_CLOUD_CHILD_METHODS
  })
  const request = {
    id: 'lookup-1',
    authToken: 'shared-local-token',
    method: lookupMethod,
    params: { ...lookupRequest(f.sealedEnvelope), adamPeerEvidence: f.proofPeer }
  }
  const bodyClaim = await dispatcher.dispatch(request)
  expect(bodyClaim.ok).toBe(false)
  expect(f.unsealer.unseal).not.toHaveBeenCalled()

  const result = await dispatcher.dispatch(
    { ...request, params: lookupRequest(f.sealedEnvelope) },
    { adamPeerEvidence: f.proofPeer }
  )
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.result).toMatchObject({ job: { id: child.id } })
  }
})
