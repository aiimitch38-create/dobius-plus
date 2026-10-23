import { expect, it } from 'vitest'
import {
  adamBindingIdentity,
  adamJobInput
} from '../automations/cloud-jobs/cloud-job-adam-client.fixtures'
import { createDefaultAdamCloudIntentBridge } from './create-default-adam-cloud-intent-bridge'

const runtimeId = '357e37d6-2be7-4c5f-9fc6-9573b3bb8c52'
const credential = Buffer.alloc(32, 3).toString('base64url')

it('keeps production default composition unavailable before lazy Electron crypto calls', async () => {
  const bridge = createDefaultAdamCloudIntentBridge({
    runtimeId: () => runtimeId,
    cloudJobs: () => undefined
  })
  const identity = adamBindingIdentity()
  const sealRequest = {
    schemaVersion: 1,
    audienceRuntimeId: runtimeId,
    credential,
    envelope: {
      schemaVersion: 1,
      intentId: identity.bindingId,
      identity,
      capability: adamBindingIdentity().bindingId.padEnd(40, 'x')
    }
  }
  const submitRequest = {
    schemaVersion: 1,
    audienceRuntimeId: runtimeId,
    credential,
    intentId: identity.bindingId,
    identity,
    sealedEnvelope: 'sealed:dobius-adam-intent:v1:YWJjZA==',
    approvedJob: adamJobInput()
  }
  const lookupRequest = { ...submitRequest }
  try {
    await expect(bridge.seal(sealRequest, Object.freeze({}))).rejects.toMatchObject({
      name: 'AdamCloudIntentBridgeError',
      message: 'ADAM cloud intent request was refused.'
    })
    await expect(bridge.submit(submitRequest, Object.freeze({}))).rejects.toMatchObject({
      name: 'AdamCloudIntentBridgeError',
      message: 'ADAM cloud intent request was refused.'
    })
    await expect(bridge.lookup(lookupRequest, Object.freeze({}))).rejects.toMatchObject({
      name: 'AdamCloudIntentBridgeError',
      message: 'ADAM cloud intent request was refused.'
    })
  } finally {
    bridge.dispose()
  }
})
