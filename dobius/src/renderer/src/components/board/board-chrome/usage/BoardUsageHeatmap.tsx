import React, { useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { buildUsageHeatmap, type HeatmapLevel, type HeatmapPoint } from './board-usage-heatmap'

// Accent-tinted steps; level 0 is the panel's grey track.
const LEVEL_STYLE: Record<HeatmapLevel, React.CSSProperties> = {
  0: { backgroundColor: 'var(--board-panel-2)' },
  1: { backgroundColor: 'var(--board-accent)', opacity: 0.25 },
  2: { backgroundColor: 'var(--board-accent)', opacity: 0.5 },
  3: { backgroundColor: 'var(--board-accent)', opacity: 0.75 },
  4: { backgroundColor: 'var(--board-accent)', opacity: 1 }
}

const ROW_LABELS: Record<number, string> = { 1: 'Mon', 3: 'Wed', 5: 'Fri' }

export function BoardUsageHeatmap({
  points,
  anchor
}: {
  points: readonly HeatmapPoint[]
  /** Test seam: the day the last column ends on. */
  anchor?: Date
}): React.JSX.Element {
  const grid = useMemo(() => buildUsageHeatmap(points, { anchor }), [anchor, points])
  return (
    <div className="space-y-2">
      <div
        className="flex gap-[3px]"
        role="img"
        aria-label={translate('board.usagePanel.activityAria', 'Daily token activity, last 26 weeks')}
      >
        <div className="grid shrink-0 grid-rows-7 gap-[3px] pr-1">
          {Array.from({ length: 7 }, (_, row) => (
            <span
              key={row}
              className="h-[10px] text-[9px] leading-[10px] text-[var(--board-text-muted)]"
            >
              {ROW_LABELS[row] ?? ''}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 justify-between gap-[3px]">
          {grid.weeks.map((week, index) => (
            <div key={week[0]?.day ?? index} className="grid grid-rows-7 gap-[3px]">
              {week.map((cell) => (
                <span
                  key={cell.day}
                  title={
                    cell.future
                      ? undefined
                      : `${cell.day}: ${cell.total.toLocaleString()} ${translate('board.usagePanel.tokens', 'tokens')}`
                  }
                  data-level={cell.future ? undefined : cell.level}
                  className={cn('size-[10px] rounded-[2px]', cell.future && 'invisible')}
                  style={LEVEL_STYLE[cell.level]}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 text-[10px] text-[var(--board-text-muted)]">
        <span>{translate('board.usagePanel.less', 'Less')}</span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span key={level} className="size-[10px] rounded-[2px]" style={LEVEL_STYLE[level]} />
        ))}
        <span>{translate('board.usagePanel.more', 'More')}</span>
      </div>
    </div>
  )
}
