import React, { useState } from 'react'
import { Bug } from 'lucide-react'
import { SidebarFeedbackDialog } from '@/components/sidebar/SidebarFeedbackDialog'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BOARD_FLOATING_PANEL_CLASS } from './board-surface-classes'

// Opens the app's existing feedback dialog (the Classic help menu's "Send Feedback").
export function BoardFoundBugButton({ className }: { className?: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          BOARD_FLOATING_PANEL_CLASS,
          'pointer-events-auto flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium hover:bg-[var(--board-panel-2)]',
          className
        )}
      >
        <Bug className="size-4 text-[var(--board-text-muted)]" />
        {translate('board.foundBug', 'Found a bug?')}
      </button>
      <SidebarFeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
