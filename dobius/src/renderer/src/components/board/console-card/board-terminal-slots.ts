import {
  setActivityTerminalPortals,
  type ActivityTerminalPortalTarget
} from '@/components/activity/activity-terminal-portal'
import { SYNC_FIT_PANES_EVENT } from '@/constants/terminal'

// One shared publisher for every console card: setActivityTerminalPortals
// replaces the whole registry, so cards must never call it with only their own
// slot. Terminal renders a tab in its ordinary pane OR one portal, never both,
// so the live TerminalPane is borrowed, never duplicated.

export type BoardTerminalSlot = Omit<ActivityTerminalPortalTarget, 'active' | 'requestToken'>

const slots = new Map<string, BoardTerminalSlot>()
let focusedSlotId: string | null = null
let published: ActivityTerminalPortalTarget[] = []
const releaseListeners = new Set<() => void>()
let fitTimer: ReturnType<typeof setTimeout> | null = null

const BOARD_FIT_DEBOUNCE_MS = 150

/**
 * Why: every SYNC_FIT_PANES_EVENT refits every pane in the app, so N console
 * cards settling at once must produce one event, not N.
 */
export function requestBoardTerminalFit(): void {
  if (fitTimer) {
    clearTimeout(fitTimer)
  }
  fitTimer = setTimeout(() => {
    fitTimer = null
    window.dispatchEvent(new CustomEvent(SYNC_FIT_PANES_EVENT))
  }, BOARD_FIT_DEBOUNCE_MS)
}

/** Called whenever a slot is released, so a card that lost a claim can retry. */
export function onBoardTerminalSlotReleased(listener: () => void): () => void {
  releaseListeners.add(listener)
  return () => releaseListeners.delete(listener)
}

function publish(): void {
  const next = [...slots.values()].map(
    (slot): ActivityTerminalPortalTarget => ({
      ...slot,
      requestToken: `${slot.slotId}:${slot.paneKey}`,
      active: slot.slotId === focusedSlotId
    })
  )
  const unchanged =
    next.length === published.length &&
    next.every((s, i) => {
      const p = published[i]
      return (
        s.slotId === p.slotId &&
        s.target === p.target &&
        s.tabId === p.tabId &&
        s.paneKey === p.paneKey &&
        s.worktreeId === p.worktreeId &&
        s.active === p.active
      )
    })
  if (unchanged) {
    return
  }
  // Why: Terminal memoizes on descriptor identity, so only republish on real change.
  published = next
  setActivityTerminalPortals(published)
}

/** Returns the slotId that already owns this tab, or null when the claim succeeded. */
export function claimBoardTerminalSlot(slot: BoardTerminalSlot): string | null {
  // Why: portal lookup picks one target per tab; a second card would fight for it.
  for (const existing of slots.values()) {
    if (existing.tabId === slot.tabId && existing.slotId !== slot.slotId) {
      return existing.slotId
    }
  }
  slots.set(slot.slotId, slot)
  publish()
  return null
}

export function releaseBoardTerminalSlot(slotId: string): void {
  if (!slots.delete(slotId)) {
    return
  }
  if (focusedSlotId === slotId) {
    focusedSlotId = null
  }
  publish()
  for (const listener of releaseListeners) {
    listener()
  }
}

export function focusBoardTerminalSlot(slotId: string | null): void {
  if (focusedSlotId === slotId) {
    return
  }
  focusedSlotId = slotId
  publish()
}

/** Drops focus only if this slot still holds it, so effect order between cards can't clobber a newer focus. */
export function blurBoardTerminalSlot(slotId: string): void {
  if (focusedSlotId === slotId) {
    focusBoardTerminalSlot(null)
  }
}

export function resetBoardTerminalSlotsForTest(): void {
  slots.clear()
  focusedSlotId = null
  published = []
  releaseListeners.clear()
  if (fitTimer) {
    clearTimeout(fitTimer)
    fitTimer = null
  }
}
