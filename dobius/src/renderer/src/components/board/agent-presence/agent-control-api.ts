// Calls into the preload's agent co-presence controls, with the optimistic
// local state change applied first so the strip and chip respond at once.
import type { AgentControlAction } from '../../../../../shared/agent-cursor'
import { markAgentControl } from './agent-presence-state'

export type AgentControlArgs = {
  agentId: string
  action: AgentControlAction
  requestId?: string
}

export type AgentYieldResult = { tileId: string; until: number }

export async function agentControl(args: AgentControlArgs): Promise<void> {
  markAgentControl(args.agentId, args.action)
  try {
    await window.api?.agents?.control?.(args)
  } catch (error) {
    console.warn('[agent-presence] agents.control failed', error)
  }
}

/** Tells main the human acted in the tile; main holds its agents until `until`. */
export async function agentYield(cardId: string): Promise<AgentYieldResult | null> {
  try {
    return (await window.api?.agents?.yield?.({ cardId })) ?? null
  } catch (error) {
    console.warn('[agent-presence] agents.yield failed', error)
    return null
  }
}
