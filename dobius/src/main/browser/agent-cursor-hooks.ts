import type { AgentCursorEvent } from '../../shared/agent-cursor'
import {
  agentPresenceRegistry,
  awaitAgentClearance,
  claimTile,
  markAgentDispatch,
  requestGateApproval
} from '../agents/agent-presence-registry'
import type { AgentCursorHooks } from './agent-cursor-driver'

/** Binds the browser bridge's cursor driver to the presence registry and the runtime notifier. */
export function createAgentCursorHooks(
  notify: (event: AgentCursorEvent) => void
): AgentCursorHooks {
  return {
    notify,
    awaitAgentClearance: (agentId, tileId, waitMs) => awaitAgentClearance(agentId, tileId, waitMs),
    claimTile: (agentId, tileId) => claimTile(agentId, tileId),
    requestGateApproval: (agentId, gate) => requestGateApproval(agentId, gate),
    markAgentDispatch: (tileId) => markAgentDispatch(tileId),
    clearanceNow: (agentId, tileId) => agentPresenceRegistry.clearance(agentId, tileId)
  }
}
