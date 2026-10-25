import React, { useState } from 'react'
import { Bug } from 'lucide-react'
import { SidebarFeedbackDialog } from '@/components/sidebar/SidebarFeedbackDialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BOARD_FLOATING_PANEL_CLASS } from './board-surface-classes'
import { BoardReportDialog } from './BoardReportDialog'

type OpenDialog = 'report' | 'feedback' | null

// Opens the in-app report dialog (a Kanban card for the Dobius lead); the
// Classic "Send Feedback" dialog stays reachable from its footer.
export function BoardFoundBugButton({ className }: { className?: string }): React.JSX.Element {
  const [dialog, setDialog] = useState<OpenDialog>(null)
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setDialog('report')}
            className={cn(
              BOARD_FLOATING_PANEL_CLASS,
              'pointer-events-auto flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium hover:bg-[var(--board-panel-2)]',
              className
            )}
          >
            <Bug className="size-4 text-[var(--board-text-muted)]" />
            {translate('board.foundBug', 'Found a bug?')}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {translate('board.report.tooltip', 'Report a bug or request a change')}
        </TooltipContent>
      </Tooltip>
      <BoardReportDialog
        open={dialog === 'report'}
        onOpenChange={(open) => setDialog(open ? 'report' : null)}
        onSendFeedbackInstead={() => setDialog('feedback')}
      />
      <SidebarFeedbackDialog
        open={dialog === 'feedback'}
        onOpenChange={(open) => setDialog(open ? 'feedback' : null)}
      />
    </>
  )
}
