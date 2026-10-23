import React from 'react'
import { Bot, CalendarClock, Hexagon, Kanban, Settings, Sparkles } from 'lucide-react'
import { useActivityUnreadCount } from '@/components/activity/useActivityUnreadCount'
import { shouldShowAgentsButton } from '@/components/sidebar/SidebarNav'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { BoardRailButton } from './BoardRailButton'
import { BOARD_FLOATING_PANEL_CLASS } from './board-surface-classes'

export type BoardSideAppId =
  | 'agents'
  | 'automations'
  | 'skills'
  | 'kanban'
  | 'communications'
  | 'settings'

export type BoardSideAppsProps = {
  onOpen: (app: BoardSideAppId) => void
  activeApp?: BoardSideAppId | null
  className?: string
}

type SideAppEntry = {
  app: BoardSideAppId
  label: string
  icon: React.ReactNode
  badge?: number
}

function SideAppDivider(): React.JSX.Element {
  return <div className="mx-0.5 h-5 w-px self-center bg-[var(--board-panel-border)]" />
}

// Horizontal pill of side-app launchers. Only agents, automations, skills,
// kanban, communications and settings — no Home / Command Center, per the
// Board surface's product intent.
export function BoardSideApps({
  onOpen,
  activeApp = null,
  className
}: BoardSideAppsProps): React.JSX.Element {
  const showActivityButton = useAppStore((s) => shouldShowAgentsButton(s.settings))
  const activityUnreadCount = useActivityUnreadCount(showActivityButton, 'sidebar-badge')

  const entries: SideAppEntry[] = [
    {
      app: 'agents',
      label: translate('auto.components.sidebar.SidebarNav.9c95e1ce91', 'Agents'),
      icon: <Bot className="size-4" />,
      badge: activityUnreadCount
    },
    {
      app: 'automations',
      label: translate('auto.components.sidebar.SidebarNav.f323383e9a', 'Automations'),
      icon: <CalendarClock className="size-4" />
    },
    {
      app: 'skills',
      label: translate('auto.components.sidebar.SidebarNav.skillsNav', 'Skills'),
      icon: <Sparkles className="size-4" />
    }
  ]

  const renderButton = (entry: SideAppEntry): React.JSX.Element => (
    <div key={entry.app} className="relative">
      <BoardRailButton
        label={entry.label}
        tooltipSide="top"
        active={activeApp === entry.app}
        className="size-8"
        onClick={() => onOpen(entry.app)}
      >
        {entry.icon}
      </BoardRailButton>
      {entry.badge ? (
        <span className="pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--board-accent)] px-1 text-[10px] font-semibold text-[var(--board-accent-fg)]">
          {entry.badge}
        </span>
      ) : null}
    </div>
  )

  return (
    <div
      role="toolbar"
      aria-label={translate('board.sideApps.railLabel', 'Side apps')}
      className={cn(
        BOARD_FLOATING_PANEL_CLASS,
        'flex items-center gap-1 rounded-full p-1',
        className
      )}
    >
      {entries.map(renderButton)}
      <SideAppDivider />
      {renderButton({
        app: 'kanban',
        label: translate('board.sideApps.kanban', 'Kanban'),
        icon: <Kanban className="size-4" />
      })}
      {renderButton({
        app: 'communications',
        label: translate('board.sideApps.communications', 'Communications'),
        icon: <Hexagon className="size-4" />
      })}
      {renderButton({
        app: 'settings',
        label: translate('board.studio.title.settings', 'Settings'),
        icon: <Settings className="size-4" />
      })}
    </div>
  )
}
