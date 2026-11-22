import type { StateCreator } from 'zustand'
import type { AgentResumeOwner } from '../../../../shared/agent-resume-owner'
import type { SnoozedTabEntry, SnoozedTabRef } from '../../../../shared/tab-snooze-types'
import { sameSnoozedTab } from '../../../../shared/tab-snooze-types'
import type { TerminalTab } from '../../../../shared/types'
import type { AppState } from '../types'

/** A tab that came back from snooze and whose terminal has not started yet. */
export type ReturningSnoozedTab = {
  ref: SnoozedTabRef
  /** The session claim reserved for it, released if the tab is closed first. */
  claim?: { token: string; owner: AgentResumeOwner }
}

/** Asks the user before snoozing a tab that is in the middle of something. */
export type SnoozeTabConfirmRequest = {
  tabId: string
  tabLabel: string
  until: number | null
  /** False when the tab has no conversation that can pick up again later. */
  resumes: boolean
}

export type TabSnoozeSlice = {
  /** Main's list, as last read. Main owns it; this is a mirror for the UI. */
  snoozedTabs: SnoozedTabEntry[]
  setSnoozedTabs: (entries: SnoozedTabEntry[]) => void
  /** Worktrees whose Snoozed shelf is unfolded. Folded is the default. */
  snoozedShelfOpenWorktreeIds: string[]
  setSnoozedShelfOpenWorktreeIds: (worktreeIds: string[]) => void
  toggleSnoozedShelf: (worktreeId: string) => void
  /** Reopened tabs keyed by their new tab id, until their terminal starts. */
  returningSnoozedTabs: Record<string, ReturningSnoozedTab>
  trackReturningSnoozedTab: (tabId: string, returning: ReturningSnoozedTab) => void
  untrackReturningSnoozedTab: (tabId: string) => void
  /** "Bring back now" asked for before this window's tabs were restored. */
  pendingSnoozeBringBacks: SnoozedTabRef[]
  queueSnoozeBringBack: (ref: SnoozedTabRef) => void
  drainSnoozeBringBacks: () => SnoozedTabRef[]
  snoozeTabConfirm: SnoozeTabConfirmRequest | null
  setSnoozeTabConfirm: (request: SnoozeTabConfirmRequest | null) => void
}

export const createTabSnoozeSlice: StateCreator<AppState, [], [], TabSnoozeSlice> = (set, get) => ({
  snoozedTabs: [],
  setSnoozedTabs: (entries) => set({ snoozedTabs: entries }),

  snoozedShelfOpenWorktreeIds: [],
  setSnoozedShelfOpenWorktreeIds: (worktreeIds) =>
    set({ snoozedShelfOpenWorktreeIds: [...new Set(worktreeIds)] }),
  toggleSnoozedShelf: (worktreeId) =>
    set((state) => {
      const open = state.snoozedShelfOpenWorktreeIds
      return {
        snoozedShelfOpenWorktreeIds: open.includes(worktreeId)
          ? open.filter((id) => id !== worktreeId)
          : [...open, worktreeId]
      }
    }),

  returningSnoozedTabs: {},
  trackReturningSnoozedTab: (tabId, returning) =>
    set((state) => ({
      returningSnoozedTabs: { ...state.returningSnoozedTabs, [tabId]: returning }
    })),
  untrackReturningSnoozedTab: (tabId) =>
    set((state) => {
      if (!(tabId in state.returningSnoozedTabs)) {
        return state
      }
      const next = { ...state.returningSnoozedTabs }
      delete next[tabId]
      return { returningSnoozedTabs: next }
    }),

  pendingSnoozeBringBacks: [],
  queueSnoozeBringBack: (ref) =>
    set((state) =>
      state.pendingSnoozeBringBacks.some((pending) => sameSnoozedTab(pending, ref))
        ? state
        : { pendingSnoozeBringBacks: [...state.pendingSnoozeBringBacks, ref] }
    ),
  drainSnoozeBringBacks: () => {
    const pending = get().pendingSnoozeBringBacks
    if (pending.length > 0) {
      set({ pendingSnoozeBringBacks: [] })
    }
    return pending
  },

  snoozeTabConfirm: null,
  setSnoozeTabConfirm: (request) => set({ snoozeTabConfirm: request })
})

type ShelfState = {
  snoozedTabs: readonly SnoozedTabEntry[]
  tabsByWorktree: Record<string, readonly Pick<TerminalTab, 'id'>[] | undefined>
}

/**
 * The rows the Snoozed shelf shows for a worktree, soonest first. Hidden: a
 * tab that is on its way back, and a tab that is still open here. Main lists
 * the entry a moment before the tab closes; without this it would show as open
 * and snoozed at once (Sam's sidebar fix).
 */
export function selectSnoozedTabsForWorktree(
  state: ShelfState,
  worktreeId: string
): SnoozedTabEntry[] {
  const openTabIds = new Set((state.tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id))
  return state.snoozedTabs
    .filter(
      (entry) => entry.worktreeId === worktreeId && !entry.returning && !openTabIds.has(entry.tabId)
    )
    .sort(
      (left, right) =>
        (left.until ?? Number.POSITIVE_INFINITY) - (right.until ?? Number.POSITIVE_INFINITY) ||
        left.snoozedAt - right.snoozedAt
    )
}
