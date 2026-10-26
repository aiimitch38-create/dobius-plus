import React, { useEffect, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { ActiveRightSidebarTab } from '@/store/slices/editor'
import { useRepoById } from '@/store/selectors'
import { isFolderRepo } from '../../../../../shared/repo-kind'
import { parseWorkspaceKey } from '../../../../../shared/workspace-scope'
import type { BoardStudioId } from './board-studio-ids'
import {
  AiVaultPanel,
  AsanaTasksPanel,
  AutomationsPage,
  ChecksPanel,
  FolderWorkspacePrChecksPanel,
  MobilePage,
  PortsPanel,
  PromptsPanel,
  SourceControl,
  TaskPage
} from './board-studio-lazy-pages'
import { SourceControlWorkspacesView } from './SourceControlWorkspacesView'
import { StudioEmptyState } from './StudioEmptyState'
import { useStudioCloseOverride } from './use-studio-close-override'

// Right-sidebar tabs that a hosted panel may navigate to (SourceControl jumps
// to Checks, a PR Checks row opens a child's Checks). On the Board that tab
// change becomes a studio change.
const STUDIO_FOR_SIDEBAR_TAB: Partial<Record<ActiveRightSidebarTab, BoardStudioId>> = {
  'source-control': 'source-control',
  checks: 'checks',
  'pr-checks': 'checks',
  ports: 'ports',
  prompts: 'prompts',
  vault: 'vault',
  tasks: 'asana-tasks'
}

/** Follows in-panel sidebar navigation while a hosted panel studio is open. */
function useFollowSidebarTab(): void {
  const previousTab = useRef(useAppStore.getState().rightSidebarTab)
  useEffect(
    () =>
      useAppStore.subscribe((state) => {
        const tab = state.rightSidebarTab
        if (tab === previousTab.current) {
          return
        }
        previousTab.current = tab
        const studio = STUDIO_FOR_SIDEBAR_TAB[tab]
        if (studio && state.boardStudio && state.boardStudio !== studio) {
          state.setBoardStudio(studio)
        }
      }),
    []
  )
}

// Same container the Classic right sidebar gives its panels.
function PanelFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  useFollowSidebarTab()
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
}

export function SourceControlStudio({
  worktreeId
}: {
  worktreeId: string | null
}): React.JSX.Element {
  if (!worktreeId) {
    return (
      <StudioEmptyState
        title={translate('board.studio.noWorkspace', 'Open a workspace to use this panel.')}
      />
    )
  }
  return (
    <PanelFrame>
      <SourceControlWorkspacesView worktreeId={worktreeId}>
        <SourceControl isVisible />
      </SourceControlWorkspacesView>
    </PanelFrame>
  )
}

export function ChecksStudio({ worktreeId }: { worktreeId: string | null }): React.JSX.Element {
  // Why: mirrors the right sidebar, which shows PR Checks (parent overview) for
  // folder workspaces and the per-branch Checks panel for git worktrees.
  const activeWorktree = useAppStore((s) =>
    worktreeId ? (s.getKnownWorktreeById(worktreeId) ?? null) : null
  )
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  if (!worktreeId) {
    return (
      <StudioEmptyState
        title={translate('board.studio.noWorkspace', 'Open a workspace to use this panel.')}
      />
    )
  }
  const isFolderWorkspace = parseWorkspaceKey(worktreeId)?.type === 'folder'
  const isFolder = isFolderWorkspace || (activeRepo ? isFolderRepo(activeRepo) : false)
  return (
    <PanelFrame>
      {isFolder ? <FolderWorkspacePrChecksPanel isVisible /> : <ChecksPanel isVisible />}
    </PanelFrame>
  )
}

export function PortsStudio(): React.JSX.Element {
  return (
    <PanelFrame>
      <PortsPanel isVisible />
    </PanelFrame>
  )
}

export function PromptsStudio(): React.JSX.Element {
  return (
    <PanelFrame>
      <PromptsPanel />
    </PanelFrame>
  )
}

export function VaultStudio(): React.JSX.Element {
  return (
    <PanelFrame>
      <AiVaultPanel />
    </PanelFrame>
  )
}

export function AsanaTasksStudio(): React.JSX.Element {
  return (
    <PanelFrame>
      <AsanaTasksPanel />
    </PanelFrame>
  )
}

// Classic full pages: their own Back/Esc close action closes the studio instead.
export function AutomationsStudio({ onClose }: { onClose: () => void }): React.JSX.Element {
  useStudioCloseOverride('closeAutomationsPage', onClose)
  return <AutomationsPage />
}

export function TasksPageStudio({ onClose }: { onClose: () => void }): React.JSX.Element {
  useStudioCloseOverride('closeTaskPage', onClose)
  return <TaskPage />
}

export function MobileStudio({ onClose }: { onClose: () => void }): React.JSX.Element {
  useStudioCloseOverride('closeMobilePage', onClose)
  return <MobilePage />
}
