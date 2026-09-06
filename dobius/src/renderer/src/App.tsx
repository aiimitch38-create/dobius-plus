import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { BoardDispatchGate } from './components/kanban/BoardDispatchGate'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useIpcEvents } from './hooks/useIpcEvents'
import { useAutomationDispatchEvents } from './hooks/useAutomationDispatchEvents'
import RetainedAgentsSyncGate from './components/dashboard/RetainedAgentsSyncGate'
import { AgentHibernationGate } from './components/AgentHibernationGate'
import { useSystemPrefersDark } from './components/terminal-pane/use-system-prefers-dark'
import { useFloatingTerminalOpenState } from './hooks/useFloatingTerminalOpenState'
import { WorkspacePortScanner } from './components/ports/WorkspacePortScanner'
import { ConfirmationDialogProvider } from './components/confirmation-dialog'
import { LinkRoutingPreferenceDialogProvider } from './components/link-routing-preference-dialog'
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
import type { VirtualizedScrollAnchor } from './hooks/useVirtualizedScrollAnchor'
import { resolveMountedLazyModalIds, type LazyModalId } from './lazy-modal-mount-state'
import PinnedTabCloseDialog from './components/terminal-pane/PinnedTabCloseDialog'
import { WindowControls } from './components/app-shell/WindowControls'
import { AppTitlebarLeftControls, AppTitlebarMainStrip } from './components/app-shell/AppTitlebarChrome'
import { AppWorkspaceShell } from './components/app-shell/AppWorkspaceShell'
import { AppRootOverlays } from './components/app-shell/AppRootOverlays'
import { shouldMountUpdateCardForStatus } from '@/lib/should-mount-update-card'
import { useGlobalKeyboardShortcuts } from './hooks/useGlobalKeyboardShortcuts'
import { useWorkspaceStartupHydration } from './hooks/useWorkspaceStartupHydration'
import { useOnboardingAndFeatureTipsGate } from './hooks/useOnboardingAndFeatureTipsGate'
import { useTitlebarChromeMeasurements } from './hooks/useTitlebarChromeMeasurements'
import { usePersistedUiStateWriter } from './hooks/usePersistedUiStateWriter'
import { useAppearanceSync } from './hooks/useAppearanceSync'
import { useAppLifecyclePersistence } from './hooks/useAppLifecyclePersistence'
import { useAppActions } from './hooks/useAppActions'
import { useAppShellStoreState } from './hooks/useAppShellStoreState'
import { useStickyMount } from './hooks/useStickyMount'
import { useAddRepoDialogMountGate } from './hooks/useAddRepoDialogMountGate'

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
  const actions = useAppActions()
  const {
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
  } = useAppShellStoreState()
  // Why: App swaps the sidebar between workspace and landing layouts when the
  // active workspace is slept/deleted. Keep virtualized scroll memory above
  // that remount so the left workspace list doesn't restart at scrollTop 0.
  const worktreeSidebarScrollOffsetRef = useRef(0)
  const worktreeSidebarScrollAnchorRef = useRef<VirtualizedScrollAnchor>(null)
  const leftSidebarShortcutLabel = useShortcutLabel('sidebar.left.toggle')
  const rightSidebarShortcutLabel = useShortcutLabel('sidebar.right.toggle')
  const historyBackShortcutLabel = useShortcutLabel('worktree.history.back')
  const historyForwardShortcutLabel = useShortcutLabel('worktree.history.forward')
  const showFloatingTerminalButton =
    floatingTerminalEnabled &&
    (floatingTerminalTriggerLocation === 'floating-button' || !statusBarVisible)
  // Why: skip the terminal bundle on the no-workspace landing path, but once a
  // workspace has mounted, keep Terminal-owned hidden panes alive through sleep
  // and shutdown transitions where activeWorktreeId can briefly become null.
  const shouldMountTerminalWorkbench = useStickyMount(activeWorktreeId !== null)
  // Communications follows the terminal-workbench rule: once opened it stays
  // MOUNTED and is hidden with CSS. Remounting it on every tab switch re-ran
  // the whole comms boot (loading flash, relay resubscribe, cache refill) and
  // dropped live message delivery while the user was on other tabs.
  const shouldMountCommunications = useStickyMount(activeView === 'buzz')
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

  const shouldMountContextualTourOverlay = activeContextualTourId !== null
  const shouldMountSetupGuideTelemetryObserver = persistedUIReady
  const shouldMountUpdateCard = shouldMountUpdateCardForStatus(updateStatus)
  const systemPrefersDark = useSystemPrefersDark()
  const leftSidebarStyle = useMemo(
    () => resolveLeftSidebarStyleVariables(settings, systemPrefersDark),
    [settings, systemPrefersDark]
  ) as React.CSSProperties | undefined
  const shouldMountDictationController =
    settings?.voice?.enabled === true || dictationState !== 'idle'
  const primarySelectionMiddleClickPaste = resolvePrimarySelectionMiddleClickPaste(
    settings?.primarySelectionMiddleClickPaste
  )
  usePrimarySelectionPaste(primarySelectionMiddleClickPaste)
  useAppMenuPaste()
  useLargeTextControlPaste()
  const renderPetOverlay = shouldRenderPetOverlay({
    persistedUIReady,
    petEnabled,
    petVisible
  })
  const [mountedLazyModalIds, setMountedLazyModalIds] = useState<Set<LazyModalId>>(() => new Set())
  const shouldMountAddRepoDialog = useAddRepoDialogMountGate(activeModal)
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

  useAppLifecyclePersistence(workspaceSessionReady, actions)

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
            <AppRootOverlays
              shouldMountFloatingTerminalPanel={shouldMountFloatingTerminalPanel}
              floatingTerminalOpen={floatingTerminalOpen}
              setFloatingTerminalOpenWithFocus={setFloatingTerminalOpenWithFocus}
              floatingWorkspaceTourInteractionSnapshotRef={floatingWorkspaceTourInteractionSnapshotRef}
              statusBarVisible={statusBarVisible}
              activeView={activeView}
              activeModal={activeModal}
              shouldMountAddRepoDialog={shouldMountAddRepoDialog}
              resolvedMountedLazyModalIds={resolvedMountedLazyModalIds}
              shouldMountSetupGuideTelemetryObserver={shouldMountSetupGuideTelemetryObserver}
              shouldMountContextualTourOverlay={shouldMountContextualTourOverlay}
              renderPetOverlay={renderPetOverlay}
              petVisible={petVisible}
              shouldMountUpdateCard={shouldMountUpdateCard}
              telemetryOptedIn={settings?.telemetry?.optedIn}
              hasSshCredentialRequest={hasSshCredentialRequest}
              onboarding={onboarding}
              shouldRenderOnboarding={shouldRenderOnboarding}
              onboardingSettingsDetourActive={onboardingSettingsDetourActive}
              setOnboarding={setOnboarding}
              beginOnboardingSettingsDetour={beginOnboardingSettingsDetour}
              shouldMountDictationController={shouldMountDictationController}
              showFloatingTerminalButton={showFloatingTerminalButton}
            />
          </LinkRoutingPreferenceDialogProvider>
        </ConfirmationDialogProvider>
      </TooltipProvider>
      <BoardDispatchGate enabled={settings?.vertexAutoModeEnabled === true} />
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
