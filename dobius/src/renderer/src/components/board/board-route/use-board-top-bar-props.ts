import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import type { BoardTopBarProps } from '../board-chrome/BoardTopBar'
import type { BoardStudioId } from '../board-studios/board-studio-ids'
import type { BoardRouteData } from './use-board-route-data'
import { useBoardAttentionJump } from './use-board-attention-jump'

export function useBoardTopBarProps(
  data: BoardRouteData,
  openStudio: (studio: BoardStudioId) => void
): { props: BoardTopBarProps; projectName: string; onOpenGitHub: () => void } {
  const { repoId, worktreeId, projects, workspaces, live, needsYou, usage } = data
  const repo = useAppStore((s) => s.repos.find((r) => r.id === repoId))
  const projectName = repo?.displayName ?? translate('board.topBar.noProject', 'No project')
  const jumpToAttention = useBoardAttentionJump(worktreeId)

  // Why: the owner asked for the GitHub button to open the panel grouped by
  // workspace; github.com itself is one click further, inside that panel.
  const onOpenGitHub = useCallback(() => openStudio('source-control'), [openStudio])

  const props = useMemo<BoardTopBarProps>(
    () => ({
      projects,
      activeProjectId: repoId,
      onSelectProject: (id) => {
        const candidates = (useAppStore.getState().worktreesByRepo[id] ?? []).filter(
          (w) => !w.isArchived
        )
        const latest = [...candidates].sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
        if (latest) {
          activateAndRevealWorktree(latest.id, { keepView: true })
        } else {
          toast.message(
            translate('board.topBar.noWorkspaces', 'That project has no workspaces yet.')
          )
        }
      },
      workspaces,
      activeWorkspaceId: worktreeId,
      onSelectWorkspace: (id) => {
        activateAndRevealWorktree(id, { keepView: true })
      },
      onRenameWorkspace: (id, name) => {
        void useAppStore.getState().updateWorktreeMeta(id, { displayName: name })
      },
      onAddWorkspace: () =>
        useAppStore.getState().openModal('new-workspace-composer', {
          ...(repoId ? { initialRepoId: repoId } : {}),
          telemetrySource: 'sidebar'
        }),
      onBackToHome: () => useAppStore.getState().setActiveView('home'),
      liveCount: live,
      needsYouCount: needsYou,
      usage,
      // `||`, not `??`: an empty git username must still show an initial.
      avatarLabel: repo?.gitUsername || repo?.displayName || 'D',
      onOpenSkills: () => openStudio('skills'),
      onOpenSettings: () => openStudio('settings'),
      onJumpToAttention: () => {
        jumpToAttention()
      },
      onOpenAccounts: () => {
        useAppStore.getState().openSettingsTarget({ pane: 'accounts', repoId: null })
        openStudio('settings')
      }
    }),
    [
      jumpToAttention,
      live,
      needsYou,
      openStudio,
      projects,
      repo,
      repoId,
      usage,
      workspaces,
      worktreeId
    ]
  )

  return { props, projectName, onOpenGitHub }
}
