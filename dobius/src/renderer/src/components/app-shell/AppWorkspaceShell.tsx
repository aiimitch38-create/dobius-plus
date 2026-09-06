import { Suspense, type ReactNode, type RefObject, type SetStateAction } from 'react'
import type { AppState } from '@/store'
import type { VirtualizedScrollAnchor } from '../../hooks/useVirtualizedScrollAnchor'
import type { LeftTitlebarChromeLayout } from '@/lib/titlebar-left-chrome'
import { RecoverableRenderErrorBoundary } from '../error-boundaries/RecoverableRenderErrorBoundary'
import { translate } from '@/i18n/i18n'
import Sidebar from '../Sidebar'
import RightSidebar from '../right-sidebar'
import { FloatingTerminalToggleButton } from '../floating-terminal/FloatingTerminalToggleButton'
import { DobiusTitlebarButtons } from '../DobiusTitlebarButtons'
import { AppRightSidebarToggleButton } from './AppTitlebarChrome'
import { AgentsHubSubNav, isAgentsHubView } from '../agents-hub/AgentsHubSubNav'
import { AgentsOverview } from '../agents-hub/AgentsOverview'
import {
  Landing,
  WorktreeCreationPanel,
  TaskPage,
  AutomationsPage,
  ActivityPrototypePage,
  Settings,
  SkillsPage,
  AgentsPage,
  BuzzPage,
  WorkspaceSpacePage,
  MobilePage,
  Terminal
} from '../../app-lazy-pages'

export type AppWorkspaceShellProps = {
  activeView: AppState['activeView']
  leftTitlebarChromeLayout: LeftTitlebarChromeLayout
  titlebarLeftControls: ReactNode
  titlebarMainStrip: ReactNode
  showSidebar: boolean
  sidebarOpen: boolean
  leftSidebarStyle: React.CSSProperties | undefined
  worktreeSidebarScrollOffsetRef: RefObject<number>
  worktreeSidebarScrollAnchorRef: RefObject<VirtualizedScrollAnchor | null>
  stackedSidebarOpen: boolean
  workspaceChromeActive: boolean
  rightSidebarOpen: boolean
  titlebarRightClusterRef: RefObject<HTMLDivElement | null>
  showRightSidebarControls: boolean
  onToggleRightSidebar: () => void
  rightSidebarShortcutLabel: string
  shouldMountTerminalWorkbench: boolean
  terminalWorkbenchVisible: boolean
  creationLayoutActive: boolean
  activePendingCreationId: string | null
  activeWorktreeId: string | null
  shouldMountCommunications: boolean
  showFloatingTerminalButton: boolean
  floatingTerminalOpen: boolean
  setFloatingTerminalOpenWithFocus: (nextOpen: SetStateAction<boolean>) => void
  rightSidebarTab: AppState['rightSidebarTab']
  rightSidebarExplorerView: AppState['rightSidebarExplorerView']
}

// Why: the primary workspace layout (titlebar + left worktree sidebar +
// terminal/page content + right sidebar). Extracted from App as one unit
// because it shares a single top-level error boundary (boundaryId
// "app.workspace-shell") — splitting it further would mean either
// duplicating that boundary or breaking its reset semantics.
export function AppWorkspaceShell({
  activeView,
  leftTitlebarChromeLayout,
  titlebarLeftControls,
  titlebarMainStrip,
  showSidebar,
  sidebarOpen,
  leftSidebarStyle,
  worktreeSidebarScrollOffsetRef,
  worktreeSidebarScrollAnchorRef,
  stackedSidebarOpen,
  workspaceChromeActive,
  rightSidebarOpen,
  titlebarRightClusterRef,
  showRightSidebarControls,
  onToggleRightSidebar,
  rightSidebarShortcutLabel,
  shouldMountTerminalWorkbench,
  terminalWorkbenchVisible,
  creationLayoutActive,
  activePendingCreationId,
  activeWorktreeId,
  shouldMountCommunications,
  showFloatingTerminalButton,
  floatingTerminalOpen,
  setFloatingTerminalOpenWithFocus,
  rightSidebarTab,
  rightSidebarExplorerView
}: AppWorkspaceShellProps): React.JSX.Element {
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="app.workspace-shell"
      surface="workspace-shell"
      resetKey={activeView}
      title={translate('auto.App.df1d56bf87', 'The workspace shell hit an error.')}
      description={translate(
        'auto.App.8504ddf267',
        'The app is still running. Retry the shell or use the menu to report the crash details.'
      )}
    >
      <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
        {/* Why: the non-workspace titlebar lives inside this left+center
      wrapper so it does not span over the right-sidebar column —
      when the right sidebar is open, its own header anchors at the
      top alongside the titlebar instead of being pushed below it. */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Why: in workspace view (split groups always enabled), the
        full-width titlebar is removed so tab groups + terminal extend
        to the top of the window. Left titlebar controls move to a
        header above the sidebar. Settings, landing, and the tasks
        page keep the titlebar. */}
          {!leftTitlebarChromeLayout.shouldMount ? (
            <div className="titlebar">
              <div className="flex items-center shrink-0 mr-2">{titlebarLeftControls}</div>
              {titlebarMainStrip}
            </div>
          ) : null}
          <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
            {showSidebar ? (
              leftTitlebarChromeLayout.shouldMount ? (
                /* Why: left column wraps the sidebar with a titlebar-height
             header above it. The header holds the same controls
             (traffic lights, sidebar toggle, "Dobius+" title, agent badge)
             that the full-width titlebar held while the center and right
             columns keep their own top strips at the same 36px height.
             When the sidebar is collapsed, take this header out of flex
             layout so the terminal/editor reclaim the left edge instead of
             leaving behind a content-width blank strip. */
                <div
                  className={`flex min-h-0 flex-col shrink-0${sidebarOpen ? '' : ' relative w-0 overflow-visible'}`}
                >
                  <div
                    // Why: when the sidebar is collapsed, titlebar-left floats
                    // absolutely on top of the center column's own `border-l`
                    // (see TabGroupSplitLayout), occluding that seam. Add a
                    // `border-r` in the floating state so the vertical line
                    // between the traffic-light/nav cluster and the tab strip
                    // stays visible in both states. w-max keeps the floating
                    // header sized to its own controls instead of the w-0
                    // sidebar wrapper.
                    className={`titlebar-left${
                      leftTitlebarChromeLayout.isFloating
                        ? ' titlebar-left-floating absolute top-0 left-0 z-10 w-max border-r border-border'
                        : ''
                    }`}
                    style={{
                      // Why: custom sidebar appearances are scoped to the sidebar
                      // root, so mirror those variables onto the open header that
                      // visually belongs to the same left-column panel.
                      ...(sidebarOpen ? leftSidebarStyle : undefined),
                      // Why: the Sidebar resize hook updates the sidebar DOM width
                      // directly during drag and only persists to Zustand on
                      // mouseup. In workspace view, size this header from the
                      // wrapper's live width so it tracks those in-flight resizes
                      // instead of leaving a stale-width gap until the drag ends.
                      width: sidebarOpen ? '100%' : undefined
                    }}
                  >
                    {titlebarLeftControls}
                  </div>
                  <div className="flex min-h-0 flex-1">
                    {/* Why: the workspace-view wrapper adds a fixed 36px header
                  above the sidebar. Without a flex-1/min-h-0 slot here,
                  the sidebar falls back to its content height, so the
                  worktree list loses its scroll viewport and the fixed
                  bottom toolbar (including Add Project) gets pushed offscreen. */}
                    <RecoverableRenderErrorBoundary
                      boundaryId="sidebar.worktrees"
                      surface="sidebar"
                      resetKey={activeView}
                      title={translate('auto.App.1468601e7b', 'The workspace list hit an error.')}
                      description={translate(
                        'auto.App.bdc71dddc9',
                        'The active workspace remains open. Retry the list or switch views.'
                      )}
                    >
                      <Sidebar
                        worktreeScrollOffsetRef={worktreeSidebarScrollOffsetRef}
                        worktreeScrollAnchorRef={worktreeSidebarScrollAnchorRef}
                      />
                    </RecoverableRenderErrorBoundary>
                  </div>
                </div>
              ) : (
                <RecoverableRenderErrorBoundary
                  boundaryId="sidebar.worktrees"
                  surface="sidebar"
                  resetKey={activeView}
                  title={translate('auto.App.1468601e7b', 'The workspace list hit an error.')}
                  description={translate(
                    'auto.App.cba0fafda5',
                    'The active page remains open. Retry the list or switch views.'
                  )}
                >
                  <Sidebar
                    worktreeScrollOffsetRef={worktreeSidebarScrollOffsetRef}
                    worktreeScrollAnchorRef={worktreeSidebarScrollAnchorRef}
                  />
                </RecoverableRenderErrorBoundary>
              )
            ) : null}
            {/* Why: under the Buzz skin this column renders as a rounded
                floating card over the gradient canvas (buzz-skin.css). */}
            <div
              data-buzz-content-surface
              className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden"
            >
              {stackedSidebarOpen ? <div className="titlebar">{titlebarMainStrip}</div> : null}
              <div className="relative flex flex-1 min-w-0 min-h-0 overflow-hidden">
                {/* Why: right sidebar toggle floats at the top-right of the center
            column so it's always accessible whether the right sidebar is
            open or closed. Match the RightSidebar header's 36px height and
            top-0 anchor so the icon's vertical center is identical between
            open and closed states — otherwise toggling makes the icon jump
            a few pixels, which reads as layout jitter. */}
                {workspaceChromeActive && !rightSidebarOpen && (
                  <div
                    ref={titlebarRightClusterRef}
                    className="absolute top-0 z-10 flex items-center h-[36px]"
                    style={
                      {
                        // Why: right: var(--window-controls-width) is the single
                        // mechanism that keeps the toggle clear of the
                        // fixed-position window-controls overlay on custom desktop
                        // chrome (138px) and sits at the right edge otherwise (0px).
                        // No internal spacer needed — adding one would push the button
                        // a further 138px to the left and cover the pane-actions
                        // Ellipsis button with an un-clickable div.
                        right: 'var(--window-controls-width)',
                        WebkitAppRegion: 'no-drag'
                      } as React.CSSProperties
                    }
                  >
                    <DobiusTitlebarButtons />
                    <AppRightSidebarToggleButton
                      show={showRightSidebarControls}
                      onToggle={onToggleRightSidebar}
                      shortcutLabel={rightSidebarShortcutLabel}
                    />
                  </div>
                )}
                <div className="flex flex-1 min-w-0 min-h-0 flex-col">
                  {/* Why: the Agents sub-nav sits in a FIXED child slot (null
                      when off) so the Communications element below keeps its
                      position in this children list. Adding/removing a child
                      above it would shift indices and remount the hub,
                      dropping live channels. */}
                  {isAgentsHubView(activeView) ? <AgentsHubSubNav /> : null}
                  {shouldMountTerminalWorkbench ? (
                    <div
                      className={
                        !terminalWorkbenchVisible
                          ? 'hidden flex-1 min-w-0 min-h-0'
                          : 'flex flex-1 min-w-0 min-h-0'
                      }
                    >
                      <Suspense fallback={null}>
                        <RecoverableRenderErrorBoundary
                          boundaryId="terminal.workbench"
                          surface="terminal-workbench"
                          resetKey="terminal"
                          title={translate(
                            'auto.App.5a9519aef0',
                            'The workspace workbench hit an error.'
                          )}
                          description={translate(
                            'auto.App.98d4ea2823',
                            'Terminal, browser, or editor rendering failed in this workspace. Retry to remount it.'
                          )}
                        >
                          <Terminal />
                        </RecoverableRenderErrorBoundary>
                      </Suspense>
                    </div>
                  ) : null}
                  {/* Deliberately no loading UI (Carson's call,
                      2026-09-02): pages appear when ready, the panel
                      stays blank for the brief chunk parse. A chunk
                      that REJECTS still lands in the boundary below. */}
                  <Suspense fallback={null}>
                    <RecoverableRenderErrorBoundary
                      boundaryId={`page.${activeView}`}
                      surface="page"
                      resetKey={activeView}
                      title={translate('auto.App.b7a714db1e', 'This page hit an error.')}
                      description={translate(
                        'auto.App.03a14f6b5b',
                        'Retry the page or navigate to another Dobius+ surface.'
                      )}
                    >
                      {activeView === 'settings' ? <Settings /> : null}
                      {activeView === 'skills' ? <SkillsPage /> : null}
                      {activeView === 'agents' ? <AgentsPage /> : null}
                      {activeView === 'dashboard' ? <AgentsOverview /> : null}
                      {activeView === 'tasks' ? <TaskPage /> : null}
                      {activeView === 'automations' ? <AutomationsPage /> : null}
                      {activeView === 'activity' ? <ActivityPrototypePage /> : null}
                      {activeView === 'space' ? <WorkspaceSpacePage /> : null}
                      {activeView === 'mobile' ? <MobilePage /> : null}
                      {activeView === 'terminal' &&
                      creationLayoutActive &&
                      activePendingCreationId ? (
                        <WorktreeCreationPanel
                          creationId={activePendingCreationId}
                          reserveCollapsedSidebarHeaderSpace={leftTitlebarChromeLayout.isFloating}
                        />
                      ) : null}
                      {activeView === 'terminal' && !activeWorktreeId && !creationLayoutActive ? (
                        <Landing />
                      ) : null}
                    </RecoverableRenderErrorBoundary>
                  </Suspense>
                  {/* Communications: mounted once, hidden with CSS
                      (terminal-workbench pattern). Switching tabs no
                      longer restarts the hub — it is simply revealed,
                      exactly as it was, and keeps receiving live
                      messages while hidden. */}
                  {shouldMountCommunications ? (
                    <div
                      className={
                        activeView === 'buzz'
                          ? 'flex flex-1 min-w-0 min-h-0'
                          : 'hidden flex-1 min-w-0 min-h-0'
                      }
                    >
                      <Suspense fallback={null}>
                        <RecoverableRenderErrorBoundary
                          boundaryId="page.buzz"
                          surface="page"
                          title={translate('auto.App.b7a714db1e', 'This page hit an error.')}
                          description={translate(
                            'auto.App.03a14f6b5b',
                            'Retry the page or navigate to another Dobius+ surface.'
                          )}
                        >
                          <BuzzPage />
                        </RecoverableRenderErrorBoundary>
                      </Suspense>
                    </div>
                  ) : null}
                </div>
                {showFloatingTerminalButton ? (
                  <FloatingTerminalToggleButton
                    open={floatingTerminalOpen}
                    onToggle={() => setFloatingTerminalOpenWithFocus((open) => !open)}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {/* Why: keep the right-sidebar shell mounted for layout stability.
      Its heavy panels disconnect while closed so workspace wake stays
      responsive. Unmount on the tasks view since that surface is
      intentionally distraction-free. */}
        {showRightSidebarControls ? (
          <RecoverableRenderErrorBoundary
            boundaryId="right-sidebar"
            surface="right-sidebar"
            resetKey={
              rightSidebarTab === 'explorer'
                ? `${rightSidebarTab}:${rightSidebarExplorerView}`
                : rightSidebarTab
            }
            title={translate('auto.App.ed6b168d00', 'The right sidebar hit an error.')}
            description={translate(
              'auto.App.8d1e160ed1',
              'Retry the sidebar or switch tabs to reload this surface.'
            )}
          >
            <RightSidebar />
          </RecoverableRenderErrorBoundary>
        ) : null}
      </div>
    </RecoverableRenderErrorBoundary>
  )
}
