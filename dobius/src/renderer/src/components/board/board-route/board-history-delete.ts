import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  getBoard,
  type BoardCard,
  type BoardConnector,
  type BoardGroup,
  type NewBoardCard
} from '@/store/slices/board'
import type { BoardContent } from './board-history'

/** What a deletion took off the board, enough to put it back. */
export type BoardRemoval = {
  cards: BoardCard[]
  groups: BoardGroup[]
  connectors: BoardConnector[]
  /** Orchestrator or goal card id -> the wired ids the deletion unwired. */
  wiring: Record<string, string[]>
}

export function boardRemovalOf(before: BoardContent, cardIds: readonly string[]): BoardRemoval {
  const ids = new Set(cardIds)
  const wiring: Record<string, string[]> = {}
  for (const card of before.cards) {
    if ((card.kind === 'orchestrator' || card.kind === 'goal') && !ids.has(card.id)) {
      const lost = card.wiredCardIds.filter((id) => ids.has(id))
      if (lost.length > 0) {
        wiring[card.id] = lost
      }
    }
  }
  return {
    cards: before.cards.filter((c) => ids.has(c.id)),
    groups: before.groups.filter((g) => g.cardIds.some((id) => ids.has(id))),
    connectors: (before.connectors ?? []).filter(
      (c) => ids.has(c.fromCardId) || ids.has(c.toCardId)
    ),
    wiring
  }
}

/**
 * Puts a removal back through the store's own actions (so it persists), leaving
 * every edit made since the delete alone. Cards already back are skipped.
 */
export function restoreBoardRemoval(worktreeId: string, removal: BoardRemoval): void {
  const state = useAppStore.getState()
  const present = new Set(getBoard(state, worktreeId).cards.map((c) => c.id))
  const restored = removal.cards.filter((c) => !present.has(c.id))
  if (restored.length === 0) {
    return
  }
  for (const card of restored) {
    const { z: _z, ...rest } = card
    state.addCard(worktreeId, rest as NewBoardCard)
  }
  const back = new Set(restored.map((c) => c.id))
  for (const group of removal.groups) {
    const members = group.cardIds.filter((id) => back.has(id))
    const live = getBoard(useAppStore.getState(), worktreeId).groups.find((g) => g.id === group.id)
    if (live) {
      state.addToGroup(worktreeId, group.id, members)
    } else {
      state.createGroup(worktreeId, {
        name: group.name,
        color: group.color,
        cardIds: group.cardIds
      })
    }
  }
  for (const { id: _id, ...connector } of removal.connectors) {
    state.addConnector(worktreeId, connector)
  }
  for (const [orchestratorId, lost] of Object.entries(removal.wiring)) {
    const card = getBoard(useAppStore.getState(), worktreeId).cards.find(
      (c) => c.id === orchestratorId
    )
    if (card?.kind === 'orchestrator' || card?.kind === 'goal') {
      const wired = [...card.wiredCardIds, ...lost.filter((id) => back.has(id))]
      state.updateCard(worktreeId, orchestratorId, { wiredCardIds: [...new Set(wired)] })
    }
  }
}

export function deletedToastMessage(cards: readonly Pick<BoardCard, 'title' | 'kind'>[]): string {
  if (cards.length === 1) {
    return translate('board.card.deleted', 'Deleted {{name}}', {
      name: cards[0].title || cards[0].kind
    })
  }
  return translate('board.card.deletedMany', 'Deleted {{count}} cards', { count: cards.length })
}

/**
 * Every Board delete goes through here: removes the cards and shows an
 * "Undo" toast that puts exactly those cards back.
 */
export function removeCardsWithUndo(worktreeId: string, cardIds: readonly string[]): void {
  const state = useAppStore.getState()
  const removal = boardRemovalOf(getBoard(state, worktreeId), cardIds)
  if (removal.cards.length === 0) {
    return
  }
  state.removeCards(worktreeId, cardIds)
  toast(deletedToastMessage(removal.cards), {
    action: {
      label: translate('board.card.undo', 'Undo'),
      onClick: () => restoreBoardRemoval(worktreeId, removal)
    }
  })
}
