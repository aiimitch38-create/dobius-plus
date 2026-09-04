import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'

// Why: Zustand actions are referentially stable, but each individual
// useAppStore(s => s.someAction) still registers a subscription that React
// must check on every store mutation. Consolidating action refs into one
// useShallow subscription means one equality check instead of many.
export function useAppActions() {
  return useAppStore(
    useShallow((s) => ({
      toggleSidebar: s.toggleSidebar,
      fetchReposForAllHosts: s.fetchReposForAllHosts,
      fetchProjectGroupsForAllHosts: s.fetchProjectGroupsForAllHosts,
      fetchFolderWorkspacesForAllHosts: s.fetchFolderWorkspacesForAllHosts,
      fetchAllWorktrees: s.fetchAllWorktrees,
      fetchWorktreeLineage: s.fetchWorktreeLineage,
      fetchSettings: s.fetchSettings,
      fetchKeybindings: s.fetchKeybindings,
      initGitHubCache: s.initGitHubCache,
      refreshAllGitHub: s.refreshAllGitHub,
      reportVisibleGitHubPRRefreshCandidates: s.reportVisibleGitHubPRRefreshCandidates,
      bumpGitHubPRVisibleRefreshGeneration: s.bumpGitHubPRVisibleRefreshGeneration,
      hydrateWorkspaceSession: s.hydrateWorkspaceSession,
      hydrateTabsSession: s.hydrateTabsSession,
      hydrateEditorSession: s.hydrateEditorSession,
      hydrateBrowserSession: s.hydrateBrowserSession,
      fetchBrowserSessionProfiles: s.fetchBrowserSessionProfiles,
      reconnectPersistedTerminals: s.reconnectPersistedTerminals,
      setDeferredSshReconnectTargets: s.setDeferredSshReconnectTargets,
      setSshConnectionState: s.setSshConnectionState,
      hydratePersistedUI: s.hydratePersistedUI,
      setHydrationSucceeded: s.setHydrationSucceeded,
      openModal: s.openModal,
      markFeatureTipsSeen: s.markFeatureTipsSeen,
      setContextualToursAutoEligible: s.setContextualToursAutoEligible,
      setContextualToursOnboardingVisible: s.setContextualToursOnboardingVisible,
      toggleRightSidebar: s.toggleRightSidebar,
      setRightSidebarOpen: s.setRightSidebarOpen,
      setRightSidebarTab: s.setRightSidebarTab,
      showRightSidebarFiles: s.showRightSidebarFiles,
      showRightSidebarSearch: s.showRightSidebarSearch,
      updateSettings: s.updateSettings,
      pruneLastVisitedTimestamps: s.pruneLastVisitedTimestamps,
      seedActiveWorktreeLastVisitedIfMissing: s.seedActiveWorktreeLastVisitedIfMissing
    }))
  )
}
