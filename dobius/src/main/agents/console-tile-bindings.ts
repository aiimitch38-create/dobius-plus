// Which Board web tile each connected console drives. A console's agent id
// (`console-<short card id>`) may act ONLY in the tile it is linked to; with no
// link it may drive nothing. The Board window syncs the full set over IPC
// (`agents:syncConsoleTiles`, sender-guarded) on every link change, card
// removal or restore, so main never trusts a tile id the agent passes itself.
import { z } from 'zod'
import { AgentIdSchema } from '../../shared/agent-cursor'

export const CONSOLE_DRIVER_AGENT_PREFIX = 'console-'

export const ConsoleTileBindingsParams = z
  .object({
    bindings: z
      .array(z.object({ agentId: AgentIdSchema, tileId: z.string().min(1).max(200) }).strict())
      .max(500)
  })
  .strict()
export type ConsoleTileBinding = z.infer<typeof ConsoleTileBindingsParams>['bindings'][number]

export function isConsoleDriverAgentId(agentId: string): boolean {
  return agentId.startsWith(CONSOLE_DRIVER_AGENT_PREFIX)
}

export class ConsoleTileBindings {
  private tilesByAgent = new Map<string, Set<string>>()

  parse(input: unknown): ConsoleTileBinding[] {
    return ConsoleTileBindingsParams.parse(input).bindings
  }

  /** Replaces the whole set (the Board is the source of truth). Non-console ids are ignored. */
  replaceAll(bindings: readonly ConsoleTileBinding[]): void {
    const next = new Map<string, Set<string>>()
    for (const { agentId, tileId } of bindings) {
      if (!isConsoleDriverAgentId(agentId)) {
        continue
      }
      const tiles = next.get(agentId) ?? new Set<string>()
      tiles.add(tileId)
      next.set(agentId, tiles)
    }
    this.tilesByAgent = next
  }

  /** The tile's guest is gone (card removed, Board closed, session switched): nobody may drive it. */
  dropTile(tileId: string): void {
    for (const [agentId, tiles] of this.tilesByAgent) {
      tiles.delete(tileId)
      if (tiles.size === 0) {
        this.tilesByAgent.delete(agentId)
      }
    }
  }

  tilesFor(agentId: string): readonly string[] {
    return [...(this.tilesByAgent.get(agentId) ?? [])]
  }

  /**
   * null when `agentId` may drive `tileId`; otherwise the refusal reason. Only
   * console driver ids are bound; any other identity is not this class's concern.
   */
  refusal(agentId: string, tileId: string): string | null {
    if (!isConsoleDriverAgentId(agentId)) {
      return null
    }
    const tiles = this.tilesByAgent.get(agentId)
    if (!tiles || tiles.size === 0) {
      return `${agentId} is not connected to a web tile. Connect this console to a tile on the Board (tile header → Connect terminal) and retry.`
    }
    if (!tiles.has(tileId)) {
      const own = [...tiles].map((id) => `web-tile:${id}`).join(', ')
      return `${agentId} may only drive its connected tile (${own}), not web-tile:${tileId}.`
    }
    return null
  }

  resetForTest(): void {
    this.tilesByAgent = new Map()
  }
}

export const consoleTileBindings = new ConsoleTileBindings()
