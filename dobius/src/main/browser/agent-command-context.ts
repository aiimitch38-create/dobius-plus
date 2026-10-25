import { AsyncLocalStorage } from 'node:async_hooks'
import { isAgentId } from '../../shared/agent-cursor'
import { isReservedAgentName, isValidAgentDisplayName } from '../../shared/agent-identity-names'

/**
 * Who is driving a browser command. Present when the CLI/RPC call carried
 * `--as <agentId>` (or DOBIUS_AGENT_ID); absent for legacy BrowserPane callers,
 * which keep behaving exactly as before. Web tiles always get an identity (see
 * SYNTHESIZED_TILE_AGENT) so they never take the invisible, ungated path.
 */
export type AgentCommandIdentity = {
  agentId: string
  name: string
  /** `--fast`: collapse cursor travel, keep dwell only before gated actions. */
  fast: boolean
}

/** Identity used when a web tile is driven without `--as`: visible and gated, but anonymous. */
export const SYNTHESIZED_TILE_AGENT: AgentCommandIdentity = Object.freeze({
  agentId: 'agent',
  name: 'Agent',
  fast: false
})

const storage = new AsyncLocalStorage<AgentCommandIdentity>()

export function agentDisplayName(agentId: string, name?: string): string {
  const trimmed = name?.trim()
  if (trimmed && isValidAgentDisplayName(trimmed)) {
    return trimmed
  }
  const derived = agentId.charAt(0).toUpperCase() + agentId.slice(1)
  // Why: an agent may not impersonate the human or the app even via its id.
  return isReservedAgentName(derived) ? `Agent ${agentId}` : derived
}

/** Reads the optional agent identity fields off validated RPC params. */
export function agentIdentityFromParams(params: unknown): AgentCommandIdentity | null {
  if (!params || typeof params !== 'object') {
    return null
  }
  const { agent, agentName, fast } = params as {
    agent?: unknown
    agentName?: unknown
    fast?: unknown
  }
  if (!isAgentId(agent)) {
    return null
  }
  return {
    agentId: agent,
    name: agentDisplayName(agent, typeof agentName === 'string' ? agentName : undefined),
    fast: fast === true
  }
}

export function runWithAgentIdentity<T>(
  identity: AgentCommandIdentity | null,
  fn: () => Promise<T> | T
): Promise<T> | T {
  if (!identity) {
    return fn()
  }
  return storage.run(identity, fn)
}

export function getAgentCommandIdentity(): AgentCommandIdentity | null {
  return storage.getStore() ?? null
}
