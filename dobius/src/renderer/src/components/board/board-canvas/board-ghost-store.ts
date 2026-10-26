// Placement ghosts: dashed outlines at the exact spot and size a card is about
// to land, shown before the card appears. Two sets live here: `preview` (the
// hovered rail item or the pointer under a placing tool) and `ghosts` (timed,
// pushed by spawn paths right before a card is added). Empty when idle.
import { create } from 'zustand'
import type { BoardCardKind } from '@/store/slices/board'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../../shared/types'
import { prefersReducedMotion } from './board-camera'

export type BoardGhostSpec = {
  x: number
  y: number
  w: number
  h: number
  kind: BoardCardKind
  /** Console ghosts show the agent's icon and name. */
  agent?: TuiAgent
  /** When set, that card stays hidden until the ghost expires, then fades in. */
  cardId?: string
}

export type BoardGhost = BoardGhostSpec & { id: string }

/** The ghost for a card about to be added: its rect, kind and (for consoles) agent. */
export function boardGhostOf(
  card: { x: number; y: number; w: number; h: number; kind: BoardCardKind; agentKind?: string },
  cardId?: string
): BoardGhostSpec {
  const { x, y, w, h, kind } = card
  const agent = card.agentKind && isTuiAgent(card.agentKind) ? card.agentKind : undefined
  return { x, y, w, h, kind, agent, cardId }
}

/** How long a spawn ghost holds the spot before the real card fades in over it. */
export const BOARD_GHOST_MS = 350

type BoardGhostStore = {
  preview: readonly BoardGhost[]
  ghosts: readonly BoardGhost[]
  setPreview: (preview: readonly BoardGhostSpec[]) => void
  push: (specs: readonly BoardGhostSpec[], ttlMs?: number) => void
  remove: (ids: readonly string[]) => void
}

let nextId = 0
const withId = (spec: BoardGhostSpec): BoardGhost => ({ ...spec, id: `ghost-${++nextId}` })

export const useBoardGhosts = create<BoardGhostStore>((set, get) => ({
  preview: [],
  ghosts: [],
  setPreview: (preview) => {
    if (preview.length === 0 && get().preview.length === 0) {
      return
    }
    set({ preview: preview.map(withId) })
  },
  push: (specs, ttlMs = BOARD_GHOST_MS) => {
    // Why: reduced motion means no staged reveal; the card simply appears.
    if (specs.length === 0 || prefersReducedMotion()) {
      return
    }
    const added = specs.map(withId)
    set((s) => ({ ghosts: [...s.ghosts, ...added] }))
    const ids = added.map((g) => g.id)
    setTimeout(() => get().remove(ids), ttlMs)
  },
  remove: (ids) => {
    const gone = new Set(ids)
    set((s) => ({ ghosts: s.ghosts.filter((g) => !gone.has(g.id)) }))
  }
}))

/** Shorthand for spawn paths: ghost these rects now, cards fade in after `BOARD_GHOST_MS`. */
export function pushBoardGhosts(specs: readonly BoardGhostSpec[]): void {
  useBoardGhosts.getState().push(specs)
}

export function setBoardGhostPreview(preview: readonly BoardGhostSpec[]): void {
  useBoardGhosts.getState().setPreview(preview)
}

/** True while a spawn ghost still holds this card's spot (the card renders invisible). */
export function useBoardGhostHidden(cardId: string | undefined): boolean {
  return useBoardGhosts((s) => cardId !== undefined && s.ghosts.some((g) => g.cardId === cardId))
}
