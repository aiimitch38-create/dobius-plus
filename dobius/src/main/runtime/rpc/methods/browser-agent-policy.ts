// RPC-side agent identity wrapper for the browser method lists. The policy
// itself lives in main/browser (the bridge is the enforcement point for both
// explicit and synthesized identities); this layer refuses early and runs the
// handler inside the identity's async context.
import {
  agentIdentityFromParams,
  runWithAgentIdentity
} from '../../../browser/agent-command-context'
import { assertAgentMayUseMethod } from '../../../browser/agent-browser-method-policy'
import type { RpcAnyMethod, RpcMethod } from '../core'

export {
  AGENT_BROWSER_METHOD_POLICY,
  assertAgentMayUseMethod,
  type AgentBrowserMethodPolicy
} from '../../../browser/agent-browser-method-policy'

export function withAgentIdentity<M extends RpcAnyMethod>(method: M): M {
  const guarded = (params: unknown): ReturnType<typeof agentIdentityFromParams> => {
    const identity = agentIdentityFromParams(params)
    if (identity) {
      assertAgentMayUseMethod(identity.name, method.name)
    }
    return identity
  }
  if ('stream' in method && method.stream === true) {
    return {
      ...method,
      handler: (params, ctx, emit) =>
        runWithAgentIdentity(guarded(params), () => method.handler(params, ctx, emit))
    } as M
  }
  const plain = method as RpcMethod
  return {
    ...plain,
    handler: (params, ctx) => runWithAgentIdentity(guarded(params), () => plain.handler(params, ctx))
  } as M
}
