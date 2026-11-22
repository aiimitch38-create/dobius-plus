import type { AgentResumeOwner } from '../../../../shared/agent-resume-owner'
import type { SnoozedTabEntry, SnoozedTabRef } from '../../../../shared/tab-snooze-types'
import type { PreloadApi } from '../../../../preload/api-types'
import type { AppState } from '@/store/types'
import type { BringBackOptions } from './bring-back-snoozed-tab'

type SettleState = Pick<
  AppState,
  'returningSnoozedTabs' | 'tabsByWorktree' | 'ptyIdsByTabId' | 'untrackReturningSnoozedTab'
>

/**
 * Finishes the returns this window started. A plain tab is done once its
 * terminal has started (or the user closed it). A conversation is different:
 * a started terminal is not proof the conversation started, so main drops
 * that entry itself when it starts the conversation's terminal. Anything main
 * did not confirm goes back on the shelf instead of being lost.
 */
export function settleReturningSnoozedTabs(deps: {
  getState: () => SettleState
  api: Pick<PreloadApi['tabSnooze'], 'settle' | 'putBack'>
  releaseAgentResume: (token: string, owner: AgentResumeOwner) => Promise<boolean>
}): void {
  const state = deps.getState()
  for (const [tabId, returning] of Object.entries(state.returningSnoozedTabs)) {
    const tab = (state.tabsByWorktree[returning.ref.worktreeId] ?? []).find(
      (candidate) => candidate.id === tabId
    )
    const started = Boolean(tab && (tab.ptyId || (state.ptyIdsByTabId[tabId]?.length ?? 0) > 0))
    if (tab && !started) {
      continue
    }
    state.untrackReturningSnoozedTab(tabId)
    if (!returning.claim) {
      void deps.api.settle(returning.ref)
      continue
    }
    if (!tab) {
      void deps.releaseAgentResume(returning.claim.token, returning.claim.owner)
    }
    // A no-op when main already confirmed the conversation and dropped the entry.
    void deps.api.putBack(returning.ref)
  }
}

/**
 * Run right after this window's saved tabs are restored, before any terminal
 * mounts. An entry main still holds with a return tab id means that return
 * never finished, so the tab it left has no conversation behind it and would
 * mount as a plain shell. It is closed; the entry brings the real one back.
 */
export function closeInterruptedSnoozeReturnTabs(deps: {
  entries: SnoozedTabEntry[]
  getState: () => Pick<AppState, 'tabsByWorktree'>
  closeTab: (tabId: string) => void
}): string[] {
  const closed: string[] = []
  for (const entry of deps.entries) {
    const tabId = entry.returnTabId
    if (!tabId || entry.returning) {
      continue
    }
    if (
      Object.values(deps.getState().tabsByWorktree).some((tabs) =>
        tabs.some((tab) => tab.id === tabId)
      )
    ) {
      deps.closeTab(tabId)
      closed.push(tabId)
    }
  }
  return closed
}

type LookState = Pick<AppState, 'workspaceSessionReady' | 'snoozedTabs' | 'drainSnoozeBringBacks'>

/**
 * One look: first the bring-backs the user asked for before this window's
 * tabs were restored, then the entries whose time has come. Main's take()
 * hands each entry out once, so two windows looking at once cannot both get it.
 */
export async function runSnoozeReturnLook(deps: {
  getState: () => LookState
  bringBack: (ref: SnoozedTabRef, options: BringBackOptions) => Promise<unknown>
}): Promise<void> {
  const state = deps.getState()
  if (!state.workspaceSessionReady) {
    return
  }
  for (const ref of state.drainSnoozeBringBacks()) {
    await deps.bringBack(ref, {})
  }
  for (const entry of deps.getState().snoozedTabs) {
    if (entry.ready && !entry.returning) {
      await deps.bringBack(
        { worktreeId: entry.worktreeId, tabId: entry.tabId },
        { onlyReady: true }
      )
    }
  }
}

/** Runs `look` one at a time; a request during a look runs exactly one more. */
export function createSerialLook(look: () => Promise<void>): () => void {
  let running = false
  let again = false
  const run = async (): Promise<void> => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      do {
        again = false
        await look()
      } while (again)
    } catch (err) {
      console.warn('[tab-snooze] return look failed:', err)
    } finally {
      running = false
    }
  }
  return () => void run()
}
