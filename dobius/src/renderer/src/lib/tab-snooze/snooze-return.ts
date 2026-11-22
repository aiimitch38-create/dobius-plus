import type { AgentResumeOwner } from '../../../../shared/agent-resume-owner'
import type { SnoozedTabRef } from '../../../../shared/tab-snooze-types'
import type { PreloadApi } from '../../../../preload/api-types'
import type { AppState } from '@/store/types'
import type { BringBackOptions } from './bring-back-snoozed-tab'

type SettleState = Pick<
  AppState,
  'returningSnoozedTabs' | 'tabsByWorktree' | 'ptyIdsByTabId' | 'untrackReturningSnoozedTab'
>

/**
 * Finishes returns whose tab has really started: main drops the entry only
 * now, so a quit before this point starts the return over instead of losing
 * the conversation. A tab closed before it started is done too, and gives its
 * reserved session claim back.
 */
export function settleReturningSnoozedTabs(deps: {
  getState: () => SettleState
  api: Pick<PreloadApi['tabSnooze'], 'settle'>
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
    if (!tab && returning.claim) {
      void deps.releaseAgentResume(returning.claim.token, returning.claim.owner)
    }
    void deps.api.settle(returning.ref)
  }
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
