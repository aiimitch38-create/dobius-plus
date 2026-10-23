import React from 'react'
import { CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { BoardLoopsPanel } from '../board-loops/BoardLoopsPanel'
import { StudioEmptyState } from './StudioEmptyState'

// Board loops (instructions fired into this board's consoles). Scheduled repo
// automations stay on the Classic Automations page, reachable from the link.
export function LoopsStudio({
  worktreeId,
  onClose
}: {
  worktreeId: string | null
  onClose: () => void
}): React.JSX.Element {
  const openAutomationsPage = useAppStore((s) => s.openAutomationsPage)
  if (!worktreeId) {
    return (
      <StudioEmptyState
        title={translate('board.studio.loops.noWorkspace', 'Open a workspace to set up loops.')}
      />
    )
  }
  return (
    <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
      <BoardLoopsPanel worktreeId={worktreeId} />
      <div className="flex items-center justify-between gap-3 border-t border-[var(--board-panel-border)] pt-4">
        <p className="text-[12px] text-[var(--board-text-muted)]">
          {translate(
            'board.studio.loops.automationsHint',
            'Scheduled repo automations (cron-style runs) live on the Automations page.'
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onClose()
            openAutomationsPage()
          }}
        >
          <CalendarClock className="size-3.5" />
          {translate('board.studio.loops.openAutomations', 'Open Automations')}
        </Button>
      </div>
    </div>
  )
}
