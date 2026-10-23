import type { StoreApi } from 'zustand'
import type { AppState } from '../types'
import { isPersistableImageSrc, type BoardState } from './board-state'

export const PERSIST_DEBOUNCE_MS = 300
// Why: pan/zoom changes only the camera; wait until the gesture has clearly
// settled before rewriting the whole boards map.
export const VIEWPORT_PERSIST_SETTLE_MS = 1_000

let persistTimer: ReturnType<typeof setTimeout> | null = null
let persistDueAt = 0
let lastPersistedJson: string | null = null
// Worktrees changed locally since the last write; a broadcast never overwrites these.
const dirtyWorktrees = new Set<string>()

export function resetBoardPersistenceForTest(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
  }
  persistTimer = null
  persistDueAt = 0
  lastPersistedJson = null
  dirtyWorktrees.clear()
}

function toPersistedBoards(boards: Record<string, BoardState>): Record<string, BoardState> {
  let dropped = 0
  const out: Record<string, BoardState> = {}
  for (const [id, board] of Object.entries(boards)) {
    const cards = board.cards.filter((c) => c.kind !== 'image' || isPersistableImageSrc(c.src))
    dropped += board.cards.length - cards.length
    out[id] = cards.length === board.cards.length ? board : { ...board, cards }
  }
  if (dropped > 0) {
    console.warn(
      `[board] ${dropped} embedded image card(s) are too large to save; store images as files.`
    )
  }
  return out
}

export function createBoardPersistence(
  get: () => AppState,
  api: Pick<StoreApi<AppState>, 'subscribe'>
): {
  schedule: (delayMs: number) => void
  isEcho: (raw: unknown) => boolean
  dirtyIds: () => ReadonlySet<string>
  whileHydrating: (fn: () => void) => void
} {
  let hydrating = false

  // Why: one debounced write per burst; writes wait for hydration so an empty
  // boot state never overwrites the saved boards.
  const schedule = (delayMs: number): void => {
    // Never pull a pending write earlier, so a camera move can't flush mid-gesture.
    const dueAt = Math.max(Date.now() + delayMs, persistTimer ? persistDueAt : 0)
    if (persistTimer) {
      clearTimeout(persistTimer)
    }
    persistDueAt = dueAt
    persistTimer = setTimeout(
      () => {
        persistTimer = null
        const { boardsHydrated, boardsByWorktree } = get()
        if (!boardsHydrated) {
          return
        }
        const payload = toPersistedBoards(boardsByWorktree)
        dirtyWorktrees.clear()
        lastPersistedJson = JSON.stringify(payload)
        window.api.ui.set({ boardsByWorktree: payload }).catch(console.error)
      },
      Math.max(0, dueAt - Date.now())
    )
  }

  // Why: every change to the map (board actions, but also worktree removal and
  // rename in the worktrees slice) marks its worktrees dirty and reaches disk.
  api.subscribe((state, prev) => {
    if (hydrating || !state.boardsHydrated || state.boardsByWorktree === prev.boardsByWorktree) {
      return
    }
    const next = state.boardsByWorktree ?? {}
    const before = prev.boardsByWorktree ?? {}
    for (const id of new Set([...Object.keys(next), ...Object.keys(before)])) {
      if (next[id] !== before[id]) {
        dirtyWorktrees.add(id)
      }
    }
    schedule(PERSIST_DEBOUNCE_MS)
  })

  return {
    schedule,
    isEcho: (raw) => JSON.stringify(raw ?? {}) === lastPersistedJson,
    dirtyIds: () => dirtyWorktrees,
    whileHydrating: (fn) => {
      hydrating = true
      try {
        fn()
      } finally {
        hydrating = false
      }
    }
  }
}

/**
 * The first load can land after the user (or the planner) already spawned
 * consoles. Saved boards stay authoritative, but cards and groups created
 * before hydration are kept instead of silently vanishing.
 */
export function mergeFirstHydration(
  local: Record<string, BoardState>,
  incoming: Record<string, BoardState>
): Record<string, BoardState> {
  const out = { ...incoming }
  for (const [id, board] of Object.entries(local)) {
    const saved = out[id]
    if (!saved) {
      out[id] = board
      continue
    }
    const savedCards = new Set(saved.cards.map((c) => c.id))
    const savedGroups = new Set(saved.groups.map((g) => g.id))
    out[id] = {
      ...saved,
      cards: [...saved.cards, ...board.cards.filter((c) => !savedCards.has(c.id))],
      groups: [...saved.groups, ...board.groups.filter((g) => !savedGroups.has(g.id))]
    }
  }
  return out
}
