import { useAppStore } from '@/store'
import { reconcileTabOrder } from '@/components/tab-bar/reconcile-order'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive
} from '@/runtime/web-runtime-session'

export type LaunchBlankTerminalInNewTabArgs = {
  worktreeId: string
  /** The tab group the user clicked from, mirrors launchAgentInNewTab. */
  groupId?: string
}

export type LaunchBlankTerminalInNewTabResult = { tabId: string | null } | null

/**
 * Create a new terminal tab with no CLI agent attached — a bare shell.
 *
 * Why: a sibling to launchAgentInNewTab for the Board's "Terminal" console
 * option. There is no command to resolve (no TUI_AGENT_CONFIG lookup, no
 * startup plan), so this only reuses the tab/card-creation plumbing: the
 * host-backed web-runtime branch (which already accepts no `agent`/`command`
 * for a plain shell) and the local createTab + tab-bar order persistence.
 */
export function launchBlankTerminalInNewTab(
  args: LaunchBlankTerminalInNewTabArgs
): LaunchBlankTerminalInNewTabResult {
  const { worktreeId, groupId } = args
  const store = useAppStore.getState()
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(store, worktreeId)
  if (isWebRuntimeSessionActive(runtimeEnvironmentId)) {
    void createWebRuntimeSessionTerminal({
      worktreeId,
      environmentId: runtimeEnvironmentId,
      targetGroupId: groupId,
      activate: true
    }).then((created) => {
      if (created) {
        store.setActiveTabType('terminal')
      }
    })
    return { tabId: null }
  }

  const tab = store.createTab(worktreeId, groupId)
  store.setActiveTabType('terminal')

  // Why: persist the tab-bar order with the new terminal appended, mirroring
  // launchAgentInNewTab's tail — without this a stored order falls back to
  // terminals-first and the new tab can jump to index 0 instead of the end.
  const fresh = useAppStore.getState()
  const termIds = (fresh.tabsByWorktree[worktreeId] ?? []).map((t) => t.id)
  const editorIds = fresh.openFiles.filter((f) => f.worktreeId === worktreeId).map((f) => f.id)
  const browserIds = (fresh.browserTabsByWorktree?.[worktreeId] ?? []).map((t) => t.id)
  const base = reconcileTabOrder(
    fresh.tabBarOrderByWorktree[worktreeId],
    termIds,
    editorIds,
    browserIds
  )
  const order = base.filter((id) => id !== tab.id)
  order.push(tab.id)
  fresh.setTabBarOrder(worktreeId, order)

  return { tabId: tab.id }
}
