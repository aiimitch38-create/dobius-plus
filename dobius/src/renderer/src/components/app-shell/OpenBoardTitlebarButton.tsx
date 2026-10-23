import { LayoutDashboard } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

// Why: extracted from DobiusTitlebarButtons so it can be mounted in an
// always-present titlebar slot. The rest of that cluster (notifications,
// quick commands) hides while the right sidebar is open to avoid
// duplicating its own close button, but "Open Board" must stay reachable
// regardless of right-sidebar state.
export function OpenBoardTitlebarButton(): React.JSX.Element {
  const setActiveView = useAppStore((s) => s.setActiveView)

  return (
    <button
      className="titlebar-icon-button no-drag"
      aria-label={translate('board.titlebar.open', 'Open Board')}
      title={translate('board.titlebar.open', 'Open Board')}
      onClick={() => setActiveView('board')}
    >
      <LayoutDashboard size={14} />
    </button>
  )
}
