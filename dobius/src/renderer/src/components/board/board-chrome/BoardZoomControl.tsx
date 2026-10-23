import React from 'react'
import { Minus, Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BoardRailButton } from './BoardRailButton'
import { BOARD_FLOATING_PANEL_CLASS } from './board-surface-classes'

type BoardZoomControlProps = {
  zoom: number
  onZoomOut: () => void
  onZoomIn: () => void
  onReset: () => void
}

// Measured (LAYOUT-MAP A): 120x36 surface, 24px buttons, 20px from the corner.
export function BoardZoomControl({
  zoom,
  onZoomOut,
  onZoomIn,
  onReset
}: BoardZoomControlProps): React.JSX.Element {
  return (
    <div
      className={cn(
        BOARD_FLOATING_PANEL_CLASS,
        'pointer-events-auto absolute right-5 bottom-5 flex h-9 items-center gap-1 rounded-full px-[7px]'
      )}
    >
      <BoardRailButton
        label={translate('board.zoom.out', 'Zoom out')}
        className="size-6 [&_svg]:size-3.5"
        onClick={onZoomOut}
      >
        <Minus />
      </BoardRailButton>
      <button
        type="button"
        title={translate('board.zoom.reset', 'Reset to 100%')}
        onClick={onReset}
        className="h-6 w-[42px] rounded-full text-[12px] font-medium tabular-nums hover:bg-[var(--board-panel-2)]"
      >
        {Math.round(zoom * 100)}%
      </button>
      <BoardRailButton
        label={translate('board.zoom.in', 'Zoom in')}
        className="size-6 [&_svg]:size-3.5"
        onClick={onZoomIn}
      >
        <Plus />
      </BoardRailButton>
    </div>
  )
}
