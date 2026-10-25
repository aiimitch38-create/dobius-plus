import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { canGoBackWorktreeHistory, canGoForwardWorktreeHistory } from '@/store/slices/worktree-nav-history'
import { selectFloatingVisibleTabCount } from '../store/selectors'
import { selectActiveTerminalChromeState } from '../store/active-terminal-chrome-selector'

// Why: bundles the flat, no-logic useAppStore(s => s.field) reads App needs
// into one hook call. Each field is still its own independent subscription
// (not consolidated via useShallow), so render/re-render behavior is
// unchanged from calling them inline in App — this only moves the plumbing
// out of App's body.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- return type is the large inferred object below; annotating it would just duplicate every field.
export function useAppShellStoreState() {
  const activeView = useAppStore((s) => s.activeView)
  const activeModal = useAppStore((s) => s.activeModal)
  const featureTipsSeenIds = useAppStore((s) => s.featureTipsSeenIds)
  const featureInteractions = useAppStore((s) => s.featureInteractions)
  const contextualToursAutoEligible = useAppStore((s) => s.contextualToursAutoEligible)
  const {
    activeWorktreeId,
    tabCount,
    effectiveActiveTabId,
    activeTabCanExpand,
    effectiveActiveTabExpanded
  } = useAppStore(useShallow(selectActiveTerminalChromeState))
  const activePendingCreationId = useAppStore((s) => s.activePendingCreationId)
  // Why: the creation surface owns the tab strip from the first pending frame.
  // Gating it on the delayed loader flag made the tab bar swap in mid-create.
  const activePendingCreationExists = useAppStore(
    (s) =>
      s.activePendingCreationId !== null &&
      s.pendingWorktreeCreations[s.activePendingCreationId] !== undefined
  )
  const floatingVisibleTabCount = useAppStore(selectFloatingVisibleTabCount)
  const workspaceSessionReady = useAppStore((s) => s.workspaceSessionReady)
  const workspaceSessionHydrated = useAppStore((s) => s.workspaceSessionHydrated)
  const keybindings = useAppStore((s) => s.keybindings)
  const updateStatus = useAppStore((s) => s.updateStatus)
  const activeContextualTourId = useAppStore((s) => s.activeContextualTourId)
  const floatingTerminalEnabled = useAppStore((s) => s.settings?.floatingTerminalEnabled === true)
  const floatingTerminalTriggerLocation = useAppStore(
    (s) => s.settings?.floatingTerminalTriggerLocation ?? 'floating-button'
  )
  const statusBarVisible = useAppStore((s) => s.statusBarVisible)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const groupBy = useAppStore((s) => s.groupBy)
  const sortBy = useAppStore((s) => s.sortBy)
  const projectOrderBy = useAppStore((s) => s.projectOrderBy)
  const showSleepingWorkspaces = useAppStore((s) => s.showSleepingWorkspaces)
  const hideDefaultBranchWorkspace = useAppStore((s) => s.hideDefaultBranchWorkspace)
  const hideAutomationGeneratedWorkspaces = useAppStore((s) => s.hideAutomationGeneratedWorkspaces)
  const showDotfilesByWorktree = useAppStore((s) => s.showDotfilesByWorktree)
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const acknowledgedAgentsByPaneKey = useAppStore((s) => s.acknowledgedAgentsByPaneKey)
  const persistedUIReady = useAppStore((s) => s.persistedUIReady)
  const rightSidebarWidth = useAppStore((s) => s.rightSidebarWidth)
  const markdownTocPanelWidth = useAppStore((s) => s.markdownTocPanelWidth)
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const rightSidebarTab = useAppStore((s) => s.rightSidebarTab)
  const rightSidebarExplorerView = useAppStore((s) => s.rightSidebarExplorerView)
  const isFullScreen = useAppStore((s) => s.isFullScreen)
  const settings = useAppStore((s) => s.settings)
  const dictationState = useAppStore((s) => s.dictationState)
  const hasSshCredentialRequest = useAppStore((s) => s.sshCredentialQueue.length > 0)
  const petEnabled = useAppStore((s) => s.settings?.experimentalPet === true)
  const petVisible = useAppStore((s) => s.petVisible)
  const canGoBackWorktree = useAppStore(canGoBackWorktreeHistory)
  const canGoForwardWorktree = useAppStore(canGoForwardWorktreeHistory)

  return {
    activeView,
    activeModal,
    featureTipsSeenIds,
    featureInteractions,
    contextualToursAutoEligible,
    activeWorktreeId,
    tabCount,
    effectiveActiveTabId,
    activeTabCanExpand,
    effectiveActiveTabExpanded,
    activePendingCreationId,
    activePendingCreationExists,
    floatingVisibleTabCount,
    workspaceSessionReady,
    workspaceSessionHydrated,
    keybindings,
    updateStatus,
    activeContextualTourId,
    floatingTerminalEnabled,
    floatingTerminalTriggerLocation,
    statusBarVisible,
    sidebarWidth,
    sidebarOpen,
    groupBy,
    sortBy,
    projectOrderBy,
    showSleepingWorkspaces,
    hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces,
    showDotfilesByWorktree,
    filterRepoIds,
    acknowledgedAgentsByPaneKey,
    persistedUIReady,
    rightSidebarWidth,
    markdownTocPanelWidth,
    rightSidebarOpen,
    rightSidebarTab,
    rightSidebarExplorerView,
    isFullScreen,
    settings,
    dictationState,
    hasSshCredentialRequest,
    petEnabled,
    petVisible,
    canGoBackWorktree,
    canGoForwardWorktree
  }
}
