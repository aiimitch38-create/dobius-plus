import React from 'react'
import { Kanban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ScrollToCurrentWorkspaceToolbarButton } from './ScrollToCurrentWorkspaceToolbarButton'
import { SidebarSettingsHelpMenu } from './SidebarSettingsHelpMenu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { hasFeatureInteraction } from '../../../../shared/feature-interactions'

const WORKSPACE_BOARD_MOVED_HINT_STORAGE_KEY = 'dobius.workspaceBoardMovedHintSeen.v1'
const WORKSPACE_BOARD_MOVED_HINT_DURATION_MS = 12000

type SidebarToolbarProps = {
  workspaceBoardOpen: boolean
  workspaceBoardDragPreviewOpen?: boolean
  onWorkspaceBoardToggle: () => void
}

const SidebarToolbar = React.memo(function SidebarToolbar({
  workspaceBoardOpen,
  workspaceBoardDragPreviewOpen = false,
  onWorkspaceBoardToggle
}: SidebarToolbarProps) {
  const [workspaceBoardMovedHintOpen, setWorkspaceBoardMovedHintOpen] = React.useState(false)
  const movedHintEligibleRef = React.useRef<boolean | null>(null)
  const persistedUIReady = useAppStore((state) => state.persistedUIReady)
  const hasUsedWorkspaceBoard = useAppStore((state) =>
    hasFeatureInteraction(state.featureInteractions, 'workspace-board')
  )
  // Why: read the RAW store value (not an effective/derived one) — Classic
  // stays mounted underneath the full-window Board surface, and this tip
  // must not draw over the Board while it's up.
  const activeView = useAppStore((state) => state.activeView)

  React.useEffect(() => {
    if (!persistedUIReady || activeView === 'board') {
      return
    }
    // Why: only users who had already opened the old board location should
    // see the relocation hint; first-time users should not become eligible.
    if (movedHintEligibleRef.current === null) {
      movedHintEligibleRef.current = hasUsedWorkspaceBoard
    }
    if (!movedHintEligibleRef.current) {
      return
    }
    try {
      if (window.localStorage.getItem(WORKSPACE_BOARD_MOVED_HINT_STORAGE_KEY) === 'true') {
        return
      }
      window.localStorage.setItem(WORKSPACE_BOARD_MOVED_HINT_STORAGE_KEY, 'true')
    } catch {
      return
    }

    setWorkspaceBoardMovedHintOpen(true)
    const timeoutId = window.setTimeout(() => {
      setWorkspaceBoardMovedHintOpen(false)
    }, WORKSPACE_BOARD_MOVED_HINT_DURATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [activeView, hasUsedWorkspaceBoard, persistedUIReady])

  React.useEffect(() => {
    // Why: close an already-open hint the instant the Board surface comes
    // up, rather than waiting for its auto-dismiss timeout to elapse.
    if (activeView === 'board') {
      setWorkspaceBoardMovedHintOpen(false)
    }
  }, [activeView])

  const handleWorkspaceBoardClick = (): void => {
    setWorkspaceBoardMovedHintOpen(false)
    onWorkspaceBoardToggle()
  }

  return (
    <div className="mt-auto shrink-0">
      <div className="flex items-center justify-between border-t border-worktree-sidebar-border px-2 py-1.5">
        <SidebarSettingsHelpMenu />
        <div className="flex items-center gap-1">
          <ScrollToCurrentWorkspaceToolbarButton />
          <Tooltip open={workspaceBoardMovedHintOpen ? true : undefined}>
            <TooltipTrigger asChild>
              <Button
                // Why: previewing the board from a card drag lights up the
                // trigger so it's clear the drag is another way to open it.
                variant={
                  workspaceBoardOpen || workspaceBoardDragPreviewOpen ? 'secondary' : 'ghost'
                }
                size="icon-xs"
                type="button"
                aria-label={translate(
                  'auto.components.sidebar.SidebarToolbar.49f62c5665',
                  'Workspace board'
                )}
                aria-pressed={workspaceBoardOpen}
                data-workspace-board-trigger=""
                data-workspace-board-preview={workspaceBoardDragPreviewOpen ? 'true' : undefined}
                onClick={handleWorkspaceBoardClick}
                className="text-muted-foreground"
              >
                <Kanban className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {workspaceBoardMovedHintOpen
                ? translate(
                    'auto.components.sidebar.SidebarToolbar.87d0064026',
                    'Workspace board moved to the bottom bar'
                  )
                : workspaceBoardOpen
                  ? translate(
                      'auto.components.sidebar.SidebarToolbar.a30e34eb5c',
                      'Close workspace board'
                    )
                  : translate(
                      'auto.components.sidebar.SidebarToolbar.49f62c5665',
                      'Workspace board'
                    )}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
})

export default SidebarToolbar
