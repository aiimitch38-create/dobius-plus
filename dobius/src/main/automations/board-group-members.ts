// Reads Board groups straight from the persisted UI payload (boardsByWorktree,
// written by the renderer's board slice) so main never keeps a second copy.
import type { AutomationLoop, AutomationLoopTarget } from '../../shared/automations-types'

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)

export type BoardGroupMembers = {
  worktreeId: string
  groupId: string
  name: string
  tabIds: string[]
}

/** "@Team A", "team-a" and "Team  A" all address the same group. */
export function boardGroupSlug(name: string): string {
  return name
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
}

export function listBoardGroups(boardsByWorktree: unknown): BoardGroupMembers[] {
  if (!isObj(boardsByWorktree)) {
    return []
  }
  const out: BoardGroupMembers[] = []
  for (const [worktreeId, board] of Object.entries(boardsByWorktree)) {
    if (!isObj(board) || !Array.isArray(board.cards) || !Array.isArray(board.groups)) {
      continue
    }
    const tabByCard = new Map<string, string>()
    for (const card of board.cards) {
      if (
        isObj(card) &&
        card.kind === 'console' &&
        typeof card.id === 'string' &&
        typeof card.tabId === 'string'
      ) {
        tabByCard.set(card.id, card.tabId)
      }
    }
    for (const group of board.groups) {
      if (
        !isObj(group) ||
        typeof group.id !== 'string' ||
        typeof group.name !== 'string' ||
        !Array.isArray(group.cardIds)
      ) {
        continue
      }
      const tabIds = group.cardIds
        .map((id) => (typeof id === 'string' ? tabByCard.get(id) : undefined))
        .filter((id): id is string => id !== undefined)
      out.push({ worktreeId, groupId: group.id, name: group.name, tabIds })
    }
  }
  return out
}

export function boardGroupTabIdsById(
  boardsByWorktree: unknown,
  groupId: string,
  worktreeId: string
): string[] {
  return (
    listBoardGroups(boardsByWorktree).find(
      (g) => g.groupId === groupId && g.worktreeId === worktreeId
    )?.tabIds ?? []
  )
}

/** Null when this worktree's board has no group by that name, so other group kinds can still resolve. */
export function boardGroupTabIdsByName(
  boardsByWorktree: unknown,
  name: string,
  worktreeId: string
): string[] | null {
  const slug = boardGroupSlug(name)
  const matches = listBoardGroups(boardsByWorktree).filter(
    (g) => g.worktreeId === worktreeId && boardGroupSlug(g.name) === slug
  )
  return matches.length === 0 ? null : [...new Set(matches.flatMap((g) => g.tabIds))]
}

/** Every console tab on one worktree's board, read at fire time (so later consoles count). */
export function boardConsoleTabIds(boardsByWorktree: unknown, worktreeId: string): string[] {
  const board = isObj(boardsByWorktree) ? boardsByWorktree[worktreeId] : undefined
  if (!isObj(board) || !Array.isArray(board.cards)) {
    return []
  }
  return board.cards.flatMap((card) =>
    isObj(card) && card.kind === 'console' && typeof card.tabId === 'string' ? [card.tabId] : []
  )
}

/** Console tabs a Board loop target addresses right now. */
export function loopTargetTabIdsFromBoards(
  boardsByWorktree: unknown,
  target: AutomationLoopTarget,
  worktreeId: string
): string[] {
  switch (target.type) {
    case 'tab':
      return [target.tabId]
    case 'group':
      return boardGroupTabIdsById(boardsByWorktree, target.groupId, worktreeId)
    case 'board':
      return boardConsoleTabIds(boardsByWorktree, worktreeId)
    case 'orchestrator':
      return orchestratorWiredTabIds(boardsByWorktree, target.cardId, worktreeId)
  }
}

/** Console tabs wired to one orchestrator card on that worktree's board. */
export function orchestratorWiredTabIds(
  boardsByWorktree: unknown,
  orchestratorCardId: string,
  worktreeId: string
): string[] {
  const board = isObj(boardsByWorktree) ? boardsByWorktree[worktreeId] : undefined
  if (!isObj(board) || !Array.isArray(board.cards)) {
    return []
  }
  const orchestrator = board.cards.find(
    (c) => isObj(c) && c.kind === 'orchestrator' && c.id === orchestratorCardId
  )
  const wired = new Set(
    isObj(orchestrator) && Array.isArray(orchestrator.wiredCardIds) ? orchestrator.wiredCardIds : []
  )
  return board.cards.flatMap((c) =>
    isObj(c) && c.kind === 'console' && wired.has(c.id) && typeof c.tabId === 'string'
      ? [c.tabId]
      : []
  )
}

/** Every console tab a loop addresses: the watched tab for output match, else its target. */
export function loopTabIdsFromBoards(boardsByWorktree: unknown, loop: AutomationLoop): string[] {
  return loop.trigger.kind === 'on-output-match'
    ? [loop.trigger.tabId]
    : loopTargetTabIdsFromBoards(boardsByWorktree, loop.trigger.target, loop.worktreeId)
}
