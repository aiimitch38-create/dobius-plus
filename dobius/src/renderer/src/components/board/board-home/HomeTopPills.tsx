import { Moon, Sun } from 'lucide-react'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { BOARD_FLOATING_PANEL_CLASS } from '../board-chrome/board-surface-classes'
import type { HomeAgentSummary } from './home-repo-rows'

const PILL = cn(
  BOARD_FLOATING_PANEL_CLASS,
  'flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium tabular-nums'
)

export function homeStatusText(summary: HomeAgentSummary): string {
  if (summary.needsYou > 0) {
    return translate('board.topBar.needsYou', '{{count}} need you', { count: summary.needsYou })
  }
  if (summary.working > 0) {
    return translate('board.home.status.working', '{{count}} working', { count: summary.working })
  }
  return translate('board.home.status.allIdle', 'All idle')
}

export function HomeTopPills({
  summary,
  now
}: {
  summary: HomeAgentSummary
  now: Date
}): React.JSX.Element {
  const theme = useAppStore((s) => s.settings?.theme ?? 'system')
  const updateSettings = useAppStore((s) => s.updateSettings)
  const systemDark = useSystemPrefersDark()
  const isDark = theme === 'dark' || (theme === 'system' && systemDark)
  const dotClass =
    summary.needsYou > 0
      ? 'bg-[var(--board-accent)]'
      : summary.working > 0
        ? 'bg-[var(--board-live)]'
        : 'bg-[var(--board-text-muted)]'
  const themeLabel = isDark
    ? translate('board.home.theme.light', 'Switch to light theme')
    : translate('board.home.theme.dark', 'Switch to dark theme')

  return (
    <div className="pointer-events-auto absolute top-[17px] right-[18px] flex items-center gap-[9px]">
      <div
        className={cn(
          PILL,
          summary.needsYou > 0 ? 'bg-[var(--board-accent-tint)]' : 'bg-[var(--board-status-pill)]'
        )}
        role="status"
      >
        <span className={cn('size-1.5 rounded-full', dotClass)} aria-hidden />
        {homeStatusText(summary)}
      </div>
      <button
        type="button"
        aria-label={themeLabel}
        title={themeLabel}
        onClick={() => void updateSettings({ theme: isDark ? 'light' : 'dark' })}
        className={cn(
          BOARD_FLOATING_PANEL_CLASS,
          'flex size-7 items-center justify-center rounded-full hover:bg-[var(--board-panel-2)]'
        )}
      >
        {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      </button>
      <div className={cn(PILL, 'bg-[var(--board-status-pill)]')}>
        <time dateTime={now.toISOString()}>
          {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </time>
      </div>
    </div>
  )
}
