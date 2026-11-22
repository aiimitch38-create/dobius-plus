// The one snooze service of this main process, for the callers that cannot be
// handed it: the session-claim gate (main/ipc/pty.ts) and the store.
import type { AgentResumeOwner } from '../shared/agent-resume-owner'
import type { TabSnoozeService } from './tab-snooze'

let activeService: TabSnoozeService | null = null

export function setActiveTabSnoozeService(service: TabSnoozeService | null): void {
  activeService = service
}

/** The claim gate's question (main/ipc/pty.ts): is this window returning the tab that owns this resume? */
export function isSnoozedTabReturnOwner(owner: AgentResumeOwner, rendererId: number): boolean {
  return activeService?.ownsReturn(owner, rendererId) ?? false
}

/**
 * Main started the conversation's terminal (main/ipc/pty.ts). Null when no
 * snoozed tab is returning with this conversation. See stageReturnSettle.
 */
export function stageSnoozedTabReturnSettle(
  owner: AgentResumeOwner
): ReturnType<TabSnoozeService['stageReturnSettle']> {
  try {
    return activeService?.stageReturnSettle(owner) ?? null
  } catch (err) {
    // Why: the caller has just started a terminal; bookkeeping here must not
    // make that spawn look failed. The entry stays and is released later.
    console.warn(
      '[tab-snooze] could not settle a return:',
      err instanceof Error ? err.message : err
    )
    return null
  }
}

/** The spawn for a returning conversation failed (main/ipc/pty.ts): retry from the shelf. */
export function releaseSnoozedTabReturn(owner: AgentResumeOwner): boolean {
  try {
    return activeService?.releaseReturn(owner) ?? false
  } catch (err) {
    console.warn(
      '[tab-snooze] could not release a return:',
      err instanceof Error ? err.message : err
    )
    return false
  }
}

export function discardSnoozedTabsForWorktree(worktreeId: string): void {
  activeService?.discardWorktree(worktreeId)
}

/** For `dobius tabs snoozed|unsnooze` (main/runtime/rpc/methods/tab-snooze.ts). */
export function getActiveTabSnoozeService(): TabSnoozeService | null {
  return activeService
}
