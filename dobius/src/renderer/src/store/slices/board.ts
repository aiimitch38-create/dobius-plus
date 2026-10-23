import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import {
  EMPTY_BOARD,
  clampZoom,
  sanitizeBoardsByWorktree,
  type BoardCard,
  type BoardCardPatch,
  type BoardConnector,
  type BoardGroup,
  type BoardState,
  type BoardSwatch,
  type BoardTool,
  type BoardViewport,
  type NewBoardCard
} from './board-state'
import {
  PERSIST_DEBOUNCE_MS,
  VIEWPORT_PERSIST_SETTLE_MS,
  createBoardPersistence,
  mergeFirstHydration
} from './board-persistence'

export * from './board-state'
export { resetBoardPersistenceForTest } from './board-persistence'

export type BoardRect = { x: number; y: number; w: number; h: number }

export type BoardSlice = {
  boardsByWorktree: Record<string, BoardState>
  boardsHydrated: boolean
  hydrateBoards: (raw: unknown) => void
  /** Drops boards of removed worktrees so nothing (including main's group lookup) sees stale cards. */
  removeBoards: (worktreeIds: readonly string[]) => void
  addCard: (worktreeId: string, card: NewBoardCard) => string
  updateCard: (worktreeId: string, cardId: string, patch: BoardCardPatch) => void
  moveCards: (worktreeId: string, cardIds: readonly string[], dx: number, dy: number) => void
  resizeCard: (worktreeId: string, cardId: string, rect: BoardRect) => void
  removeCards: (worktreeId: string, cardIds: readonly string[]) => void
  /** Returns the new connector's id, or null when either card is missing or it would loop. */
  addConnector: (worktreeId: string, connector: Omit<BoardConnector, 'id'>) => string | null
  removeConnectors: (worktreeId: string, connectorIds: readonly string[]) => void
  bringToFront: (worktreeId: string, cardIds: readonly string[]) => void
  createGroup: (
    worktreeId: string,
    group: { name: string; color?: BoardSwatch; cardIds: readonly string[] }
  ) => string
  addToGroup: (worktreeId: string, groupId: string, cardIds: readonly string[]) => void
  dissolveGroup: (worktreeId: string, groupId: string) => void
  updateGroup: (
    worktreeId: string,
    groupId: string,
    patch: Partial<Pick<BoardGroup, 'name' | 'color'>>
  ) => void
  setViewport: (worktreeId: string, viewport: Partial<BoardViewport>) => void
  setTool: (worktreeId: string, tool: BoardTool) => void
}

export function getBoard(
  state: Pick<BoardSlice, 'boardsByWorktree'>,
  worktreeId: string | null
): BoardState {
  return (worktreeId && state.boardsByWorktree[worktreeId]) || EMPTY_BOARD
}

function topZ(cards: readonly BoardCard[]): number {
  return cards.reduce((max, c) => Math.max(max, c.z), 0)
}

// Why: a card lives in at most one group, so joining a group leaves the others;
// groups left empty are dropped instead of lingering as invisible frames.
function withoutCards(groups: readonly BoardGroup[], ids: ReadonlySet<string>): BoardGroup[] {
  return groups
    .map((g) =>
      g.cardIds.some((id) => ids.has(id))
        ? { ...g, cardIds: g.cardIds.filter((id) => !ids.has(id)) }
        : g
    )
    .filter((g) => g.cardIds.length > 0)
}

export const createBoardSlice: StateCreator<AppState, [], [], BoardSlice> = (set, get, api) => {
  const persistence = createBoardPersistence(get, api)
  const schedulePersist = persistence.schedule

  const updateBoard = (
    worktreeId: string,
    fn: (board: BoardState) => BoardState,
    delayMs = PERSIST_DEBOUNCE_MS
  ): void => {
    let changed = false
    set((s) => {
      const prev = getBoard(s, worktreeId)
      const next = fn(prev)
      if (next === prev) {
        return s
      }
      changed = true
      return { boardsByWorktree: { ...s.boardsByWorktree, [worktreeId]: next } }
    })
    if (changed) {
      schedulePersist(delayMs)
    }
  }

  const mapCards = (
    worktreeId: string,
    ids: readonly string[],
    fn: (card: BoardCard) => BoardCard
  ): void => {
    const idSet = new Set(ids)
    updateBoard(worktreeId, (b) =>
      b.cards.some((c) => idSet.has(c.id))
        ? { ...b, cards: b.cards.map((c) => (idSet.has(c.id) ? fn(c) : c)) }
        : b
    )
  }

  return {
    boardsByWorktree: {},
    boardsHydrated: false,

    // Why: main rebroadcasts every ui.set to all windows, so this also runs on
    // our own writes. Skip echoes and any reload that lands while a newer local
    // edit is still waiting to be written; that edit would otherwise snap back.
    hydrateBoards: (raw) => {
      const { boardsHydrated, boardsByWorktree } = get()
      if (boardsHydrated && persistence.isEcho(raw)) {
        return
      }
      const incoming = sanitizeBoardsByWorktree(raw)
      // Why: merge per worktree, so another window's edits land while ours to a
      // different worktree are still waiting to be written.
      for (const id of boardsHydrated ? persistence.dirtyIds() : []) {
        if (boardsByWorktree[id]) {
          incoming[id] = boardsByWorktree[id]
        } else {
          delete incoming[id]
        }
      }
      const merged = boardsHydrated ? incoming : mergeFirstHydration(boardsByWorktree, incoming)
      persistence.whileHydrating(() => set({ boardsByWorktree: merged, boardsHydrated: true }))
    },

    removeBoards: (worktreeIds) => {
      const ids = worktreeIds.filter((id) => id in get().boardsByWorktree)
      if (ids.length === 0) {
        return
      }
      set((s) => {
        const next = { ...s.boardsByWorktree }
        for (const id of ids) {
          delete next[id]
        }
        return { boardsByWorktree: next }
      })
      schedulePersist(PERSIST_DEBOUNCE_MS)
    },

    addCard: (worktreeId, card) => {
      const id = card.id ?? crypto.randomUUID()
      updateBoard(worktreeId, (b) => ({
        ...b,
        cards: [...b.cards, { ...card, id, z: topZ(b.cards) + 1 } as BoardCard]
      }))
      return id
    },

    updateCard: (worktreeId, cardId, patch) =>
      mapCards(worktreeId, [cardId], (c) => ({ ...c, ...patch }) as BoardCard),

    moveCards: (worktreeId, cardIds, dx, dy) => {
      if (dx === 0 && dy === 0) {
        return
      }
      mapCards(worktreeId, cardIds, (c) => ({ ...c, x: c.x + dx, y: c.y + dy }))
    },

    resizeCard: (worktreeId, cardId, rect) =>
      mapCards(worktreeId, [cardId], (c) => ({
        ...c,
        x: rect.x,
        y: rect.y,
        w: Math.max(1, rect.w),
        h: Math.max(1, rect.h)
      })),

    removeCards: (worktreeId, cardIds) => {
      const ids = new Set(cardIds)
      updateBoard(worktreeId, (b) =>
        b.cards.some((c) => ids.has(c.id))
          ? {
              ...b,
              cards: b.cards
                .filter((c) => !ids.has(c.id))
                .map((c) =>
                  c.kind === 'orchestrator' && c.wiredCardIds.some((id) => ids.has(id))
                    ? { ...c, wiredCardIds: c.wiredCardIds.filter((id) => !ids.has(id)) }
                    : c
                ),
              groups: withoutCards(b.groups, ids),
              connectors: b.connectors?.filter(
                (c) => !ids.has(c.fromCardId) && !ids.has(c.toCardId)
              )
            }
          : b
      )
    },

    addConnector: (worktreeId, connector) => {
      const board = getBoard(get(), worktreeId)
      const has = (id: string): boolean => board.cards.some((c) => c.id === id)
      if (
        connector.fromCardId === connector.toCardId ||
        !has(connector.fromCardId) ||
        !has(connector.toCardId)
      ) {
        return null
      }
      const id = crypto.randomUUID()
      updateBoard(worktreeId, (b) => ({
        ...b,
        connectors: [...(b.connectors ?? []), { ...connector, id }]
      }))
      return id
    },

    removeConnectors: (worktreeId, connectorIds) => {
      const ids = new Set(connectorIds)
      updateBoard(worktreeId, (b) =>
        b.connectors?.some((c) => ids.has(c.id))
          ? { ...b, connectors: b.connectors.filter((c) => !ids.has(c.id)) }
          : b
      )
    },

    bringToFront: (worktreeId, cardIds) => {
      const ids = new Set(cardIds)
      updateBoard(worktreeId, (b) => {
        let z = topZ(b.cards)
        // Why: keep the selection's relative stacking while lifting it above the rest.
        const lifted = new Map(
          b.cards
            .filter((c) => ids.has(c.id))
            .sort((a, c) => a.z - c.z)
            .map((c) => [c.id, ++z])
        )
        return lifted.size === 0
          ? b
          : {
              ...b,
              cards: b.cards.map((c) => (lifted.has(c.id) ? { ...c, z: lifted.get(c.id)! } : c))
            }
      })
    },

    createGroup: (worktreeId, group) => {
      const id = crypto.randomUUID()
      updateBoard(worktreeId, (b) => {
        const known = new Set(b.cards.map((c) => c.id))
        const members = group.cardIds.filter((cid) => known.has(cid))
        const ids = new Set(members)
        return {
          ...b,
          groups: [
            ...withoutCards(b.groups, ids),
            { id, name: group.name, color: group.color ?? 'accent', cardIds: members }
          ]
        }
      })
      return id
    },

    addToGroup: (worktreeId, groupId, cardIds) =>
      updateBoard(worktreeId, (b) => {
        const target = b.groups.find((g) => g.id === groupId)
        if (!target) {
          return b
        }
        const known = new Set(b.cards.map((c) => c.id))
        const ids = new Set(
          cardIds.filter((cid) => known.has(cid) && !target.cardIds.includes(cid))
        )
        if (ids.size === 0) {
          return b
        }
        const others = withoutCards(
          b.groups.filter((g) => g.id !== groupId),
          ids
        )
        return { ...b, groups: [...others, { ...target, cardIds: [...target.cardIds, ...ids] }] }
      }),

    dissolveGroup: (worktreeId, groupId) =>
      updateBoard(worktreeId, (b) =>
        b.groups.some((g) => g.id === groupId)
          ? { ...b, groups: b.groups.filter((g) => g.id !== groupId) }
          : b
      ),

    updateGroup: (worktreeId, groupId, patch) =>
      updateBoard(worktreeId, (b) =>
        b.groups.some((g) => g.id === groupId)
          ? { ...b, groups: b.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) }
          : b
      ),

    setViewport: (worktreeId, viewport) =>
      updateBoard(
        worktreeId,
        (b) => {
          const next = { ...b.viewport, ...viewport }
          next.zoom = clampZoom(next.zoom)
          // Why: a NaN pan from a bad pointer delta would blank the canvas for good.
          if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) {
            return b
          }
          return next.x === b.viewport.x && next.y === b.viewport.y && next.zoom === b.viewport.zoom
            ? b
            : { ...b, viewport: next }
        },
        VIEWPORT_PERSIST_SETTLE_MS
      ),

    setTool: (worktreeId, tool) =>
      updateBoard(worktreeId, (b) => (b.tool === tool ? b : { ...b, tool }))
  }
}
