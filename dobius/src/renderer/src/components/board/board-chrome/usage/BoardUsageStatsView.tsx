import React, { lazy, Suspense } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'

// Why: UsageOverviewPane pulls in the full daily-intensity grid + token-mix
// model; only this view needs it, so defer the bundle cost until then.
const UsageOverviewPane = lazy(() =>
  import('@/components/stats/UsageOverviewPane').then((m) => ({ default: m.UsageOverviewPane }))
)

function ResetChimeToggle(): React.JSX.Element {
  const enabled = useAppStore((s) => s.settings?.boardUsageResetChime === true)
  return (
    <label className="flex items-center gap-2 text-[12px] text-[var(--board-text)]">
      <Checkbox
        checked={enabled}
        onCheckedChange={(checked) => {
          void useAppStore.getState().updateSettings({ boardUsageResetChime: checked === true })
        }}
      />
      {translate('board.usagePanel.resetChime', 'Chime when a usage window resets')}
    </label>
  )
}

/** Token statistics (the former "Tokens" tab) plus the reset chime and the data caveat. */
export function BoardUsageStatsView(): React.JSX.Element {
  return (
    <div className="px-5 pt-3 pb-4" data-testid="board-usage-stats">
      <ScrollArea className="max-h-[360px]">
        <Suspense
          fallback={
            <p className="p-2 text-[12px] text-[var(--board-text-muted)]">
              {translate('board.usagePanel.loadingTokens', 'Loading token usage...')}
            </p>
          }
        >
          <UsageOverviewPane />
        </Suspense>
      </ScrollArea>
      <div className="mt-3 space-y-2 border-t border-[var(--board-panel-border)] pt-3">
        <ResetChimeToggle />
        <p className="text-[11px] text-[var(--board-text-muted)]">
          {translate(
            'board.usagePanel.caveat',
            'Limits come from the provider and may lag your actual usage.'
          )}
        </p>
      </div>
    </div>
  )
}
