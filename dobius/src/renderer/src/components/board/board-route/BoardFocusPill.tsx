import React from 'react'
import { ChevronLeft } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  BOARD_FLOATING_PANEL_CLASS,
  BOARD_PILL_BUTTON_CLASS
} from '../board-chrome/board-surface-classes'

/** "◀ Overview · Esc": shown top-center while the camera is focused on a console. */
export function BoardFocusPill({ onExit }: { onExit: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onExit}
      title={translate(
        'board.focus.overviewHint',
        'Back to the previous view (Esc, or Shift+Esc while typing in a console)'
      )}
      className={cn(
        BOARD_FLOATING_PANEL_CLASS,
        BOARD_PILL_BUTTON_CLASS,
        'pointer-events-auto absolute top-[64px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5'
      )}
    >
      <ChevronLeft className="size-4" />
      {translate('board.focus.overview', 'Overview')}
      <span className="text-[var(--board-text-muted)]" aria-hidden>
        ·
      </span>
      <span className="text-[12px] font-medium text-[var(--board-text-muted)]">
        {translate('board.focus.escKey', 'Esc')}
      </span>
    </button>
  )
}
