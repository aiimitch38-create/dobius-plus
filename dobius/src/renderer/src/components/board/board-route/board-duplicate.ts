import { useAppStore } from '@/store'
import { getBoard, type NewBoardCard } from '@/store/slices/board'

const DUPLICATE_OFFSET = 24

/**
 * Copies the given cards 24px down-right and returns the new ids. Console cards
 * are skipped: each points at one live terminal tab, and a copy would share it.
 */
export function duplicateBoardCards(worktreeId: string, cardIds: ReadonlySet<string>): string[] {
  const store = useAppStore.getState()
  return getBoard(store, worktreeId)
    .cards.filter((c) => cardIds.has(c.id) && c.kind !== 'console')
    .map((card) => {
      const { id: _id, z: _z, ...rest } = card
      return store.addCard(worktreeId, {
        ...rest,
        x: card.x + DUPLICATE_OFFSET,
        y: card.y + DUPLICATE_OFFSET
      } as NewBoardCard)
    })
}
