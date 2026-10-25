// Co-presence controls over RPC (CLI `dobius board agent-control`). Agents may
// only pause or stop themselves here; resume / takeOver / approve / deny are
// human-only and reach the registry through the Board's `agents:control` IPC.
// Yields (human input on a tile) have no RPC twin: only the Board window's
// `agents:yield` IPC may claim the human is working in a tile.
import { z } from 'zod'
import {
  AgentControlParams,
  RpcAgentControlParams,
  agentPresenceRegistry,
  type AgentPresenceRegistry
} from '../../../agents/agent-presence-registry'
import { defineMethod, type RpcMethod } from '../core'

const AgentStateParams = z.object({ agentId: AgentControlParams.shape.agentId }).strict()

export function buildAgentControlMethods(registry: AgentPresenceRegistry): RpcMethod[] {
  return [
    defineMethod({
      name: 'board.agentControl',
      params: RpcAgentControlParams,
      handler: (params) => registry.control(params, 'rpc')
    }),
    defineMethod({
      name: 'board.agentState',
      params: AgentStateParams,
      handler: (params) => ({ agentId: params.agentId, state: registry.getState(params.agentId) })
    })
  ]
}

export const AGENT_CONTROL_METHODS: RpcMethod[] = buildAgentControlMethods(agentPresenceRegistry)
