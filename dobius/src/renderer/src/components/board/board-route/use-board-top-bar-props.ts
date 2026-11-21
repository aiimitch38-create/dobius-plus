import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import type { BoardTopBarProps } from '../board-chrome/BoardTopBar'
import type { BoardStudioId } from '../board-studios/board-studio-ids'
import type { BoardRouteData } from './use-board-route-data'
import { useBoardAttentionJump } from './use-board-attention-jump'
import { boardResetPlan, resetBoard } from './board-reset'

export function useBoardTopBarProps(
  data: BoardRouteData,
  openStudio: (studio: BoardStudioId) => void
): { props: BoardTopBarProps; projectName: string; onOpenGitHub: () => void } {
  const { repoId, worktreeId, projects, workspaces, live, needsYou, usage } = data
  const repo = useAppStore((s) => s.repos.find((r) => r.id === repoId))
  const projectName = repo?.displayName ?? translate('board.topBar.noProject', 'No project')
  const jumpToAttention = useBoardAttentionJump(worktreeId)
  const confirm = useConfirmationDialog()

  const onResetBoard = useCallback(async () => {
    if (!worktreeId) {
      return
    }
    const plan = boardResetPlan(getBoard(useAppStore.getState(), worktreeId).cards)
    const total = plan.consoles.length + plan.otherCardIds.length
    if (total === 0) {
      toast.message(translate('board.reset.empty', 'This board is already empty.'))
      return
    }
    const ok = await confirm({
      title: translate('board.reset.title', 'Reset this board?'),
      description:
        plan.consoles.length > 0
          ? translate(
              'board.reset.descriptionConsoles',
              'Clears all {{total}} cards. {{consoles}} terminal(s) will be stopped, including any agent still working. Other workspaces are not touched.',
              { total, consoles: plan.consoles.length }
            )
          : translate(
              'board.reset.description',
              'Clears all {{total}} cards. Other workspaces are not touched.',
              { total }
            ),
      confirmLabel: translate('board.reset.confirm', 'Reset board'),
      confirmVariant: 'destructive'
    })
    if (ok) {
      resetBoard(worktreeId)
    }
  }, [confirm, worktreeId])

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
      onResetBoard: () => void onResetBoard(),
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
      onResetBoard,
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
