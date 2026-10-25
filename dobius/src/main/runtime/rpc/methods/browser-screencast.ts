import { z } from 'zod'
import { defineMethod, defineStreamingMethod, type RpcAnyMethod } from '../core'
import { AgentIdentityParams } from '../schemas'
import { Screencast } from './browser-schemas'
import { withAgentIdentity } from './browser-agent-policy'

const ScreencastUnsubscribe = AgentIdentityParams.extend({
  subscriptionId: z.string().min(1, 'Missing required --subscription-id')
})

const BROWSER_SCREENCAST_METHOD_DEFINITIONS: RpcAnyMethod[] = [
  defineStreamingMethod({
    name: 'browser.screencast',
    params: Screencast,
    handler: async (params, { runtime, connectionId, sendBinary, signal }, emit) =>
      runtime.browserScreencast(params, { connectionId, sendBinary, signal, emit })
  }),
  defineMethod({
    name: 'browser.screencast.unsubscribe',
    params: ScreencastUnsubscribe,
    handler: async (params, { runtime }) => {
      runtime.cleanupSubscription(params.subscriptionId)
      return { unsubscribed: true }
    }
  })
]

export const BROWSER_SCREENCAST_METHODS: RpcAnyMethod[] =
  BROWSER_SCREENCAST_METHOD_DEFINITIONS.map(withAgentIdentity)
