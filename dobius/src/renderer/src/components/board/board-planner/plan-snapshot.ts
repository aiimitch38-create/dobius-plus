import type { BoardState } from '@/store/slices/board'
import { presetCatalog } from '../board-presets/preset-catalog'
import type { PlanBoardSnapshot } from './plan-schema'

/** The planner's view of the board, built from live state. */
export function buildPlanSnapshot(input: {
  board: BoardState
  workspaces: readonly { id: string; name: string }[]
  worktreeId: string
  stateOf: (tabId: string) => string
  markdownFiles?: readonly string[]
  loops?: readonly string[]
}): PlanBoardSnapshot {
  const titleById = new Map(input.board.cards.map((c) => [c.id, c.title]))
  const groupOf = new Map(
    input.board.groups.flatMap((g) => g.cardIds.map((id) => [id, g.name] as const))
  )
  return {
    workspace: input.workspaces.find((w) => w.id === input.worktreeId)?.name ?? input.worktreeId,
    workspaces: input.workspaces.map((w) => ({ name: w.name, current: w.id === input.worktreeId })),
    consoles: input.board.cards.flatMap((c) =>
      c.kind === 'console'
        ? [
            {
              name: c.title,
              agent: c.agentKind,
              role: c.role ?? null,
              status: input.stateOf(c.tabId),
              group: groupOf.get(c.id) ?? null
            }
          ]
        : []
    ),
    groups: input.board.groups.map((g) => ({
      name: g.name,
      members: g.cardIds.flatMap((id) => titleById.get(id) ?? [])
    })),
    orchestrators: input.board.cards.flatMap((c) =>
      c.kind === 'orchestrator'
        ? [{ name: c.name, wired: c.wiredCardIds.flatMap((id) => titleById.get(id) ?? []) }]
        : []
    ),
    presets: presetCatalog().map((p) => p.name),
    markdownFiles: [...(input.markdownFiles ?? [])],
    loops: [...(input.loops ?? [])]
  }
}
