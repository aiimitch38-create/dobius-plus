import React, { useState } from 'react'
import {
  ArrowLeft,
  Briefcase,
  ChevronDown,
  Folder,
  Info,
  Plus,
  Settings,
  UserRound
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { HelpMenuItems } from '@/components/sidebar/HelpMenuItems'
import { SidebarFeedbackDialog } from '@/components/sidebar/SidebarFeedbackDialog'
import WorktreeContextMenu from '@/components/sidebar/WorktreeContextMenu'
import { translate } from '@/i18n/i18n'
import { AgentIcon } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import { useWorktreeMap } from '@/store/selectors'
import { BoardRailButton } from './BoardRailButton'
import { BoardUsagePanel } from './BoardUsagePanel'
import { usageLevel, usageLevelColor } from './board-usage-levels'
import { BoardWorkspaceTabButton, type BoardWorkspaceTab } from './BoardWorkspaceTabButton'
import {
  BOARD_FLOATING_PANEL_CLASS,
  BOARD_MENU_CONTENT_CLASS,
  BOARD_MENU_ROW_CLASS,
  BOARD_MENU_SEPARATOR_CLASS,
  BOARD_MONO_CLASS,
  BOARD_PILL_BUTTON_CLASS
} from './board-surface-classes'

export type { BoardWorkspaceTab } from './BoardWorkspaceTabButton'
export type BoardProjectOption = { id: string; name: string }
export type BoardUsagePill = {
  provider: string
  usedPercent: number
  resetDescription: string | null
}

export type BoardTopBarProps = {
  projects: readonly BoardProjectOption[]
  activeProjectId: string | null
  onSelectProject: (id: string) => void
  workspaces: readonly BoardWorkspaceTab[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (id: string) => void
  onRenameWorkspace: (id: string, name: string) => void
  onAddWorkspace: () => void
  /** "Back to home": the Board-look Home screen. */
  onBackToHome: () => void
  liveCount: number
  needsYouCount: number
  /** Most-used provider rate-limit window; hidden when no provider reports usage. */
  usage: BoardUsagePill | null
  avatarLabel: string
  onOpenSkills: () => void
  onOpenSettings: () => void
  /** Avatar + usage pill: Settings opened on Accounts (sign-ins and usage limits). */
  onOpenAccounts: () => void
  /** Needs-you pill: fly the camera to the console waiting on the user. */
  onJumpToAttention: () => void
}

// Measured (LAYOUT-MAP state A): pills 30px, round controls 32px, 9–10px gaps.
const ROUND_CLASS = 'size-8'

export function BoardTopBar({
  projects,
  activeProjectId,
  onSelectProject,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onRenameWorkspace,
  onAddWorkspace,
  onBackToHome,
  liveCount,
  needsYouCount,
  usage,
  avatarLabel,
  onOpenSkills,
  onOpenSettings,
  onOpenAccounts,
  onJumpToAttention
}: BoardTopBarProps): React.JSX.Element {
  const [usageOpen, setUsageOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [showAdminOptions, setShowAdminOptions] = useState(false)
  // Why: the workspace tabs get the sidebar's right-click menu (pin, mark read,
  // sleep, delete…), which needs the full Worktree record, not the tab model.
  const worktreeMap = useWorktreeMap()
  // Why: the Board covers the whole window, so on mac the cluster must clear the
  // traffic lights (the reference starts it at x=86).
  const isMac = navigator.userAgent.includes('Mac')
  const projectName =
    projects.find((p) => p.id === activeProjectId)?.name ??
    translate('board.topBar.noProject', 'No project')
  const pill = cn(BOARD_FLOATING_PANEL_CLASS, BOARD_PILL_BUTTON_CLASS)

  return (
    <>
      <div
        className={cn(
          'pointer-events-auto absolute top-[17px] flex items-center gap-[9px]',
          isMac ? 'left-[86px]' : 'left-4'
        )}
      >
        <Button variant="ghost" className={pill} onClick={onBackToHome}>
          <ArrowLeft />
          {translate('board.topBar.backToHome', 'Back to home')}
        </Button>
        <div
          className={cn(
            BOARD_FLOATING_PANEL_CLASS,
            'flex h-9 max-w-[min(56vw,640px)] items-center gap-1 rounded-full px-[5px]'
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(BOARD_PILL_BUTTON_CLASS, 'h-[25px] shrink-0 px-2.5')}
              >
                <Folder className="text-[var(--board-text-muted)]" />
                <span className="max-w-40 truncate">{projectName}</span>
                <ChevronDown className="size-3.5 text-[var(--board-text-muted)]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={8}>
              {projects.map((project) => (
                <DropdownMenuItem key={project.id} onSelect={() => onSelectProject(project.id)}>
                  <Folder />
                  {project.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div
            role="tablist"
            aria-label={translate('board.topBar.workspaces', 'Workspaces')}
            className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
          >
            {workspaces.map((workspace) => {
              const tab = (
                <BoardWorkspaceTabButton
                  key={workspace.id}
                  workspace={workspace}
                  active={workspace.id === activeWorkspaceId}
                  onSelect={onSelectWorkspace}
                  onRename={onRenameWorkspace}
                />
              )
              const worktree = worktreeMap.get(workspace.id)
              return worktree ? (
                // Why: the menu's wrapper div is the flex item; without shrink-0 the
                // pills squash instead of the strip scrolling.
                <div key={workspace.id} className="shrink-0">
                  <WorktreeContextMenu worktree={worktree}>{tab}</WorktreeContextMenu>
                </div>
              ) : (
                tab
              )
            })}
          </div>
          <BoardRailButton
            label={translate('board.topBar.addWorkspace', 'New workspace')}
            tooltipSide="bottom"
            className="size-[27px] shrink-0"
            onClick={onAddWorkspace}
          >
            <Plus />
          </BoardRailButton>
        </div>
      </div>

      <div className="pointer-events-auto absolute top-[17px] right-[18px] flex items-center gap-[9px]">
        {needsYouCount > 0 ? (
          <button
            type="button"
            onClick={onJumpToAttention}
            title={translate('board.topBar.needsYouHint', 'Show the console that needs you')}
            className={cn(
              BOARD_FLOATING_PANEL_CLASS,
              'flex h-6 items-center gap-1.5 rounded-full bg-[var(--board-accent-tint)] px-2.5 text-[12px] font-medium tabular-nums hover:brightness-95'
            )}
          >
            <span className="size-1.5 rounded-full bg-[var(--board-accent)]" aria-hidden />
            {translate('board.topBar.needsYou', '{{count}} need you', { count: needsYouCount })}
          </button>
        ) : null}
        <div
          className={cn(
            BOARD_FLOATING_PANEL_CLASS,
            'flex h-6 items-center gap-1.5 rounded-full bg-[var(--board-status-pill)] px-2.5 text-[12px] font-medium tabular-nums'
          )}
        >
          <span className="size-1.5 rounded-full bg-[var(--board-live)]" aria-hidden />
          {translate('board.topBar.live', '{{count}} live', { count: liveCount })}
        </div>
        {usage ? (
          <BoardUsagePanel
            open={usageOpen}
            onOpenChange={setUsageOpen}
            anchor={
              <button
                type="button"
                title={translate(
                  'board.topBar.usageHint',
                  '{{percent}}% of the limit used. Click for details.',
                  {
                    percent: usage.usedPercent
                  }
                )}
                className={cn(
                  BOARD_FLOATING_PANEL_CLASS,
                  'flex h-7 items-center gap-1.5 rounded-full bg-[var(--board-status-pill)] px-2.5 text-[12px] font-medium tabular-nums hover:bg-[var(--board-panel-2)]'
                )}
                data-usage-level={usageLevel(usage.usedPercent)}
                style={
                  usageLevel(usage.usedPercent) === 'normal'
                    ? undefined
                    : { color: usageLevelColor(usageLevel(usage.usedPercent)) }
                }
              >
                <Info className="size-3.5 text-[var(--board-text-muted)]" />
                {usage.provider === 'claude' ||
                usage.provider === 'codex' ||
                usage.provider === 'gemini' ? (
                  <AgentIcon agent={usage.provider} size={13} />
                ) : null}
                {usage.resetDescription ? (
                  <>
                    <span className="text-[var(--board-text-muted)]">
                      {translate('board.topBar.resets', 'resets')}
                    </span>
                    <span className={BOARD_MONO_CLASS}>{usage.resetDescription}</span>
                  </>
                ) : (
                  translate('board.topBar.usage', '{{percent}}% used', {
                    percent: usage.usedPercent
                  })
                )}
              </button>
            }
          />
        ) : null}
        <BoardRailButton
          label={translate('board.topBar.skills', 'Skills')}
          tooltipSide="bottom"
          className={cn(BOARD_FLOATING_PANEL_CLASS, ROUND_CLASS)}
          onClick={onOpenSkills}
        >
          <Briefcase />
        </BoardRailButton>
        <BoardRailButton
          label={translate('board.topBar.settings', 'Settings')}
          tooltipSide="bottom"
          className={cn(BOARD_FLOATING_PANEL_CLASS, ROUND_CLASS)}
          onClick={onOpenSettings}
        >
          <Settings />
        </BoardRailButton>
        <DropdownMenu
          modal={false}
          onOpenChange={(open) => {
            if (!open) {
              setShowAdminOptions(false)
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <BoardRailButton
              label={translate('board.topBar.accountMenu', 'Account and help')}
              tooltipSide="bottom"
              className={cn(
                ROUND_CLASS,
                'bg-[var(--board-accent)] text-[14px] font-semibold text-[var(--board-accent-fg)] hover:bg-[var(--board-accent)] hover:text-[var(--board-accent-fg)]'
              )}
              // Why: same Option/Alt affordance as the sidebar Help menu for the admin rows.
              onPointerDown={(event) => setShowAdminOptions(event.altKey)}
            >
              {avatarLabel.slice(0, 1).toUpperCase()}
            </BoardRailButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-surface="board"
            align="end"
            sideOffset={8}
            className={cn(BOARD_MENU_CONTENT_CLASS, 'min-w-[220px]')}
          >
            <DropdownMenuItem className={BOARD_MENU_ROW_CLASS} onSelect={onOpenAccounts}>
              <UserRound />
              {translate('board.topBar.accounts', 'Accounts')}
            </DropdownMenuItem>
            <DropdownMenuSeparator className={BOARD_MENU_SEPARATOR_CLASS} />
            <HelpMenuItems
              showAdminOptions={showAdminOptions}
              onSendFeedback={() => setFeedbackOpen(true)}
              itemClassName={BOARD_MENU_ROW_CLASS}
              separatorClassName={BOARD_MENU_SEPARATOR_CLASS}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <SidebarFeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  )
}
