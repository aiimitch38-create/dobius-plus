import type { RefObject } from 'react'
import { ArrowLeft, ArrowRight, Minimize2, MoreHorizontal, PanelLeft, PanelRight } from 'lucide-react'
import logo from '../../../../../resources/logo.svg'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { useAppStore } from '@/store'
import type { AppState } from '@/store'
import { shouldShowWorktreeHistoryControls } from '@/lib/titlebar-worktree-history-controls'
import { translate } from '@/i18n/i18n'
import { DobiusTitlebarButtons } from '../DobiusTitlebarButtons'
import { ActivityTitlebarControls } from '../activity/ActivityTitlebarControls'

export type AppTitlebarLeftControlsProps = {
  titlebarLeftControlsRef: RefObject<HTMLDivElement | null>
  isFloating: boolean
  isMac: boolean
  isFullScreen: boolean
  hasCustomTitleBar: boolean
  showSidebar: boolean
  showTitlebarAppName: boolean | undefined
  toggleSidebar: () => void
  updateSettings: AppState['updateSettings']
  leftSidebarShortcutLabel: string
  activeView: AppState['activeView']
  historyBackShortcutLabel: string
  historyForwardShortcutLabel: string
  canGoBackWorktree: boolean
  canGoForwardWorktree: boolean
}

// Why: extracted so both the full-width titlebar (settings/landing) and the
// sidebar-width left header (workspace view) can share the same controls
// without duplicating the agent badge popover.
export function AppTitlebarLeftControls({
  titlebarLeftControlsRef,
  isFloating,
  isMac,
  isFullScreen,
  hasCustomTitleBar,
  showSidebar,
  showTitlebarAppName,
  toggleSidebar,
  updateSettings,
  leftSidebarShortcutLabel,
  activeView,
  historyBackShortcutLabel,
  historyForwardShortcutLabel,
  canGoBackWorktree,
  canGoForwardWorktree
}: AppTitlebarLeftControlsProps): React.JSX.Element {
  return (
    // Why: measure the ENTIRE row (traffic-light pad + sidebar toggle + agent
    // badge + back/forward group) so the sidebar-collapse spacer in
    // TabGroupPanel reserves enough width to clear the full floating
    // `titlebar-left`. Measuring only the inner control cluster left the
    // back/forward arrows hanging over the first tab when the sidebar was
    // collapsed (Cmd+B), producing a half-occluded, non-scrollable tab strip.
    // Why: collapsed workspace mode floats inside a w-0 sidebar wrapper; w-max
    // prevents Windows Chromium from shrinking the app name down to one glyph.
    <div
      ref={titlebarLeftControlsRef}
      className={`flex h-full shrink-0 items-center${isFloating ? ' w-max' : ' w-full'}`}
    >
      <div className="flex h-full items-center">
        {isMac && !isFullScreen ? (
          <div className="titlebar-traffic-light-pad" />
        ) : hasCustomTitleBar ? (
          /* Why: on Windows/Linux the native title bar is removed, so we render
             the Dobius+ logo as a non-interactive identity anchor and a ··· button
             that pops up the application menu (the same menu revealed by Alt
             on the default autoHideMenuBar). */
          <>
            <img src={logo} alt="" aria-hidden className="titlebar-logo" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="titlebar-icon-button"
                  aria-label={translate('auto.App.8b0b8eb54f', 'Application menu')}
                  onClick={() => window.api.ui.popupMenu()}
                >
                  <MoreHorizontal size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {translate('auto.App.8b0b8eb54f', 'Application menu')}
              </TooltipContent>
            </Tooltip>
          </>
        ) : (
          <div className="pl-2" />
        )}
        {showSidebar && !hasCustomTitleBar && (
          <>
            {showTitlebarAppName !== false && (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    className="titlebar-app-name"
                    aria-label={translate('auto.App.5096cbbc86', 'Dobius+')}
                  >
                    <span className="titlebar-app-name-main">
                      {translate('auto.App.5096cbbc86', 'Dobius+')}
                    </span>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      void updateSettings({ showTitlebarAppName: false })
                    }}
                  >
                    {translate('auto.App.e81217c1b7', 'Hide App Name')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
          </>
        )}
        {showSidebar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle"
                onClick={toggleSidebar}
                aria-label={translate('auto.App.e4b9e7dff7', 'Toggle sidebar')}
              >
                <PanelLeft size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.App.ce37cf5279', 'Toggle sidebar ({{value0}})', {
                value0: leftSidebarShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {/* Why: Back/Forward traverse mixed worktree + page history, so the
          cluster is shown wherever the history shortcut is live. Hidden in
          Settings and non-stack page views. */}
      {shouldShowWorktreeHistoryControls(activeView) && (
        // Why: when the workspace sidebar is collapsed, this header shrink-wraps
        // and ml-auto has no spare width; keep a fixed gutter before Back.
        <div className="ml-auto mr-3 flex items-center pl-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle sidebar-toggle-compact"
                onClick={() => useAppStore.getState().goBackWorktree()}
                disabled={!canGoBackWorktree}
                aria-label={translate('auto.App.064bd07810', 'Go back')}
              >
                <ArrowLeft size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.App.fe21e8f6f5', 'Go back ({{value0}})', {
                value0: historyBackShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle sidebar-toggle-compact"
                onClick={() => useAppStore.getState().goForwardWorktree()}
                disabled={!canGoForwardWorktree}
                aria-label={translate('auto.App.cf9099fe98', 'Go forward')}
              >
                <ArrowRight size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.App.f7aa73e785', 'Go forward ({{value0}})', {
                value0: historyForwardShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

export type AppRightSidebarToggleButtonProps = {
  show: boolean
  onToggle: () => void
  shortcutLabel: string
}

export function AppRightSidebarToggleButton({
  show,
  onToggle,
  shortcutLabel
}: AppRightSidebarToggleButtonProps): React.JSX.Element | null {
  if (!show) {
    return null
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="sidebar-toggle mr-2"
          onClick={onToggle}
          aria-label={translate('auto.App.9e0b441a91', 'Toggle right sidebar')}
        >
          <PanelRight size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {translate('auto.App.c184e056de', 'Toggle right sidebar ({{value0}})', {
          value0: shortcutLabel
        })}
      </TooltipContent>
    </Tooltip>
  )
}

export type AppTitlebarMainStripProps = {
  activeView: AppState['activeView']
  creationLayoutActive: boolean
  workspaceChromeActive: boolean
  showTitlebarExpandButton: boolean
  onToggleExpand: () => void
  activeTabCanExpand: boolean
  rightSidebarOpen: boolean
  hasCustomTitleBar: boolean
  showRightSidebarControls: boolean
  onToggleRightSidebar: () => void
  rightSidebarShortcutLabel: string
}

export function AppTitlebarMainStrip({
  activeView,
  creationLayoutActive,
  workspaceChromeActive,
  showTitlebarExpandButton,
  onToggleExpand,
  activeTabCanExpand,
  rightSidebarOpen,
  hasCustomTitleBar,
  showRightSidebarControls,
  onToggleRightSidebar,
  rightSidebarShortcutLabel
}: AppTitlebarMainStripProps): React.JSX.Element {
  return (
    <>
      {activeView === 'activity' ? (
        <ActivityTitlebarControls />
      ) : creationLayoutActive ? null : (
        <div
          id="titlebar-tabs"
          className={`flex flex-1 min-w-0 self-stretch${!workspaceChromeActive ? ' invisible pointer-events-none' : ''}`}
        />
      )}
      {showTitlebarExpandButton && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="titlebar-icon-button"
              onClick={onToggleExpand}
              aria-label={translate('auto.App.c1cf0b0e4a', 'Collapse pane')}
              disabled={!activeTabCanExpand}
            >
              <Minimize2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.App.c1cf0b0e4a', 'Collapse pane')}
          </TooltipContent>
        </Tooltip>
      )}
      {/* Why: when the right sidebar is open, its own header renders
      an identical close button — hide this copy so only one is
      visible at a time. */}
      <DobiusTitlebarButtons />
      {!rightSidebarOpen && (
        <AppRightSidebarToggleButton
          show={showRightSidebarControls}
          onToggle={onToggleRightSidebar}
          shortcutLabel={rightSidebarShortcutLabel}
        />
      )}
      {/* Why: reserve space so content is not obscured by the
      fixed-position window-controls overlay on Windows/Linux. */}
      {hasCustomTitleBar && <div className="window-controls-titlebar-spacer" />}
    </>
  )
}
