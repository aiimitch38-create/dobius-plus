import {
  sanitizeBoardsByWorktree,
  type BoardCard,
  type BoardGroup,
  type BoardState,
  type BoardSwatch,
  type NewBoardCard
} from '@/store/slices/board'

/**
 * A saved Board arrangement. Consoles are stored by agent kind only (tabId
 * empty): applying a preset spawns fresh agents, it never re-attaches to old
 * terminals. Everything else is copied as-is.
 */
export type BoardPreset = {
  id: string
  name: string
  createdAt: number
  cards: BoardCard[]
  groups: BoardGroup[]
}

export const MAX_PRESETS_PER_REPO = 30

export function capturePreset(
  board: BoardState,
  name: string,
  id: string,
  now: number
): BoardPreset {
  return {
    id,
    name: name.trim(),
    createdAt: now,
    cards: board.cards.map((c) => (c.kind === 'console' ? { ...c, tabId: '' } : c)),
    groups: board.groups.map((g) => ({ ...g, cardIds: [...g.cardIds] }))
  }
}

export type PresetApplyPlan = {
  /** Cards to add, with fresh ids; consoles still need a tabId from a spawn. */
  cards: (NewBoardCard & { id: string })[]
  groups: { name: string; color: BoardSwatch; cardIds: string[] }[]
}

/** Re-ids every card so a preset can be applied repeatedly, remapping groups and wiring. */
export function planPresetApply(preset: BoardPreset, newId: () => string): PresetApplyPlan {
  const ids = new Map(preset.cards.map((c) => [c.id, newId()]))
  const remap = (list: readonly string[]): string[] =>
    list.flatMap((old) => {
      const next = ids.get(old)
      return next ? [next] : []
    })
  const cards = preset.cards.map((card) => {
    const { z: _z, ...rest } = card
    const next = { ...rest, id: ids.get(card.id)! } as NewBoardCard & { id: string }
    return next.kind === 'orchestrator' ? { ...next, wiredCardIds: remap(next.wiredCardIds) } : next
  })
  return {
    cards,
    groups: preset.groups.map((g) => ({ name: g.name, color: g.color, cardIds: remap(g.cardIds) }))
  }
}

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Validates persisted presets through the Board sanitizer so a bad preset can't crash apply. */
export function sanitizePresetsByRepo(raw: unknown): Record<string, BoardPreset[]> {
  if (!isObj(raw)) {
    return {}
  }
  const out: Record<string, BoardPreset[]> = {}
  for (const [repoId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) {
      continue
    }
    const presets = list.flatMap((p): BoardPreset[] => {
      if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string') {
        return []
      }
      const board = sanitizeBoardsByWorktree({ x: { cards: p.cards, groups: p.groups } }).x
      return board
        ? [
            {
              id: p.id,
              name: p.name,
              createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
              cards: board.cards,
              groups: board.groups
            }
          ]
        : []
    })
    out[repoId] = presets.slice(0, MAX_PRESETS_PER_REPO)
  }
  return out
}
