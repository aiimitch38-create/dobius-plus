import { z } from 'zod'
import {
  createSaveSubscription,
  deleteSaveSubscription,
  listSaveSubscriptions,
  mergeSaveSubscriptionKinds,
  removeSaveSubscriptionKind
} from '../../../communications/canvas/save-subscription-store'
import { defineMethod, type RpcMethod } from '../core'
import { requiredString, requiredNumber } from '../schemas'

// Why not wired into methods/index.ts here: same shared-aggregator reason
// as channel-templates.ts — see that file's top comment.

// Why identityPubkey/relayUrl are explicit request fields rather than
// inferred server-side: the caller's Nostr identity is an ephemeral
// browser-localStorage value the renderer generates
// (dobiusCommunications.ts's localIdentity()), never known to the main
// process on its own — the renderer case blocks this family reports read
// `localIdentity().pubkey` and DOBIUS_RELAY_WEBSOCKET_URL and pass them
// explicitly, the same way every relay-backed case already threads
// `channelId`/`pubkey` through its own args.
const IdentityScope = z.object({
  identityPubkey: requiredString('Missing identity pubkey'),
  relayUrl: requiredString('Missing relay URL')
})

const SubscriptionScope = z.object({
  scopeType: z.enum(['channel_h', 'owner_p', 'referenced_e'], { message: 'Invalid save subscription scope type' }),
  scopeValue: requiredString('Missing save subscription scope value')
})

const SaveSubscriptionCreate = IdentityScope.extend({
  scopeType: SubscriptionScope.shape.scopeType,
  scopeValue: SubscriptionScope.shape.scopeValue,
  kinds: z.array(z.number().int()).optional()
})

const SaveSubscriptionDelete = IdentityScope.extend({
  scopeType: SubscriptionScope.shape.scopeType,
  scopeValue: SubscriptionScope.shape.scopeValue
})

const SaveSubscriptionKindMutation = IdentityScope.extend({
  kind: requiredNumber('Missing save subscription kind')
})

export const SAVE_SUBSCRIPTION_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'saveSubscription.list',
    params: IdentityScope,
    handler: (params) => ({ subscriptions: listSaveSubscriptions(params.identityPubkey, params.relayUrl) })
  }),
  defineMethod({
    name: 'saveSubscription.create',
    params: SaveSubscriptionCreate,
    handler: (params) => ({
      subscription: createSaveSubscription(params.identityPubkey, params.relayUrl, params.scopeType, params.scopeValue, params.kinds ?? [])
    })
  }),
  defineMethod({
    name: 'saveSubscription.delete',
    params: SaveSubscriptionDelete,
    handler: (params) => ({
      removed: deleteSaveSubscription(params.identityPubkey, params.relayUrl, params.scopeType, params.scopeValue)
    })
  }),
  defineMethod({
    name: 'saveSubscription.mergeKind',
    params: SaveSubscriptionKindMutation,
    handler: (params) => ({
      subscription: mergeSaveSubscriptionKinds(params.identityPubkey, params.relayUrl, params.kind)
    })
  }),
  defineMethod({
    name: 'saveSubscription.removeKind',
    params: SaveSubscriptionKindMutation,
    handler: (params) => ({
      subscription: removeSaveSubscriptionKind(params.identityPubkey, params.relayUrl, params.kind)
    })
  })
]
