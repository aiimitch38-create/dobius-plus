import React from 'react'
import { translate } from '@/i18n/i18n'
import type { ProviderRateLimits, RateLimitWindow } from '../../../../../../shared/rate-limit-types'
import { BOARD_MONO_CLASS } from '../board-surface-classes'
import { usageLevel, usageLevelColor } from '../board-usage-levels'
import { BoardUsageHeatmap } from './BoardUsageHeatmap'
import type { HeatmapPoint } from './board-usage-heatmap'
import {
  clampPercent,
  donutDash,
  formatResetAt,
  usageWindowRows,
  type UsageWindowRow
} from './board-usage-model'

const DONUT_RADIUS = 34
const DONUT_STROKE = 8
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS

const ROW_LABEL_FALLBACKS: Record<NonNullable<UsageWindowRow['labelKey']>, string> = {
  session: 'Current session',
  weekly: 'Current week (all models)',
  fableWeekly: 'Current week (Fable)',
  monthly: 'Current month'
}

function rowLabel(row: UsageWindowRow): string {
  return row.labelKey
    ? translate(`board.usagePanel.window.${row.labelKey}`, ROW_LABEL_FALLBACKS[row.labelKey])
    : (row.label ?? row.key)
}

function ResetLine({
  window,
  now,
  timeZone
}: {
  window: RateLimitWindow
  now: number
  timeZone: string
}): React.JSX.Element | null {
  const time = formatResetAt(window.resetsAt, window.resetDescription, { now, timeZone })
  if (!time) {
    return null
  }
  return (
    <p className={`${BOARD_MONO_CLASS} text-[11px] text-[var(--board-text-muted)]`}>
      {translate('board.usagePanel.resetsAt', 'Resets {{time}} ({{zone}})', {
        time,
        zone: timeZone
      })}
    </p>
  )
}

function Donut({ usedPercent }: { usedPercent: number }): React.JSX.Element {
  const used = clampPercent(usedPercent)
  const color = usageLevelColor(usageLevel(used))
  const size = (DONUT_RADIUS + DONUT_STROKE) * 2
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={DONUT_RADIUS}
          fill="none"
          stroke="var(--board-panel-2)"
          strokeWidth={DONUT_STROKE}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={DONUT_RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={DONUT_STROKE}
          strokeLinecap="round"
          strokeDasharray={donutDash(used, DONUT_CIRCUMFERENCE)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          data-testid="board-usage-donut-arc"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span
          className="text-[20px] font-bold text-[var(--board-text)] tabular-nums"
          data-testid="board-usage-donut-percent"
        >
          {used}%
        </span>
        <span className="mt-1 text-[11px] text-[var(--board-text-muted)]">
          {translate('board.usagePanel.used', 'used')}
        </span>
      </div>
    </div>
  )
}

function WindowBar({ row, now, timeZone }: { row: UsageWindowRow; now: number; timeZone: string }) {
  const used = clampPercent(row.window.usedPercent)
  const level = usageLevel(used)
  return (
    <div className="space-y-1.5" data-testid={`board-usage-window-${row.key}`}>
      <div className="flex items-baseline justify-between text-[13px] font-semibold text-[var(--board-text)]">
        <span>{rowLabel(row)}</span>
        <span className="tabular-nums" data-usage-level={level}>
          {used}%
        </span>
      </div>
      <div className="h-[8px] w-full overflow-hidden rounded-full bg-[var(--board-panel-2)]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${used}%`, backgroundColor: usageLevelColor(level) }}
        />
      </div>
      <ResetLine window={row.window} now={now} timeZone={timeZone} />
    </div>
  )
}

/** Donut for the primary window, a bar per further window, then the activity grid. */
export function BoardUsageLoaded({
  provider,
  now,
  timeZone,
  activity
}: {
  provider: ProviderRateLimits
  now: number
  timeZone: string
  activity: { points: readonly HeatmapPoint[]; loaded: boolean }
}): React.JSX.Element {
  const [primary, ...rest] = usageWindowRows(provider)
  return (
    <div className="px-5 pt-4 pb-4" data-testid="board-usage-loaded">
      {primary ? (
        <div className="flex items-center gap-5">
          <Donut usedPercent={primary.window.usedPercent} />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[14px] font-semibold text-[var(--board-text)]">
              {rowLabel(primary)}
            </p>
            <ResetLine window={primary.window} now={now} timeZone={timeZone} />
          </div>
        </div>
      ) : null}
      {rest.length > 0 ? (
        <div className="mt-4 space-y-4 border-t border-[var(--board-panel-border)] pt-4">
          {rest.map((row) => (
            <WindowBar key={row.key} row={row} now={now} timeZone={timeZone} />
          ))}
        </div>
      ) : null}
      <div className="mt-4 border-t border-[var(--board-panel-border)] pt-4">
        <p className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-[var(--board-text-muted)] uppercase">
          {translate('board.usagePanel.activity', 'Activity')}
        </p>
        <BoardUsageHeatmap points={activity.points} />
        {activity.loaded && activity.points.length === 0 ? (
          <p className="mt-2 text-[11px] text-[var(--board-text-muted)]">
            {translate('board.usagePanel.noActivity', 'No local activity recorded yet.')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
