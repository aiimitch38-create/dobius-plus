import type { StoreApi } from 'zustand'
import type { AppState } from '../types'
import { isPersistableImageSrc, withoutDriver, type BoardState } from './board-state'

export const PERSIST_DEBOUNCE_MS = 300
// Why: pan/zoom changes only the camera; wait until the gesture has clearly
// settled before rewriting the whole boards map.
export const VIEWPORT_PERSIST_SETTLE_MS = 1_000

let persistTimer: ReturnType<typeof setTimeout> | null = null
let persistDueAt = 0
// Every payload we've sent but not yet seen echoed back. Main doesn't
// guarantee writes land (and rebroadcast) in send order, so an older write's
// echo can arrive after a newer one's — comparing against only the latest
// sent JSON would then miss it, mark it "external," and let it clobber a
// since-moved card back to the older position mid-drag.
const pendingPersistedJsons = new Set<string>()
// Worktrees changed locally since the last write; a broadcast never overwrites these.
const dirtyWorktrees = new Set<string>()
// Set by the live persistence so flushBoardPersistence() can reach it.
let flushPending: (() => Promise<void>) | null = null
// True after a write main refused; the next flush writes again even with no timer.
let lastWriteFailed = false

/**
 * Writes a pending board change to main now instead of after the debounce.
 * Why: main resolves `card:<id>` from its saved copy of the board, so a change
 * that re-points a card (console restart) must land there before the old
 * terminal is closed. Resolves once main has the write; rejects when main
 * refused it (the change stays dirty and the next flush retries it).
 */
export function flushBoardPersistence(): Promise<void> {
  return flushPending ? flushPending() : Promise.resolve()
}

export function resetBoardPersistenceForTest(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
  }
  persistTimer = null
  persistDueAt = 0
  flushPending = null
  lastWriteFailed = false
  pendingPersistedJsons.clear()
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

  const write = async (): Promise<void> => {
    persistTimer = null
    const { boardsHydrated, boardsByWorktree } = get()
    if (!boardsHydrated) {
      return
    }
    const payload = toPersistedBoards(boardsByWorktree)
    const json = JSON.stringify(payload)
    const written = [...dirtyWorktrees]
    dirtyWorktrees.clear()
    pendingPersistedJsons.add(json)
    try {
      await window.api.ui.set({ boardsByWorktree: payload })
      lastWriteFailed = false
    } catch (error) {
      // Why: main does not have these changes, so a broadcast must still not
      // overwrite them, and the next flush must write them again.
      for (const id of written) {
        dirtyWorktrees.add(id)
      }
      pendingPersistedJsons.delete(json)
      lastWriteFailed = true
      throw error
    }
  }

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
      () => void write().catch(console.error),
      Math.max(0, dueAt - Date.now())
    )
  }

  flushPending = async () => {
    if (!persistTimer && !lastWriteFailed) {
      return
    }
    if (persistTimer) {
      clearTimeout(persistTimer)
    }
    await write()
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

  // Leaving the Board saves a "close" snapshot once the pending write has landed.
  api.subscribe((state, prev) => {
    const worktreeId = prev.activeWorktreeId
    if (prev.activeView !== 'board' || state.activeView === 'board' || !worktreeId) {
      return
    }
    const wait = persistTimer ? Math.max(0, persistDueAt - Date.now()) + 100 : 0
    setTimeout(() => {
      window.api?.boardSnapshots
        ?.capture({ worktreeId, reason: 'close' })
        .catch((error: unknown) => console.warn('[board] snapshot on close failed', error))
    }, wait)
  })

  return {
    schedule,
    isEcho: (raw) => {
      const json = JSON.stringify(raw ?? {})
      return pendingPersistedJsons.delete(json)
    },
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

/**
 * Restores a saved snapshot over the live board without touching terminals.
 * Snapshot cards come back as saved; a console whose terminal is gone shows as
 * closed (its card renders "This terminal was closed"). Every console on the
 * board now that the snapshot lacks is kept, and a snapshot console whose
 * terminal is already shown by another card is dropped, so restoring never
 * hides, duplicates or kills a live terminal. Camera and tool stay as they are.
 */
export function mergeSnapshotBoard(current: BoardState, snapshot: BoardState): BoardState {
  const currentTabOwner = new Map<string, string>()
  for (const card of current.cards) {
    if (card.kind === 'console') {
      currentTabOwner.set(card.tabId, card.id)
    }
  }
  const cards = snapshot.cards.filter((card) => {
    if (card.kind !== 'console') {
      return true
    }
    const owner = currentTabOwner.get(card.tabId)
    return owner === undefined || owner === card.id
  })
  const ids = new Set(cards.map((c) => c.id))
  for (const card of current.cards) {
    if (card.kind === 'console' && !ids.has(card.id)) {
      cards.push(card)
      ids.add(card.id)
    }
  }
  return {
    ...current,
    cards: cards.map((c) =>
      (c.kind === 'orchestrator' || c.kind === 'goal') && c.wiredCardIds.some((id) => !ids.has(id))
        ? { ...c, wiredCardIds: c.wiredCardIds.filter((id) => ids.has(id)) }
        : c.kind === 'web' && c.driverCardId && !ids.has(c.driverCardId)
          ? withoutDriver(c)
          : c
    ),
    groups: snapshot.groups
      .map((g) => ({ ...g, cardIds: g.cardIds.filter((id) => ids.has(id)) }))
      .filter((g) => g.cardIds.length > 0),
    connectors: (snapshot.connectors ?? []).filter(
      (c) => ids.has(c.fromCardId) && ids.has(c.toCardId)
    )
  }
}
