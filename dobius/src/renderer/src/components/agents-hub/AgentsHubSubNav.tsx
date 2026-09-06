import React from 'react'
import { Activity, Bot, Hexagon, LayoutList } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppStore, type AppState } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export type AgentsHubView = 'tasks' | 'buzz' | 'activity' | 'agents'

// Why: the four agent surfaces are one sidebar destination but stay distinct
// activeView ids, so the Communications subtree keeps its own CSS-hidden mount
// in AppWorkspaceShell. Switching sub-tabs must never re-parent or remount it,
// or live channels stop receiving.
const AGENTS_HUB_TABS: readonly {
  view: AgentsHubView
  labelKey: string
  fallback: string
  icon: LucideIcon
}[] = [
  {
    view: 'tasks',
    labelKey: 'auto.components.agents-hub.AgentsHubSubNav.board',
    fallback: 'Board',
    icon: LayoutList
  },
  {
    view: 'buzz',
    labelKey: 'auto.components.agents-hub.AgentsHubSubNav.channels',
    fallback: 'Channels',
    icon: Hexagon
  },
  {
    view: 'activity',
    labelKey: 'auto.components.agents-hub.AgentsHubSubNav.activity',
    fallback: 'Activity',
    icon: Activity
  },
  {
    view: 'agents',
    labelKey: 'auto.components.agents-hub.AgentsHubSubNav.crew',
    fallback: 'Crew',
    icon: Bot
  }
]

export const AGENTS_HUB_VIEWS: readonly string[] = AGENTS_HUB_TABS.map((tab) => tab.view)

export function isAgentsHubView(view: AppState['activeView']): boolean {
  return AGENTS_HUB_VIEWS.includes(view)
}

export const AgentsHubSubNav = React.memo(function AgentsHubSubNav(): React.JSX.Element {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5"
      role="tablist"
      aria-label={translate('auto.components.agents-hub.AgentsHubSubNav.subnav', 'Agent surfaces')}
    >
      {AGENTS_HUB_TABS.map(({ view, labelKey, fallback, icon: Icon }) => {
        const active = activeView === view
        return (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setActiveView(view)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium tracking-tight transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={active ? 2.25 : 1.75} />
            {translate(labelKey, fallback)}
          </button>
        )
      })}
    </div>
  )
})
