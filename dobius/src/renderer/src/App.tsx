/* eslint-disable max-lines */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SYNC_FIT_PANES_EVENT, TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'
import { resolveLeftSidebarStyleVariables } from '@/lib/left-sidebar-appearance'
import { canShowRightSidebarForView } from '@/lib/right-sidebar-visibility'
import {
  isPairedWebClientWindow,
  shouldRenderDesktopWindowChrome
} from '@/lib/desktop-window-chrome'
import { resolveLeftTitlebarChromeLayout } from '@/lib/titlebar-left-chrome'
import { shouldShowWorktreeCreationSurface } from '@/lib/worktree-creation-surface'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from './store'
import { useShallow } from 'zustand/react/shallow'
import { useIpcEvents } from './hooks/useIpcEvents'
import { useAutomationDispatchEvents } from './hooks/useAutomationDispatchEvents'
import RetainedAgentsSyncGate from './components/dashboard/RetainedAgentsSyncGate'
import { AgentHibernationGate } from './components/AgentHibernationGate'
import { useSystemPrefersDark } from './components/terminal-pane/use-system-prefers-dark'
import { TelemetryFirstLaunchSurface } from './components/TelemetryFirstLaunchSurface'
import { ZoomOverlay } from './components/ZoomOverlay'
import { MarkdownTemplatePicker } from './components/editor/MarkdownTemplatePicker'
import { useFloatingTerminalOpenState } from './hooks/useFloatingTerminalOpenState'
import { WorkspacePortScanner } from './components/ports/WorkspacePortScanner'
import { CrashReportDialog } from './components/crash-report/CrashReportDialog'
import NewWorkspaceComposerModal from './components/NewWorkspaceComposerModal'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import { ConfirmationDialogProvider } from './components/confirmation-dialog'
import { LinkRoutingPreferenceDialogProvider } from './components/link-routing-preference-dialog'
import RecentTabSwitcher from './components/tab-bar/RecentTabSwitcher'
import { useGitStatusPolling } from './components/right-sidebar/useGitStatusPolling'
import { useEditorExternalWatch } from './hooks/useEditorExternalWatch'
import { useAutoAckViewedAgent } from './hooks/useAutoAckViewedAgent'
import { useUnreadDockBadge } from './hooks/useUnreadDockBadge'
import {
  resolvePrimarySelectionMiddleClickPaste,
  usePrimarySelectionPaste
} from './hooks/usePrimarySelectionPaste'
import { useAppMenuPaste } from './hooks/useAppMenuPaste'
import { useLargeTextControlPaste } from './hooks/useLargeTextControlPaste'
import { useWebSessionTabsSync } from './runtime/web-session-tabs-sync'
import { useGlobalFileDrop } from './hooks/useGlobalFileDrop'
import { useRadixBodyPointerEventsRecovery } from './hooks/useRadixBodyPointerEventsRecovery'
import { shouldRenderPetOverlay } from './components/pet/pet-overlay-visibility'
import { useShortcutLabel } from './hooks/useShortcutLabel'
import {
  canGoBackWorktreeHistory,
  canGoForwardWorktreeHistory
} from '@/store/slices/worktree-nav-history'
import { selectFloatingVisibleTabCount } from './store/selectors'
import { selectActiveTerminalChromeState } from './store/active-terminal-chrome-selector'
import type { VirtualizedScrollAnchor } from './hooks/useVirtualizedScrollAnchor'
import { resolveMountedLazyModalIds, type LazyModalId } from './lazy-modal-mount-state'
import { translate } from '@/i18n/i18n'
import PinnedTabCloseDialog from './components/terminal-pane/PinnedTabCloseDialog'
import { WindowControls } from './components/app-shell/WindowControls'
import { AppTitlebarLeftControls, AppTitlebarMainStrip } from './components/app-shell/AppTitlebarChrome'
import { AppWorkspaceShell } from './components/app-shell/AppWorkspaceShell'
import { shouldMountUpdateCardForStatus } from '@/lib/should-mount-update-card'
import { useGlobalKeyboardShortcuts } from './hooks/useGlobalKeyboardShortcuts'
import { useWorkspaceStartupHydration } from './hooks/useWorkspaceStartupHydration'
import { useOnboardingAndFeatureTipsGate } from './hooks/useOnboardingAndFeatureTipsGate'
import { useTitlebarChromeMeasurements } from './hooks/useTitlebarChromeMeasurements'
import { usePersistedUiStateWriter } from './hooks/usePersistedUiStateWriter'
import { useAppearanceSync } from './hooks/useAppearanceSync'
import { useAppLifecyclePersistence } from './hooks/useAppLifecyclePersistence'
import {
  QuickOpen,
  WorktreeJumpPalette,
  WorkspaceCleanupDialog,
  StatusBar,
  SetupGuideModal,
  FeatureWallModal,
  FeatureTipsModal,
  AddRepoDialog,
  NonGitFolderDialog,
  AddProjectFromFolderDialog,
  ProjectAddedDialog,
  DeleteWorktreeDialog,
  DictationController,
  SshPassphraseDialog,
  UpdateCard,
  ContextualTourOverlay,
  SetupGuideTelemetryObserver,
  FloatingTerminalPanel,
  PetOverlay,
  OnboardingFlow
} from './app-lazy-pages'

const isMac = navigator.userAgent.includes('Mac')
const isWindows = !isMac && navigator.userAgent.includes('Windows')
const shortcutPlatform: NodeJS.Platform = isMac ? 'darwin' : isWindows ? 'win32' : 'linux'
// Why: Windows and Linux both run with the native title bar removed (Windows
// via titleBarStyle: 'hidden', Linux via frame: false), so the renderer draws
// its own logo/menu anchor and min/max/close controls on both. Paired web
// clients run in a browser tab, so they must not render desktop window chrome.
const hasCustomTitleBar = shouldRenderDesktopWindowChrome({
  platform: shortcutPlatform,
  isWebClient: isPairedWebClientWindow()
})

function App(): React.JSX.Element {
  const clearUnreadDockBadge = useUnreadDockBadge()
  useRadixBodyPointerEventsRecovery()
  useWebSessionTabsSync()
  // Why: Zustand actions are referentially stable, but each individual
  // useAppStore(s => s.someAction) still registers a subscription that React
  // must check on every store mutation. Consolidating action refs into one
  // useShallow subscription means one equality check instead of many.
  const actions = useAppStore(
    useShallow((s) => ({
      toggleSidebar: s.toggleSidebar,
      fetchRepos: s.fetchRepos,
      fetchReposForAllHosts: s.fetchReposForAllHosts,
      fetchProjectGroups: s.fetchProjectGroups,
      fetchProjectGroupsForAllHosts: s.fetchProjectGroupsForAllHosts,
      fetchFolderWorkspaces: s.fetchFolderWorkspaces,
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
      closeModal: s.closeModal,
      markFeatureTipsSeen: s.markFeatureTipsSeen,
      setContextualToursAutoEligible: s.setContextualToursAutoEligible,
      setContextualToursOnboardingVisible: s.setContextualToursOnboardingVisible,
      cancelContextualTour: s.cancelContextualTour,
      toggleRightSidebar: s.toggleRightSidebar,
      setRightSidebarOpen: s.setRightSidebarOpen,
      setRightSidebarTab: s.setRightSidebarTab,
      showRightSidebarFiles: s.showRightSidebarFiles,
      showRightSidebarSearch: s.showRightSidebarSearch,
      setActiveView: s.setActiveView,
      updateSettings: s.updateSettings,
      pruneLastVisitedTimestamps: s.pruneLastVisitedTimestamps,
      seedActiveWorktreeLastVisitedIfMissing: s.seedActiveWorktreeLastVisitedIfMissing
    }))
  )

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
  // Why: App swaps the sidebar between workspace and landing layouts when the
  // active workspace is slept/deleted. Keep virtualized scroll memory above
  // that remount so the left workspace list doesn't restart at scrollTop 0.
  const worktreeSidebarScrollOffsetRef = useRef(0)
  const worktreeSidebarScrollAnchorRef = useRef<VirtualizedScrollAnchor>(null)
  const floatingVisibleTabCount = useAppStore(selectFloatingVisibleTabCount)
  const workspaceSessionReady = useAppStore((s) => s.workspaceSessionReady)
  const keybindings = useAppStore((s) => s.keybindings)
  const updateStatus = useAppStore((s) => s.updateStatus)
  const activeContextualTourId = useAppStore((s) => s.activeContextualTourId)
  const leftSidebarShortcutLabel = useShortcutLabel('sidebar.left.toggle')
  const rightSidebarShortcutLabel = useShortcutLabel('sidebar.right.toggle')
  const historyBackShortcutLabel = useShortcutLabel('worktree.history.back')
  const historyForwardShortcutLabel = useShortcutLabel('worktree.history.forward')
  const floatingTerminalEnabled = useAppStore((s) => s.settings?.floatingTerminalEnabled === true)
  const floatingTerminalTriggerLocation = useAppStore(
    (s) => s.settings?.floatingTerminalTriggerLocation ?? 'floating-button'
  )
  const statusBarVisible = useAppStore((s) => s.statusBarVisible)
  const showFloatingTerminalButton =
    floatingTerminalEnabled &&
    (floatingTerminalTriggerLocation === 'floating-button' || !statusBarVisible)
  const hasMountedTerminalWorkbenchRef = useRef(false)
  if (activeWorktreeId !== null) {
    hasMountedTerminalWorkbenchRef.current = true
  }
  // Why: skip the terminal bundle on the no-workspace landing path, but once a
  // workspace has mounted, keep Terminal-owned hidden panes alive through sleep
  // and shutdown transitions where activeWorktreeId can briefly become null.
  const shouldMountTerminalWorkbench =
    activeWorktreeId !== null || hasMountedTerminalWorkbenchRef.current
  // Communications follows the terminal-workbench rule: once opened it stays
  // MOUNTED and is hidden with CSS. Remounting it on every tab switch re-ran
  // the whole comms boot (loading flash, relay resubscribe, cache refill) and
  // dropped live message delivery while the user was on other tabs.
  const hasMountedCommunicationsRef = useRef(false)
  if (activeView === 'buzz') {
    hasMountedCommunicationsRef.current = true
  }
  const shouldMountCommunications = activeView === 'buzz' || hasMountedCommunicationsRef.current
  // Why: visible worktree creation owns its faux tab strip from start to finish;
  // the previous workspace must stay mounted for retention without rendering
  // real chrome.
  const creationLayoutActive = shouldShowWorktreeCreationSurface({
    activeView,
    activePendingCreationId,
    hasActivePendingCreation: activePendingCreationExists
  })
  const workspaceChromeActive =
    activeView === 'terminal' && activeWorktreeId !== null && !creationLayoutActive
  const terminalWorkbenchVisible =
    activeView === 'terminal' && activeWorktreeId !== null && !creationLayoutActive
  // Why: a closed empty floating workspace is not startup-critical. Once it owns
  // tabs, keep it mounted while closed so hidden terminal/browser/editor panes
  // retain their local state.
  const {
    floatingTerminalOpen,
    setFloatingTerminalOpenWithFocus,
    floatingWorkspaceTourInteractionSnapshotRef,
    cancelFloatingTerminalReturnFocusFrame
  } = useFloatingTerminalOpenState(floatingTerminalEnabled)
  const shouldMountFloatingTerminalPanel =
    floatingTerminalEnabled && (floatingTerminalOpen || floatingVisibleTabCount > 0)

  const setAppRootNode = useCallback(
    (node: HTMLDivElement | null): void => {
      // Why: these best-effort App chrome cleanups share the App root lifetime.
      if (!node) {
        cancelFloatingTerminalReturnFocusFrame()
        clearUnreadDockBadge()
      }
    },
    [cancelFloatingTerminalReturnFocusFrame, clearUnreadDockBadge]
  )

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
  const shouldMountContextualTourOverlay = activeContextualTourId !== null
  const shouldMountSetupGuideTelemetryObserver = persistedUIReady
  const shouldMountUpdateCard = shouldMountUpdateCardForStatus(updateStatus)
  const rightSidebarWidth = useAppStore((s) => s.rightSidebarWidth)
  const markdownTocPanelWidth = useAppStore((s) => s.markdownTocPanelWidth)
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const rightSidebarTab = useAppStore((s) => s.rightSidebarTab)
  const rightSidebarExplorerView = useAppStore((s) => s.rightSidebarExplorerView)
  const isFullScreen = useAppStore((s) => s.isFullScreen)
  const settings = useAppStore((s) => s.settings)
  const systemPrefersDark = useSystemPrefersDark()
  const leftSidebarStyle = useMemo(
    () => resolveLeftSidebarStyleVariables(settings, systemPrefersDark),
    [settings, systemPrefersDark]
  ) as React.CSSProperties | undefined
  const dictationState = useAppStore((s) => s.dictationState)
  const hasSshCredentialRequest = useAppStore((s) => s.sshCredentialQueue.length > 0)
  const shouldMountDictationController =
    settings?.voice?.enabled === true || dictationState !== 'idle'
  const primarySelectionMiddleClickPaste = resolvePrimarySelectionMiddleClickPaste(
    settings?.primarySelectionMiddleClickPaste
  )
  usePrimarySelectionPaste(primarySelectionMiddleClickPaste)
  useAppMenuPaste()
  useLargeTextControlPaste()
  const petEnabled = useAppStore((s) => s.settings?.experimentalPet === true)
  const petVisible = useAppStore((s) => s.petVisible)
  const renderPetOverlay = shouldRenderPetOverlay({
    persistedUIReady,
    petEnabled,
    petVisible
  })
  const canGoBackWorktree = useAppStore(canGoBackWorktreeHistory)
  const canGoForwardWorktree = useAppStore(canGoForwardWorktreeHistory)
  const [mountedLazyModalIds, setMountedLazyModalIds] = useState<Set<LazyModalId>>(() => new Set())
  const [shouldMountAddRepoDialog, setShouldMountAddRepoDialog] = useState(false)
  const unmountAddRepoDialogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const {
    onboarding,
    setOnboarding,
    setOnboardingLoaded,
    shouldRenderOnboarding,
    onboardingSettingsDetourActive,
    beginOnboardingSettingsDetour
  } = useOnboardingAndFeatureTipsGate({
    activeView,
    activeModal,
    featureTipsSeenIds,
    featureInteractions,
    contextualToursAutoEligible,
    persistedUIReady,
    settings,
    actions
  })

  useEffect(() => {
    if (activeModal === 'add-repo') {
      if (unmountAddRepoDialogTimerRef.current) {
        clearTimeout(unmountAddRepoDialogTimerRef.current)
        unmountAddRepoDialogTimerRef.current = null
      }
      setShouldMountAddRepoDialog(true)
      return
    }
    if (shouldMountAddRepoDialog && !unmountAddRepoDialogTimerRef.current) {
      // Why: AddRepoDialog's close effect aborts in-flight clone/nested work.
      // Keep one closed render, then remove hidden SSH/remote subscriptions.
      unmountAddRepoDialogTimerRef.current = setTimeout(() => {
        setShouldMountAddRepoDialog(false)
        unmountAddRepoDialogTimerRef.current = null
      }, 0)
    }
    return () => {
      if (unmountAddRepoDialogTimerRef.current) {
        clearTimeout(unmountAddRepoDialogTimerRef.current)
        unmountAddRepoDialogTimerRef.current = null
      }
    }
  }, [activeModal, shouldMountAddRepoDialog])

  // Subscribe to IPC push events
  useIpcEvents()
  useAutomationDispatchEvents()
  // Why: retention must run at App level so the inline per-card agents list
  // always sees retained entries. If retention ran inside the sidebar-card
  // subtree, "done" agents would vanish any time the user collapsed a card's
  // inline agents section. The retention hooks are hosted inside
  // <RetainedAgentsSyncGate /> (a leaf component that renders null) rather
  // than being called inline here so its high-churn store subscriptions
  // (agentStatusByPaneKey ticks at PTY event frequency)
  // do not re-render the App tree on every agent status update.
  // Why: git conflict-operation state also drives the worktree cards. Polling
  // cannot live under RightSidebar because App unmounts that subtree when the
  // sidebar is closed, which leaves stale "Rebasing"/"Merging" badges behind
  // until some unrelated view remount happens to refresh them.
  // Why: visible-window polling runs immediately on mount. Wait until the
  // workspace session has hydrated so git status work cannot compete with the
  // first window becoming usable.
  useGitStatusPolling({ enabled: workspaceSessionReady })
  // Why: the editor must hear external filesystem changes regardless of
  // which right-sidebar panel is visible (Explorer unmounts when the user
  // switches to Source Control or Checks). Wiring this at App level mirrors
  // VSCode's workbench-scoped `TextFileEditorModelManager`, which reloads
  // clean models from a single always-on file-change subscription instead
  // of tying reloads to the Explorer UI lifecycle.
  useEditorExternalWatch()
  useGlobalFileDrop()
  useAutoAckViewedAgent()

  // Why: sidebar open/close flips width instantaneously. useLayoutEffect
  // runs synchronously after React commits the DOM but before paint, so
  // dispatching SYNC_FIT_PANES_EVENT here lets the terminal reflow in the
  // same frame as the width change — no "wrongly-sized terminal" transient
  // and no delayed snap. The later ResizeObserver rAF and 150ms debounced
  // fit both become no-ops because proposeDimensions() will match the
  // already-fitted cols/rows.
  useLayoutEffect(() => {
    window.dispatchEvent(new CustomEvent(SYNC_FIT_PANES_EVENT))
  }, [sidebarOpen, rightSidebarOpen])

  useWorkspaceStartupHydration({ actions, setOnboarding, setOnboardingLoaded })

  useAppLifecyclePersistence(workspaceSessionReady)

  // Why there is no periodic scrollback save: PR #461 added a 3-minute
  // setInterval that re-serialized every mounted TerminalPane's scrollback
  // so a crash wouldn't lose in-session output. With many panes of
  // accumulated output, each tick blocked the renderer main thread for
  // several seconds (serialize is synchronous and does a binary search on
  // >512KB buffers), causing visible input lag across the whole app.
  // The durable replacement is the out-of-process terminal daemon
  // (PR #729), which preserves buffers across renderer crashes with no
  // main-thread work. Non-daemon users lose in-session scrollback on an
  // unexpected exit — an acceptable tradeoff vs. periodic UI stalls, and
  // in line with how most terminal apps behave.

  usePersistedUiStateWriter({
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
  })

  useAppearanceSync(settings)

  // Refresh GitHub data (PR/issue status) when window regains focus
  useEffect(() => {
    const handler = (): void => {
      if (document.visibilityState === 'visible') {
        actions.refreshAllGitHub()
        actions.bumpGitHubPRVisibleRefreshGeneration()
      } else {
        actions.reportVisibleGitHubPRRefreshCandidates([], Date.now())
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [actions])

  const hasTabBar = tabCount >= 2
  const showTitlebarExpandButton = workspaceChromeActive && !hasTabBar && effectiveActiveTabExpanded
  // Why: Activity and Space are full-page navigation surfaces — same
  // treatment as Settings — so the worktree sidebar is removed for those views.
  // Why: Skills and Knowledge keep the persistent left sidebar (and collapse to
  // full-width) like the Agents page, so the main nav surfaces behave the same.
  const showSidebar =
    activeView !== 'settings' && activeView !== 'activity' && activeView !== 'space'
  // Why: Tasks/Landing keep the full titlebar only when the sidebar is
  // collapsed; with it open, mirror workspace view so titlebar-left sits flush
  // above nav. Creation layout suppresses the full-width titlebar.
  const stackedSidebarOpen =
    !workspaceChromeActive && !creationLayoutActive && showSidebar && sidebarOpen
  // Why: visible creation keeps only the top-left window chrome; workspace tabs
  // and right-sidebar chrome remain gated by workspaceChromeActive.
  const leftTitlebarChromeLayout = resolveLeftTitlebarChromeLayout({
    workspaceChromeActive,
    stackedSidebarOpen,
    creationLayoutActive,
    sidebarOpen
  })
  // Why: suppress right sidebar controls on full-page navigation surfaces
  // since those surfaces intentionally own the full content area.
  const showRightSidebarControls = !creationLayoutActive && canShowRightSidebarForView(activeView)

  const handleToggleExpand = (): void => {
    if (!effectiveActiveTabId) {
      return
    }
    window.dispatchEvent(
      new CustomEvent(TOGGLE_TERMINAL_PANE_EXPAND_EVENT, {
        detail: { tabId: effectiveActiveTabId }
      })
    )
  }

  useGlobalKeyboardShortcuts({
    activeView,
    activeWorktreeId,
    actions,
    floatingTerminalEnabled,
    floatingTerminalOpen,
    floatingVisibleTabCount,
    keybindings,
    terminalShortcutPolicy: settings?.terminalShortcutPolicy,
    setFloatingTerminalOpenWithFocus,
    workspaceChromeActive,
    creationLayoutActive,
    shortcutPlatform
  })

  const {
    titlebarLeftControlsRef,
    titlebarRightClusterRef,
    collapsedSidebarHeaderWidth,
    titlebarRightClusterWidth
  } = useTitlebarChromeMeasurements({
    isFullScreen,
    showTitlebarAppName: settings?.showTitlebarAppName,
    showSidebar,
    leftTitlebarChromeIsFloating: leftTitlebarChromeLayout.isFloating,
    sidebarOpen,
    workspaceChromeActive,
    rightSidebarOpen
  })

  const resolvedMountedLazyModalIds = resolveMountedLazyModalIds(activeModal, mountedLazyModalIds)
  if (resolvedMountedLazyModalIds !== mountedLazyModalIds) {
    // Why: lazy-load these modals only after first use, then keep them mounted
    // so repeat opens preserve their local state and avoid re-fetch flashes.
    setMountedLazyModalIds(new Set(resolvedMountedLazyModalIds))
  }

  const titlebarLeftControls = (
    <AppTitlebarLeftControls
      titlebarLeftControlsRef={titlebarLeftControlsRef}
      isFloating={leftTitlebarChromeLayout.isFloating}
      isMac={isMac}
      isFullScreen={isFullScreen}
      hasCustomTitleBar={hasCustomTitleBar}
      showSidebar={showSidebar}
      showTitlebarAppName={settings?.showTitlebarAppName}
      toggleSidebar={actions.toggleSidebar}
      updateSettings={actions.updateSettings}
      leftSidebarShortcutLabel={leftSidebarShortcutLabel}
      activeView={activeView}
      historyBackShortcutLabel={historyBackShortcutLabel}
      historyForwardShortcutLabel={historyForwardShortcutLabel}
      canGoBackWorktree={canGoBackWorktree}
      canGoForwardWorktree={canGoForwardWorktree}
    />
  )

  const titlebarMainStrip = (
    <AppTitlebarMainStrip
      activeView={activeView}
      creationLayoutActive={creationLayoutActive}
      workspaceChromeActive={workspaceChromeActive}
      showTitlebarExpandButton={showTitlebarExpandButton}
      onToggleExpand={handleToggleExpand}
      activeTabCanExpand={activeTabCanExpand}
      rightSidebarOpen={rightSidebarOpen}
      hasCustomTitleBar={hasCustomTitleBar}
      showRightSidebarControls={showRightSidebarControls}
      onToggleRightSidebar={actions.toggleRightSidebar}
      rightSidebarShortcutLabel={rightSidebarShortcutLabel}
    />
  )

  return (
    <div
      ref={setAppRootNode}
      className="flex flex-col h-dvh w-screen overflow-hidden"
      style={
        {
          '--collapsed-sidebar-header-width': `${collapsedSidebarHeaderWidth}px`,
          // Why: consumed by anything that needs to avoid the fixed-position
          // window-controls overlay on Windows/Linux (floating sidebar toggle,
          // right sidebar header, etc.) without hardcoding 138px in multiple
          // places.
          '--window-controls-width': hasCustomTitleBar ? '138px' : '0px',
          // Why: consumed by the side-position activity bar to push icons below
          // the fixed-position window-controls overlay on Windows/Linux.
          '--window-controls-height': hasCustomTitleBar ? '36px' : '0px',
          // Why: measured width of the floating top-right button cluster; the
          // rightmost pane's tab strip reserves this so tabs don't slide under it.
          '--titlebar-right-cluster-width': `${titlebarRightClusterWidth}px`
        } as React.CSSProperties
      }
    >
      <TooltipProvider delayDuration={400}>
        <ConfirmationDialogProvider>
          <LinkRoutingPreferenceDialogProvider>
            <WorkspacePortScanner enabled={workspaceSessionReady} />
            {/* Why: leaf-mounted retention sync keeps agent-status retention
            subscriptions from re-rendering the App tree. */}
            <RetainedAgentsSyncGate />
            <AgentHibernationGate />
            {/* Why: workspace activation is a hot path; including activeWorktreeId
            in reset keys remounts whole surfaces during wake. */}
            <AppWorkspaceShell
              activeView={activeView}
              leftTitlebarChromeLayout={leftTitlebarChromeLayout}
              titlebarLeftControls={titlebarLeftControls}
              titlebarMainStrip={titlebarMainStrip}
              showSidebar={showSidebar}
              sidebarOpen={sidebarOpen}
              leftSidebarStyle={leftSidebarStyle}
              worktreeSidebarScrollOffsetRef={worktreeSidebarScrollOffsetRef}
              worktreeSidebarScrollAnchorRef={worktreeSidebarScrollAnchorRef}
              stackedSidebarOpen={stackedSidebarOpen}
              workspaceChromeActive={workspaceChromeActive}
              rightSidebarOpen={rightSidebarOpen}
              titlebarRightClusterRef={titlebarRightClusterRef}
              showRightSidebarControls={showRightSidebarControls}
              onToggleRightSidebar={actions.toggleRightSidebar}
              rightSidebarShortcutLabel={rightSidebarShortcutLabel}
              shouldMountTerminalWorkbench={shouldMountTerminalWorkbench}
              terminalWorkbenchVisible={terminalWorkbenchVisible}
              creationLayoutActive={creationLayoutActive}
              activePendingCreationId={activePendingCreationId}
              activeWorktreeId={activeWorktreeId}
              shouldMountCommunications={shouldMountCommunications}
              showFloatingTerminalButton={showFloatingTerminalButton}
              floatingTerminalOpen={floatingTerminalOpen}
              setFloatingTerminalOpenWithFocus={setFloatingTerminalOpenWithFocus}
              rightSidebarTab={rightSidebarTab}
              rightSidebarExplorerView={rightSidebarExplorerView}
            />
            {shouldMountFloatingTerminalPanel ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="overlay.floating-workspace"
                  surface="overlay"
                  resetKey={floatingTerminalOpen}
                  compact
                  title={translate('auto.App.1b3024bcd6', 'The floating workspace hit an error.')}
                  description={translate(
                    'auto.App.7cbfbf622f',
                    'Retry the floating workspace or close and reopen it.'
                  )}
                >
                  <FloatingTerminalPanel
                    open={floatingTerminalOpen}
                    onOpenChange={setFloatingTerminalOpenWithFocus}
                    tourInteractionSnapshot={floatingWorkspaceTourInteractionSnapshotRef.current}
                  />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            {statusBarVisible ? (
              <Suspense
                fallback={
                  <div className="h-6 min-h-[24px] shrink-0 border-t border-border bg-[var(--bg-titlebar,var(--card))]" />
                }
              >
                <RecoverableRenderErrorBoundary
                  boundaryId="overlay.status-bar"
                  surface="overlay"
                  resetKey={activeView}
                  compact
                  title={translate('auto.App.2e8ff36f94', 'The status bar hit an error.')}
                  description={translate(
                    'auto.App.8a023cea1f',
                    'Retry the status bar to remount its controls.'
                  )}
                >
                  <StatusBar floatingTerminalOpen={floatingTerminalOpen} />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            {/* Why: workspace creation is a core action; keeping it in the
            entry bundle avoids stale/corrupt lazy chunks stranding users at Create. */}
            {activeModal === 'new-workspace-composer' ? (
              <RecoverableRenderErrorBoundary
                boundaryId="modal.new-workspace-composer"
                surface="modal"
                resetKey
                compact
              >
                <NewWorkspaceComposerModal />
              </RecoverableRenderErrorBoundary>
            ) : null}
            <Suspense fallback={null}>
              {shouldMountAddRepoDialog ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.add-repo"
                  surface="modal"
                  resetKey={activeModal === 'add-repo'}
                  compact
                >
                  <AddRepoDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {/* Why: Settings can start Add Project without mounting Sidebar,
              so Add Project handoff dialogs must share the root host. */}
              {activeModal === 'confirm-non-git-folder' ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.confirm-non-git-folder"
                  surface="modal"
                  resetKey
                  compact
                >
                  <NonGitFolderDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {activeModal === 'confirm-add-project-from-folder' ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.confirm-add-project-from-folder"
                  surface="modal"
                  resetKey
                  compact
                >
                  <AddProjectFromFolderDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {activeModal === 'project-added' ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.project-added"
                  surface="modal"
                  resetKey
                  compact
                >
                  <ProjectAddedDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
            </Suspense>
            {/* Why: root overlays can render Radix <Tooltip>s; keep them inside
            the shared provider so lazy surfaces mount safely from any entry point. */}
            <Suspense fallback={null}>
              {resolvedMountedLazyModalIds.has('workspace-cleanup') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.workspace-cleanup"
                  surface="modal"
                  resetKey={activeModal === 'workspace-cleanup'}
                  compact
                >
                  <WorkspaceCleanupDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
            </Suspense>
            <Suspense fallback={null}>
              {resolvedMountedLazyModalIds.has('quick-open') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.quick-open"
                  surface="modal"
                  resetKey={activeModal === 'quick-open'}
                  compact
                >
                  <QuickOpen />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {resolvedMountedLazyModalIds.has('worktree-palette') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.worktree-palette"
                  surface="modal"
                  resetKey={activeModal === 'worktree-palette'}
                  compact
                >
                  <WorktreeJumpPalette />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {resolvedMountedLazyModalIds.has('setup-guide') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.setup-guide"
                  surface="modal"
                  resetKey={activeModal === 'setup-guide'}
                  compact
                >
                  <SetupGuideModal />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {resolvedMountedLazyModalIds.has('feature-wall') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.feature-wall"
                  surface="modal"
                  resetKey={activeModal === 'feature-wall'}
                  compact
                >
                  <FeatureWallModal />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {resolvedMountedLazyModalIds.has('feature-tips') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.feature-tips"
                  surface="modal"
                  resetKey={activeModal === 'feature-tips'}
                  compact
                >
                  <FeatureTipsModal />
                </RecoverableRenderErrorBoundary>
              ) : null}
            </Suspense>
            {shouldMountSetupGuideTelemetryObserver ? (
              <Suspense fallback={null}>
                <SetupGuideTelemetryObserver />
              </Suspense>
            ) : null}
            {shouldMountContextualTourOverlay ? (
              <Suspense fallback={null}>
                <ContextualTourOverlay />
              </Suspense>
            ) : null}
            {/* Why: mount PetOverlay only after persisted UI hydration, with
          both independent pet toggles allowing it; otherwise a hidden pet
          flashes while the store still has default visibility. */}
            {renderPetOverlay ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="overlay.pet"
                  surface="overlay"
                  resetKey={petVisible}
                  compact
                >
                  <PetOverlay />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            {shouldMountUpdateCard ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="overlay.update-card"
                  surface="overlay"
                  resetKey={activeView}
                  compact
                >
                  <UpdateCard />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            {/* Why: the existing-user opt-in banner mounts at App root so it
          renders once per renderer session, not per view. It gates
          internally on the cohort markers populated by the migration,
          so it only shows for users who installed before the telemetry
          release and have not yet resolved consent. New users get no
          first-launch surface — see telemetry-plan.md §First-launch
          experience. */}
            <RecoverableRenderErrorBoundary
              boundaryId="overlay.telemetry-first-launch"
              surface="overlay"
              resetKey={settings?.telemetry?.optedIn ?? 'unknown'}
              compact
            >
              <TelemetryFirstLaunchSurface />
            </RecoverableRenderErrorBoundary>
            <RecoverableRenderErrorBoundary
              boundaryId="overlay.zoom"
              surface="overlay"
              resetKey={activeView}
              compact
            >
              <ZoomOverlay />
            </RecoverableRenderErrorBoundary>
            <Suspense fallback={null}>
              {activeModal === 'delete-worktree' ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.delete-worktree"
                  surface="modal"
                  resetKey
                  compact
                >
                  <DeleteWorktreeDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
            </Suspense>
            {hasSshCredentialRequest ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.ssh-passphrase"
                  surface="modal"
                  resetKey={activeModal}
                  compact
                >
                  <SshPassphraseDialog />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            <RecoverableRenderErrorBoundary
              boundaryId="modal.markdown-template-picker"
              surface="modal"
              resetKey={activeModal}
              compact
            >
              <MarkdownTemplatePicker />
            </RecoverableRenderErrorBoundary>
            <RecoverableRenderErrorBoundary
              boundaryId="modal.crash-report"
              surface="modal"
              reportAsCrash={false}
              resetKey={activeModal}
              compact
              title={translate('auto.App.722d03aa62', 'The crash report dialog hit an error.')}
              description={translate(
                'auto.App.acd66311dc',
                'Use the Help menu after retrying if you still need diagnostics.'
              )}
            >
              <CrashReportDialog />
            </RecoverableRenderErrorBoundary>
            {onboarding && shouldRenderOnboarding && !onboardingSettingsDetourActive ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.onboarding"
                  surface="modal"
                  resetKey={onboardingSettingsDetourActive}
                  title={translate('auto.App.f02d37278a', 'Onboarding hit an error.')}
                  description={translate(
                    'auto.App.221a95ba38',
                    'Retry onboarding or close it and continue in the app.'
                  )}
                >
                  <OnboardingFlow
                    onboarding={onboarding}
                    onOnboardingChange={setOnboarding}
                    onSettingsDetourStart={beginOnboardingSettingsDetour}
                  />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            {shouldMountDictationController ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="overlay.dictation"
                  surface="overlay"
                  resetKey={activeView}
                  compact
                >
                  <DictationController hideOwnOrb={showFloatingTerminalButton} />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            <RecoverableRenderErrorBoundary
              boundaryId="overlay.recent-tab-switcher"
              surface="overlay"
              resetKey={activeView}
              compact
            >
              <RecentTabSwitcher />
            </RecoverableRenderErrorBoundary>
          </LinkRoutingPreferenceDialogProvider>
        </ConfirmationDialogProvider>
      </TooltipProvider>
      <Toaster closeButton toastOptions={{ className: 'font-sans text-sm' }} />
      <PinnedTabCloseDialog />
      {/* Why: rendered last so it sits after all -webkit-app-region:drag elements
          in DOM order. Electron's hit-test for drag regions is DOM-order-based and
          ignores z-index — placing WindowControls earlier caused the drag region to
          win, making the buttons unclickable. */}
      {hasCustomTitleBar && <WindowControls />}
    </div>
  )
}

export default App
