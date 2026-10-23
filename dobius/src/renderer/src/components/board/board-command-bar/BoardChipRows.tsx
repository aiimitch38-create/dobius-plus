import React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BOARD_CHIP_ROWS, BOARD_DANGER_CHIPS, type BoardChipId } from './board-command-chips'

// Why: pause/resume gate future autonomous crew runs; they do not freeze live
// consoles, so the chip says exactly that on hover.
function chipHint(id: BoardChipId): string | null {
  if (id === 'pause-all') {
    return translate(
      'board.chips.pauseAllHint',
      'Stops new autonomous agent runs from starting. Live consoles keep running.'
    )
  }
  if (id === 'resume-all') {
    return translate('board.chips.resumeAllHint', 'Lets autonomous agent runs start again.')
  }
  return null
}

function chipLabel(id: BoardChipId): string {
  switch (id) {
    case 'new-console':
      return translate('board.chips.newConsole', 'New console')
    case 'spawn-4':
      return translate('board.chips.spawn4', 'Spawn 4')
    case 'group':
      return translate('board.chips.group', 'Group')
    case 'presets':
      return translate('board.chips.presets', 'Presets')
    case 'pause-all':
      return translate('board.chips.pauseAll', 'Pause all')
    case 'resume-all':
      return translate('board.chips.resumeAll', 'Resume all')
    case 'memory':
      return translate('board.chips.memory', 'Memory')
    case 'loops':
      return translate('board.chips.loops', 'Loops')
    case 'docs':
      return translate('board.chips.docs', 'Docs')
    case 'code':
      return translate('board.chips.code', 'Code')
    case 'skills':
      return translate('board.chips.skills', 'Skills')
    case 'mission-map':
      return translate('board.chips.missionMap', 'Mission Map')
    case 'kill-all':
      return translate('board.chips.killAll', 'Kill all')
  }
}

const RING_COUNT = 7
const CHIP_ORDER: readonly BoardChipId[] = BOARD_CHIP_ROWS.flat()

// Why: the reference draws each chip with its own pastel gradient ring. A
// padding-box fill over a border-box gradient makes the transparent border
// show the gradient; the ring is keyed to the chip so it never changes when the
// bar collapses to one row.
function chipRingStyle(id: BoardChipId): React.CSSProperties {
  const ring = (CHIP_ORDER.indexOf(id) % RING_COUNT) + 1
  return {
    background: `linear-gradient(var(--board-chip), var(--board-chip)) padding-box, var(--board-chip-ring-${ring}) border-box`
  }
}

export function BoardChipRows({
  rows,
  onChip,
  compact = false
}: {
  rows: readonly (readonly BoardChipId[])[]
  onChip: (id: BoardChipId, anchor: DOMRect) => void
  /** Measured: inside the expanded thread the reference chips shrink to ~25px so row 1 fits. */
  compact?: boolean
}): React.JSX.Element {
  return (
    <>
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className={cn('flex flex-wrap justify-center', compact ? 'gap-1.5' : 'gap-2')}
        >
          {row.map((id) => {
            const danger = BOARD_DANGER_CHIPS.has(id)
            const hint = chipHint(id)
            const chip = (
              <button
                key={id}
                type="button"
                onClick={(event) => onChip(id, event.currentTarget.getBoundingClientRect())}
                className={cn(
                  compact ? 'h-[25px] px-2 text-[11.5px]' : 'h-[27px] px-[11px] text-[12px]',
                  'rounded-full font-medium transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--board-accent)] focus-visible:outline-none',
                  danger
                    ? 'border border-[var(--board-danger-text)]/30 bg-[var(--board-danger-tint)] text-[var(--board-danger-text)]'
                    : 'border-[1.5px] border-transparent text-[var(--board-text)]'
                )}
                style={danger ? undefined : chipRingStyle(id)}
              >
                {chipLabel(id)}
              </button>
            )
            return hint ? (
              <Tooltip key={id}>
                <TooltipTrigger asChild>{chip}</TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} className="max-w-64">
                  {hint}
                </TooltipContent>
              </Tooltip>
            ) : (
              chip
            )
          })}
        </div>
      ))}
    </>
  )
}
