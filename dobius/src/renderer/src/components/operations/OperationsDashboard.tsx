import { useState } from 'react'
import {
  Bell,
  Bot,
  ChevronDown,
  EllipsisVertical,
  Grid2X2,
  ListFilter,
  MessageCircleMore,
  Pause,
  PencilLine,
  Play,
  Plus,
  Search,
  SquareTerminal
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { agents, alerts, conversations, type FeedItem } from './operations-data'

const toneClasses: Record<string, string> = {
  neutral: 'bg-muted text-foreground',
  blue: 'bg-ops-blue-soft text-ops-blue',
  green: 'bg-ops-green-soft text-ops-green',
  violet: 'bg-ops-violet-soft text-ops-violet',
  amber: 'bg-ops-amber-soft text-ops-amber',
  cyan: 'bg-ops-cyan-soft text-ops-cyan'
}

function Tabs({
  items,
  active,
  onChange
}: {
  items: string[]
  active: string
  onChange: (item: string) => void
}) {
  return (
    <div className="grid h-10 grid-flow-col auto-cols-fr gap-1 rounded-lg bg-muted/60 p-1">
      {items.map((item) => (
        <button
          key={item}
          onClick={() => onChange(item)}
          className={cn(
            'rounded-md px-2 text-xs font-medium text-muted-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring',
            active === item && 'bg-card text-foreground shadow-xs'
          )}
        >
          {item}
          {item === 'Inbox' || item === 'All' ? (
            <span className="ml-2 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] text-destructive-foreground">
              3
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function PanelHeader({
  icon: Icon,
  title,
  subtitle,
  tone,
  children
}: {
  icon: typeof Bell
  title: string
  subtitle: string
  tone: string
  children: React.ReactNode
}) {
  return (
    <header className="flex h-[68px] items-center gap-3 border-b px-3">
      <div className={cn('flex size-11 items-center justify-center rounded-xl', toneClasses[tone])}>
        <Icon className="size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-bold">{title}</h2>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </header>
  )
}

function SearchBar({ placeholder, trailing }: { placeholder: string; trailing?: React.ReactNode }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input placeholder={placeholder} className="h-9 bg-card pl-9 pr-12 text-xs" />
      {trailing ? (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {trailing}
        </div>
      ) : null}
    </div>
  )
}

function FeedRow({ item, compact = false }: { item: FeedItem; compact?: boolean }) {
  const Icon = item.icon
  return (
    <button
      className={cn(
        'group flex w-full items-center gap-3 border-b px-2 text-left outline-none transition hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        compact ? 'h-[41px]' : 'h-[58px]'
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full',
          compact ? 'size-7' : 'size-10',
          toneClasses[item.tone]
        )}
      >
        <Icon className={compact ? 'size-4' : 'size-5'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-muted-foreground">
        {item.meta}
        {item.badge ? (
          <span className="rounded-full bg-destructive px-1.5 text-[10px] leading-5 text-destructive-foreground">
            {item.badge}
          </span>
        ) : null}
      </span>
    </button>
  )
}

function CommunicationsPanel() {
  const [tab, setTab] = useState('Inbox')
  const [filter, setFilter] = useState('All')
  return (
    <section className="ops-panel">
      <PanelHeader
        icon={MessageCircleMore}
        title="Communications"
        subtitle="All conversations. People, agents, and channels."
        tone="violet"
      >
        <Button variant="outline" size="icon-sm" aria-label="Compose">
          <PencilLine />
        </Button>
      </PanelHeader>
      <div className="space-y-3 p-3 pb-0">
        <Tabs items={['Inbox', 'Channels', 'DMs', 'Archive']} active={tab} onChange={setTab} />
        <SearchBar placeholder="Search messages…" trailing="⌘K" />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {['All', 'Unread 3', 'Mentions 1', 'Agents', 'Clients'].map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === item ? 'border-ops-blue bg-ops-blue text-primary-foreground' : 'bg-card'
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {conversations.map((item) => (
          <FeedRow key={item.title} item={item} />
        ))}
      </div>
    </section>
  )
}

function AgentsPanel() {
  const [tab, setTab] = useState('Crew')
  return (
    <section className="ops-panel">
      <PanelHeader
        icon={Bot}
        title="Agents"
        subtitle="Deploy, monitor, and collaborate with your crew."
        tone="cyan"
      >
        <Button variant="outline" size="icon-sm" aria-label="Add agent">
          <Plus />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Agent menu">
          <EllipsisVertical />
        </Button>
      </PanelHeader>
      <div className="space-y-3 p-3 pb-0">
        <Tabs
          items={['Crew', 'Live', 'Runs', 'Memory', 'Settings']}
          active={tab}
          onChange={setTab}
        />
        <div className="flex gap-2">
          <div className="flex-1">
            <SearchBar placeholder="Search agents…" />
          </div>
          <Button variant="outline" className="h-9 text-xs">
            Status <ChevronDown />
          </Button>
          <Button variant="outline" size="icon-sm">
            <Grid2X2 />
          </Button>
          <Button variant="outline" size="icon-sm">
            <ListFilter />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
        {agents.map((agent) => {
          const Icon = agent.icon
          return (
            <button
              key={agent.name}
              className="flex h-[82px] w-full items-center gap-3 border-b px-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  'flex size-12 items-center justify-center rounded-xl',
                  toneClasses[agent.tone]
                )}
              >
                <Icon className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between">
                  <strong className="text-sm">{agent.name}</strong>
                  <span className="text-[11px] text-ops-green">● Online</span>
                </span>
                <span className="block text-xs text-muted-foreground">{agent.role}</span>
                <span className="block text-xs text-muted-foreground">{agent.model}</span>
              </span>
              <span className="grid shrink-0 gap-2 text-right text-[11px] text-muted-foreground">
                <EllipsisVertical className="ml-auto size-3" />
                <span>
                  {agent.usage}　{agent.memory}　<span className="text-ops-blue">≡</span>{' '}
                  {agent.tasks}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="m-3 mt-0 space-y-3">
        <div className="rounded-xl border bg-card p-2">
          <strong className="block text-[11px]">Quick Actions</strong>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <Button variant="outline" size="sm">
              <Plus />
              New Agent
            </Button>
            <Button variant="outline" size="sm">
              <Play />
              Run All
            </Button>
            <Button variant="outline" size="sm">
              <Pause />
              Pause Crew
            </Button>
            <Button variant="outline" size="sm">
              <ListFilter />
              View Logs
            </Button>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] text-muted-foreground">Crew Status</span>
              <strong className="block text-lg text-ops-green">6/6 Online</strong>
            </div>
            {[
              ['CPU', '34%'],
              ['RAM', '62%'],
              ['Disk', '41%']
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border px-3 py-2 text-center text-[11px]">
                <span className="text-muted-foreground">{k}</span>
                <strong className="block text-base">{v}</strong>
              </div>
            ))}
          </div>
          <div className="mt-3 h-2 rounded-full bg-muted">
            <div className="h-full w-2/5 rounded-full bg-ops-green" />
          </div>
          <div className="mt-2 h-7 rounded-lg bg-ops-green-soft" />
        </div>
      </div>
    </section>
  )
}

function AlertsPanel() {
  const [tab, setTab] = useState('All')
  return (
    <section className="ops-panel">
      <PanelHeader
        icon={Bell}
        title="Alerts"
        subtitle="Real-time activity, processes, and system events."
        tone="violet"
      >
        <Button variant="outline" size="icon-sm" aria-label="Pause alerts">
          <Pause />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Alerts menu">
          <EllipsisVertical />
        </Button>
      </PanelHeader>
      <div className="space-y-3 p-3 pb-0">
        <Tabs
          items={['All', 'Terminal', 'Agents', 'System', 'Integrations']}
          active={tab}
          onChange={setTab}
        />
        <div className="flex gap-2">
          <div className="flex-1">
            <SearchBar placeholder="Search logs…" trailing="⌘K" />
          </div>
          <Button variant="outline" className="h-9 text-xs">
            <span className="text-ops-green">●</span> Live <ChevronDown />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2">
        {alerts.map((item) => (
          <FeedRow key={`${item.title}-${item.meta}`} item={item} compact />
        ))}
      </div>
      <div className="m-3 mt-0 rounded-xl border bg-card p-2">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium">
          <SquareTerminal className="size-4" />
          Live Terminal <span className="text-ops-green">●</span>
          <span className="text-muted-foreground">main · Claude</span>
        </div>
        <div className="ops-terminal rounded-lg p-4 font-mono text-xs leading-5">
          <p className="text-ops-green">› cd ~/Projects/dobius</p>
          <p className="text-ops-green">› npm run dev</p>
          <p>
            <span className="text-ops-cyan">vite v7.3.6</span>　ready in 426ms
          </p>
          <p className="mt-2">➜ Local:　http://localhost:5173/</p>
          <p>➜ Network: http://192.168.1.12:5173/</p>
          <p className="mt-2 text-muted-foreground">press h + enter to show help</p>
        </div>
      </div>
    </section>
  )
}

export default function OperationsDashboard() {
  return (
    <main className="ops-dashboard h-full min-h-0 bg-background p-2 text-foreground">
      <div className="grid h-full min-h-0 grid-cols-[1fr_1.02fr_1.08fr] gap-1.5">
        <CommunicationsPanel />
        <AgentsPanel />
        <AlertsPanel />
      </div>
    </main>
  )
}
