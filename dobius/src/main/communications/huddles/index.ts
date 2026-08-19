/**
 * Single import point for every huddle RPC method, mirroring the pattern in
 * src/main/runtime/rpc/methods/index.ts (one array per domain, spread into
 * ALL_RPC_METHODS). Registration into ALL_RPC_METHODS itself happens in the
 * central pass — see the build report's "RUNTIME_REGISTRATION" note.
 */
import type { RpcMethod } from '../../runtime/rpc/core'
import { HUDDLE_LIFECYCLE_METHODS } from './huddle-lifecycle-methods'
import { HUDDLE_PREFERENCE_METHODS } from './huddle-preference-methods'

export const HUDDLE_METHODS: RpcMethod[] = [...HUDDLE_LIFECYCLE_METHODS, ...HUDDLE_PREFERENCE_METHODS]
