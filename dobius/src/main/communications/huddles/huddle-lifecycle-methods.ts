/**
 * RPC methods for huddle session lifecycle: start/join/leave/end, the
 * confirm-active handshake, agent membership, and state readback.
 *
 * `callerPubkey` on start/join is not part of the original Tauri command
 * signature — the Rust backend already knew the caller's identity locally.
 * Dobius's main process does not hold the human's Nostr identity (it lives
 * renderer-side, see PER_COMMAND in the build report), so the reported
 * dobiusCommunications.ts case blocks resolve `localIdentity().pubkey` and
 * pass it through explicitly.
 */
import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../../runtime/rpc/core'
import { OptionalString, requiredString } from '../../runtime/rpc/schemas'
import { getHuddleSessionStore } from './huddle-session-store'

const OptionalPubkeyArray = z.array(z.string()).optional()

const StartHuddleParams = z.object({
  parentChannelId: requiredString('Missing parent channel id'),
  memberPubkeys: OptionalPubkeyArray,
  channelName: OptionalString,
  callerPubkey: requiredString('Missing caller pubkey')
})

const JoinHuddleParams = z.object({
  parentChannelId: requiredString('Missing parent channel id'),
  ephemeralChannelId: requiredString('Missing ephemeral channel id'),
  callerPubkey: requiredString('Missing caller pubkey')
})

const AddAgentParams = z.object({
  pubkey: requiredString('Missing agent pubkey')
})

export const HUDDLE_LIFECYCLE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'huddle.start',
    params: StartHuddleParams,
    handler: (params) =>
      getHuddleSessionStore().start({
        parentChannelId: params.parentChannelId,
        memberPubkeys: params.memberPubkeys ?? [],
        callerPubkey: params.callerPubkey
      })
  }),
  defineMethod({
    name: 'huddle.join',
    params: JoinHuddleParams,
    handler: (params) =>
      getHuddleSessionStore().join({
        parentChannelId: params.parentChannelId,
        ephemeralChannelId: params.ephemeralChannelId,
        callerPubkey: params.callerPubkey
      })
  }),
  defineMethod({
    name: 'huddle.confirmActive',
    params: null,
    handler: () => getHuddleSessionStore().confirmActive()
  }),
  defineMethod({
    name: 'huddle.leave',
    params: null,
    handler: () => getHuddleSessionStore().leave()
  }),
  defineMethod({
    name: 'huddle.end',
    params: null,
    handler: () => getHuddleSessionStore().end()
  }),
  defineMethod({
    name: 'huddle.getState',
    params: null,
    handler: () => getHuddleSessionStore().getState()
  }),
  defineMethod({
    name: 'huddle.addAgent',
    params: AddAgentParams,
    handler: (params) => getHuddleSessionStore().addAgent({ pubkey: params.pubkey })
  }),
  defineMethod({
    name: 'huddle.getAgentPubkeys',
    params: null,
    handler: () => getHuddleSessionStore().getState().agent_pubkeys
  }),
  defineMethod({
    name: 'huddle.reconnectAudio',
    params: null,
    handler: () => getHuddleSessionStore().reconnectAudio()
  })
]
