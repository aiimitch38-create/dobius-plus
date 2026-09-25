/* The Agents overview — three columns at a glance.
 *
 * Layout and visual language are lifted from Codex's operations mockup
 * (components/operations/OperationsDashboard.tsx). The DATA is not: that file
 * ships hardcoded strings — usage '12%', memory '2.4 GB', conversations with
 * fixed timestamps — transcribed from a picture. Every number below comes from
 * a real source, and where no real source exists the panel says so instead of
 * drawing something.
 *
 * Sources: window.api.vertexTasks.list(), window.api.agents.list(),
 * window.api.agents.listRuns(). Per-agent CPU/RAM/disk from the mockup are
 * deliberately absent — nothing measures them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Bot, LayoutList, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { CustomAgent, AgentRun } from '../../../../shared/agents'
import type { VertexTask, VertexTaskStatus } from '../../../../shared/vertex-task-types'
import { crewSubtitle } from './crew-running-counts'

const REFRESH_MS = 5_000

const STATUS_LABEL: Record<VertexTaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  'in-progress': 'In Progress',
  review: 'Review',
  testing: 'Testing',
  blocked: 'Blocked',
  done: 'Done'
}

function Panel({
  icon: Icon,
  title,
  subtitle,
  tone,
  children
}: {
  icon: LucideIcon
  title: string
  subtitle: string
  tone: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="ops-panel">
      <header className="flex h-[68px] items-center gap-3 border-b px-3">
        <div className={cn('flex size-11 items-center justify-center rounded-xl', tone)}>
          <Icon className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </header>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">
      {children}
    </p>
  )
}

function Row({
  title,
  detail,
  meta
}: {
  title: string
  detail: string
  meta?: string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-accent/50">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{detail}</span>
      </span>
      {meta ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{meta}</span>
      ) : null}
    </div>
  )
}

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  if (minutes < 60 * 24) {
    return `${Math.round(minutes / 60)}h`
  }
  return `${Math.round(minutes / (60 * 24))}d`
}

export function AgentsOverview(): React.JSX.Element {
  const [tasks, setTasks] = useState<VertexTask[]>([])
  const [agents, setAgents] = useState<CustomAgent[]>([])
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [boardError, setBoardError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [t, a, r] = await Promise.all([
      // Why not [] on failure: an unreadable board would read as "Nothing open".
      window.api?.vertexTasks?.list().then(
        (list) => {
          setBoardError(null)
          return list
        },
        () => {
          setBoardError('Board could not be loaded')
          return null
        }
      ) ?? [],
      window.api?.agents?.list().catch(() => []) ?? [],
      window.api?.agents?.listRuns?.().catch(() => []) ?? []
    ])
    if (t) {
      setTasks(t as VertexTask[])
    }
    setAgents(a as CustomAgent[])
    setRuns(r as AgentRun[])
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const openTasks = useMemo(() => tasks.filter((task) => task.status !== 'done'), [tasks])
  const recentRuns = useMemo(
    () => [...runs].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, 25),
    [runs]
  )
  const agentName = useCallback(
    (id: string) => agents.find((agent) => agent.id === id)?.name ?? 'Unknown agent',
    [agents]
  )
  // Real money, summed from real runs — not a mockup percentage.
  const spend = useMemo(() => runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0), [runs])

  return (
    <main className="ops-dashboard h-full min-h-0 bg-background p-2 text-foreground">
      <div className="grid h-full min-h-0 grid-cols-[1fr_1.02fr_1.08fr] gap-1.5">
        <Panel
          icon={LayoutList}
          title="Board"
          subtitle={
            boardError ??
            (openTasks.length ? `${openTasks.length} open of ${tasks.length}` : 'Nothing open')
          }
          tone="bg-ops-violet-soft text-ops-violet"
        >
          {openTasks.length ? (
            openTasks.map((task) => (
              <Row
                key={task.id}
                title={task.title}
                detail={
                  task.assignee
                    ? `${STATUS_LABEL[task.status]} · ${task.assignee.name}`
                    : `${STATUS_LABEL[task.status]} · unassigned`
                }
                meta={task.dispatch ? task.dispatch.status : undefined}
              />
            ))
          ) : (
            <Empty>No open tasks. Create one on the Board tab.</Empty>
          )}
        </Panel>

        <Panel
          icon={Bot}
          title="Crew"
          subtitle={crewSubtitle(agents, runs)}
          tone="bg-ops-blue-soft text-ops-blue"
        >
          {agents.length ? (
            agents.map((agent) => {
              const assigned = tasks.filter(
                (task) => task.assignee?.id === agent.id && task.status !== 'done'
              ).length
              const live = runs.some(
                (run) => run.agentId === agent.id && run.status === 'running'
              )
              return (
                <Row
                  key={agent.id}
                  title={agent.name}
                  // description and model are real fields on the agent record;
                  // the mockup's usage/memory/disk have no source and are omitted.
                  detail={`${agent.description?.trim() || agent.model} ${live ? '· running' : ''}`}
                  meta={assigned ? `${assigned} task${assigned === 1 ? '' : 's'}` : undefined}
                />
              )
            })
          ) : (
            <Empty>No agents yet. Add one on the Crew tab.</Empty>
          )}
        </Panel>

        <Panel
          icon={Activity}
          title="Activity"
          subtitle={runs.length ? `${runs.length} runs · $${spend.toFixed(2)} total` : 'No runs yet'}
          tone="bg-ops-green-soft text-ops-green"
        >
          {recentRuns.length ? (
            recentRuns.map((run) => (
              <Row
                key={run.id}
                title={agentName(run.agentId)}
                detail={
                  run.summary?.trim() ||
                  (run.status === 'running' ? 'Working…' : `Run ${run.status}`)
                }
                meta={`${ago(run.startedAt)}${
                  typeof run.costUsd === 'number' ? ` · $${run.costUsd.toFixed(2)}` : ''
                }`}
              />
            ))
          ) : (
            <Empty>No agent has run yet.</Empty>
          )}
        </Panel>
      </div>
    </main>
  )
}

export default AgentsOverview
