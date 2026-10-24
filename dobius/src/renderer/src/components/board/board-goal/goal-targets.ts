// Which consoles a goal card reaches, and which goals reach a console. Pure.
import type { BoardCardOf, BoardState } from '@/store/slices/board'
import { formatGoalBlock } from './goal-block'

type Board = Pick<BoardState, 'cards' | 'groups'>
export type GoalCard = BoardCardOf<'goal'>

/**
 * Consoles behind a goal's wiring, once each: wired consoles, members of wired
 * groups, and the consoles (or groups) a wired orchestrator commands.
 */
export function goalTargetConsoles(
  board: Board,
  wiredIds: readonly string[]
): BoardCardOf<'console'>[] {
  const wired = new Set(wiredIds)
  const viaOrchestrators = board.cards.flatMap((c) =>
    c.kind === 'orchestrator' && wired.has(c.id) ? c.wiredCardIds : []
  )
  const ids = new Set([...wiredIds, ...viaOrchestrators])
  const viaGroups = new Set(board.groups.filter((g) => ids.has(g.id)).flatMap((g) => g.cardIds))
  return board.cards.filter(
    (c): c is BoardCardOf<'console'> =>
      c.kind === 'console' && (ids.has(c.id) || viaGroups.has(c.id))
  )
}

export function goalCards(board: Board): GoalCard[] {
  return board.cards.filter((c): c is GoalCard => c.kind === 'goal')
}

/** Goal cards whose wiring reaches this console card. */
export function goalsForConsole(board: Board, consoleCardId: string): GoalCard[] {
  return goalCards(board).filter((g) =>
    goalTargetConsoles(board, g.wiredCardIds).some((c) => c.id === consoleCardId)
  )
}

function goalsForId(board: Board, id: string): GoalCard[] {
  const card = board.cards.find((c) => c.id === id)
  if (card?.kind === 'goal') {
    return [card]
  }
  if (card?.kind === 'orchestrator') {
    // Why: the orchestrator's prompt needs every goal it or any of its consoles carries.
    const consoleIds = new Set(goalTargetConsoles(board, card.wiredCardIds).map((c) => c.id))
    return goalCards(board).filter(
      (g) =>
        g.wiredCardIds.includes(card.id) ||
        goalTargetConsoles(board, g.wiredCardIds).some((c) => consoleIds.has(c.id))
    )
  }
  const consoleCard =
    card?.kind === 'console'
      ? card
      : board.cards.find((c) => c.kind === 'console' && c.tabId === id)
  return consoleCard ? goalsForConsole(board, consoleCard.id) : []
}

/**
 * The goal block for a goal card, an orchestrator card, a console card, or a
 * console's terminal tab id. Null when no goal with text reaches it.
 */
export function goalContextFor(board: Board, cardOrConsoleId: string): string | null {
  return formatGoalBlock(goalsForId(board, cardOrConsoleId))
}
