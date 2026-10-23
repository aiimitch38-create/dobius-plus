import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'

/** Selected card ids that can form a group: two or more cards of any kind, else null. */
export function groupableCardIds(
  cards: readonly { id: string }[],
  selectedIds: ReadonlySet<string>
): string[] | null {
  const ids = cards.filter((c) => selectedIds.has(c.id)).map((c) => c.id)
  return ids.length >= 2 ? ids : null
}

/**
 * Groups `ids` on the board as "Group N" (the Group chip's rule: two or more
 * cards that exist). Reads the live board so just-spawned cards count.
 */
export function groupBoardCards(worktreeId: string, ids: ReadonlySet<string>): boolean {
  const state = useAppStore.getState()
  const board = getBoard(state, worktreeId)
  const cardIds = groupableCardIds(board.cards, ids)
  if (!cardIds) {
    return false
  }
  state.createGroup(worktreeId, {
    name: translate('board.group.name', 'Group {{n}}', { n: board.groups.length + 1 }),
    cardIds
  })
  return true
}
