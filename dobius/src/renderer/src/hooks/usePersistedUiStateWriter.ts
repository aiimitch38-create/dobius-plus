import { useEffect } from 'react'
import type { AppState } from '@/store'

export type UsePersistedUiStateWriterParams = Pick<
  AppState,
  | 'sidebarWidth'
  | 'rightSidebarOpen'
  | 'rightSidebarTab'
  | 'rightSidebarExplorerView'
  | 'rightSidebarWidth'
  | 'markdownTocPanelWidth'
  | 'groupBy'
  | 'sortBy'
  | 'projectOrderBy'
  | 'showSleepingWorkspaces'
  | 'hideDefaultBranchWorkspace'
  | 'hideAutomationGeneratedWorkspaces'
  | 'showDotfilesByWorktree'
  | 'filterRepoIds'
  | 'acknowledgedAgentsByPaneKey'
> & {
  persistedUIReady: boolean
}

// Why: debounces the persisted-UI write so rapid sidebar/filter changes
// (drag-resize, repeated toggles) coalesce into one disk write instead of one
// per state tick.
export function usePersistedUiStateWriter(params: UsePersistedUiStateWriterParams): void {
  const {
    persistedUIReady,
    sidebarWidth,
    rightSidebarOpen,
    rightSidebarTab,
    rightSidebarExplorerView,
    rightSidebarWidth,
    markdownTocPanelWidth,
    groupBy,
    sortBy,
    projectOrderBy,
    showSleepingWorkspaces,
    hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces,
    showDotfilesByWorktree,
    filterRepoIds,
    acknowledgedAgentsByPaneKey
  } = params

  useEffect(() => {
    if (!persistedUIReady) {
      return
    }

    const timer = window.setTimeout(() => {
      void window.api.ui.set({
        sidebarWidth,
        rightSidebarOpen,
        rightSidebarTab,
        rightSidebarExplorerView,
        rightSidebarWidth,
        markdownTocPanelWidth,
        groupBy,
        sortBy,
        projectOrderBy,
        showActiveOnly: false,
        hideSleepingWorkspaces: !showSleepingWorkspaces,
        showSleepingWorkspaces,
        hideDefaultBranchWorkspace,
        hideAutomationGeneratedWorkspaces,
        showDotfilesByWorktree,
        filterRepoIds,
        // Why: rides the same debounced save so dashboard auto-acks (which fire
        // on focus/visibility) and the in-memory ack cleanup paths in
        // agent-status.ts (close/dismiss) both flow to disk through map
        // identity changes. Without persisting, agent rows that survive
        // restart come back bold even when the user had already visited them.
        acknowledgedAgentsByPaneKey
      })
    }, 150)

    return () => window.clearTimeout(timer)
  }, [
    persistedUIReady,
    sidebarWidth,
    rightSidebarOpen,
    rightSidebarTab,
    rightSidebarExplorerView,
    rightSidebarWidth,
    markdownTocPanelWidth,
    groupBy,
    sortBy,
    projectOrderBy,
    showSleepingWorkspaces,
    hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces,
    showDotfilesByWorktree,
    filterRepoIds,
    acknowledgedAgentsByPaneKey
  ])
}
