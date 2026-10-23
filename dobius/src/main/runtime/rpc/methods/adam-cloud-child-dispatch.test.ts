import { expect, it } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import { ADAM_CLOUD_CHILD_METHODS } from './adam-cloud-child'
import { fixture, sealMethod, sealRequest } from './adam-cloud-child-test-fixtures'

it('takes ADAM peer proof only from dispatcher transport context, then seals through the enrolled registry', async () => {
  const f = fixture()
  await f.enrollment
  const dispatcher = new RpcDispatcher({
    runtime: f.runtime,
    cloudJobs: f.service,
    adamCloudIntentBridge: f.bridge,
    methods: ADAM_CLOUD_CHILD_METHODS
  })
  const params = { ...sealRequest(), adamPeerEvidence: f.proofPeer }
  const request = { id: 'seal-1', authToken: 'shared-local-token', method: sealMethod, params }

  const bodyClaim = await dispatcher.dispatch(request)
  expect(bodyClaim.ok).toBe(false)
  expect(f.sealer.seal).not.toHaveBeenCalled()

  const transportPeer = await dispatcher.dispatch(
    { ...request, params: sealRequest() },
    { adamPeerEvidence: f.proofPeer }
  )
  expect(transportPeer.ok).toBe(true)
  expect(f.sealer.seal).toHaveBeenCalledOnce()
  if (transportPeer.ok) {
    expect(transportPeer.result).toMatchObject({ sealedEnvelope: f.sealedEnvelope })
    expect(JSON.stringify(transportPeer.result)).not.toContain('synthetic-only-capability-value')
  }
})
