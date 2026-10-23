import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'

function bridge(context: Parameters<RpcMethod['handler']>[1]) {
  if (!context.adamCloudIntentBridge || !context.adamPeerEvidence) {
    throw new Error('ADAM cloud intent request was refused.')
  }
  return context.adamCloudIntentBridge
}

export const ADAM_CLOUD_CHILD_METHODS: readonly RpcMethod[] = [
  defineMethod({
    name: 'adam.sealApprovedIntent',
    params: z.unknown(),
    handler: async (params, context) => bridge(context).seal(params, context.adamPeerEvidence)
  }),
  defineMethod({
    name: 'adam.submitApprovedIntent',
    params: z.unknown(),
    handler: async (params, context) => bridge(context).submit(params, context.adamPeerEvidence)
  }),
  defineMethod({
    name: 'adam.lookupApprovedIntent',
    params: z.unknown(),
    handler: async (params, context) => bridge(context).lookup(params, context.adamPeerEvidence)
  }),
  defineMethod({
    name: 'adam.submitCloudChild',
    params: null,
    handler: () => {
      throw new Error('Legacy plaintext ADAM child submission is disabled.')
    }
  })
]
