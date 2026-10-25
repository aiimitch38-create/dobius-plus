import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Columns3,
  Filter,
  List,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { TooltipProvider } from '@/components/ui/tooltip'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { KanbanJobLanes } from './KanbanJobLanes'
import { getKanbanIpcSource } from './kanban-ipc-source'
import { OPERATOR, useAssignablePeople } from './kanban-people'
import { DAY_MS, parseDueDate, startOfDay } from './kanban-dates'
import { moveTasksOptimistically } from './kanban-ordering'
import { KanbanColumn } from './KanbanColumn'
import { KanbanDetailPanel } from './KanbanDetailPanel'
import { KanbanDoneNoteDialog } from './KanbanDoneNoteDialog'
import type {
  Task,
  TaskPriority,
  TaskSource,
  TaskStatus,
  TaskType,
  VertexTaskDestination
} from './kanban-types'

const REFRESH_MS = 4_000
const LOAD_ERROR_TOAST_ID = 'kanban-load-error'

type PendingDone =
  | { kind: 'move'; taskId: string; status: TaskStatus; index: number }
  | { kind: 'update'; taskId: string; patch: Parameters<TaskSource['update']>[1] }

const statuses: TaskStatus[] = [
  'backlog',
  'todo',
  'in-progress',
  'blocked',
  'review',
  'testing',
  'done'
]
const views = [
  { id: 'board', label: 'Board', icon: Columns3 },
  { id: 'list', label: 'List', icon: List },
  { id: 'timeline', label: 'Timeline', icon: SlidersHorizontal },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'activity', label: 'Activity', icon: Activity }
] as const

const statusNames: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  'in-progress': 'In Progress',
  blocked: 'Blocked',
  review: 'Review',
  testing: 'Testing',
  done: 'Done'
}

/* Why these three views are derived, not decorative: Timeline used to position
 * every bar with `left: (index % 5) * 12%`, Calendar bucketed a task onto a day
 * with `taskIndex % 30 === index`, and Activity picked its verb with
 * `index % 3`. None of that touched a real field. Everything below reads
 * `dueDate`, `createdAt` or `dispatch`, and anything with no real value behind
 * it says so instead of drawing something. */

const TIMELINE_DAYS = 7

// Why: an empty board has nothing done, so it reads 0% rather than 0/0 = NaN%.
function completionRatePercent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0
}

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
}

function formatAgo(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  if (minutes < 60 * 24) {
    return `${Math.round(minutes / 60)}h`
  }
  return `${Math.round(minutes / (60 * 24))}d`
}

function TimelineView({
  tasks,
  onOpen
}: {
  tasks: Task[]
  onOpen: (id: string) => void
}): React.JSX.Element {
  const today = startOfDay(Date.now())
  const windowEnd = today + (TIMELINE_DAYS - 1) * DAY_MS
  const rows = tasks
    .map((task) => ({ task, due: parseDueDate(task.dueDate) }))
    .filter((row): row is { task: Task; due: number } => row.due !== null && row.due <= windowEnd)
    .sort((a, b) => a.due - b.due)
  const undated = tasks.length - rows.length

  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-4">
      <div className="min-w-[900px] rounded-xl border border-kanban-border bg-kanban-card p-4">
        <div className="mb-4 grid grid-cols-[180px_repeat(7,1fr)] text-center text-[10px] text-kanban-muted-foreground">
          <span className="text-left">
            {new Date(today).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          {Array.from({ length: TIMELINE_DAYS }, (_, index) => (
            <span key={index}>{formatDay(today + index * DAY_MS)}</span>
          ))}
        </div>
        <div className="space-y-3">
          {rows.map(({ task, due }) => {
            const overdue = due < today
            const startDay = Math.min(
              TIMELINE_DAYS - 1,
              Math.max(0, Math.round((startOfDay(task.createdAt) - today) / DAY_MS))
            )
            const endDay = Math.min(
              TIMELINE_DAYS - 1,
              Math.max(startDay, Math.round((due - today) / DAY_MS))
            )
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpen(task.id)}
                className="grid w-full grid-cols-[180px_1fr] items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-kanban-accent"
              >
                <span className="truncate text-xs font-medium">{task.title}</span>
                <span className="relative h-8 rounded-md bg-kanban-column">
                  <span
                    title={`Created ${new Date(task.createdAt).toLocaleDateString()} · due ${new Date(due).toLocaleDateString()}`}
                    className={`absolute inset-y-1 truncate rounded-md px-3 py-1 text-[10px] font-medium kanban-timeline-${task.status}`}
                    style={{
                      left: `${(startDay / TIMELINE_DAYS) * 100}%`,
                      width: `${((endDay - startDay + 1) / TIMELINE_DAYS) * 100}%`
                    }}
                  >
                    {overdue ? 'Overdue · ' : ''}
                    {statusNames[task.status]}
                  </span>
                </span>
              </button>
            )
          })}
          {rows.length ? null : (
            <p className="py-6 text-center text-[11px] text-kanban-muted-foreground">
              No task is due in the next {TIMELINE_DAYS} days.
            </p>
          )}
        </div>
        {undated ? (
          <p className="mt-4 border-t border-kanban-border pt-3 text-[10px] text-kanban-muted-foreground">
            {undated} {undated === 1 ? 'task has' : 'tasks have'} no due date in this window and
            {undated === 1 ? ' is' : ' are'} not shown.
          </p>
        ) : null}
      </div>
    </div>
  )
}

function CalendarView({
  tasks,
  onOpen
}: {
  tasks: Task[]
  onOpen: (id: string) => void
}): React.JSX.Element {
  const [monthOffset, setMonthOffset] = useState(0)
  const today = startOfDay(Date.now())
  const now = new Date(today)
  const monthStart = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  // Grid starts on the Sunday on or before the 1st, and always runs 6 rows so
  // the layout does not jump between months.
  const gridStart = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    1 - monthStart.getDay()
  ).getTime()

  const byDay = new Map<number, Task[]>()
  for (const task of tasks) {
    const due = parseDueDate(task.dueDate)
    if (due === null) {
      continue
    }
    const bucket = byDay.get(due)
    if (bucket) {
      bucket.push(task)
    } else {
      byDay.set(due, [task])
    }
  }

  return (
    <div className="min-h-0 flex-1 p-4">
      <div className="flex h-full flex-col rounded-xl border border-kanban-border bg-kanban-card">
        <div className="flex items-center justify-between border-b border-kanban-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            {monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setMonthOffset(0)}>
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => setMonthOffset((value) => value - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next month"
              onClick={() => setMonthOffset((value) => value + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-7 grid-rows-[28px_repeat(6,1fr)]">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div
              key={day}
              className="border-b border-r border-kanban-border p-2 text-center text-[10px] font-medium text-kanban-muted-foreground"
            >
              {day}
            </div>
          ))}
          {Array.from({ length: 42 }, (_, index) => {
            const cell = new Date(gridStart)
            cell.setDate(cell.getDate() + index)
            const cellStart = startOfDay(cell.getTime())
            const inMonth = cell.getMonth() === monthStart.getMonth()
            const dayTasks = byDay.get(cellStart) ?? []
            return (
              <div
                key={cellStart}
                className="scrollbar-sleek min-h-20 overflow-auto border-b border-r border-kanban-border p-1.5"
              >
                <span
                  className={
                    cellStart === today
                      ? 'grid size-5 place-items-center rounded-full bg-kanban-accent text-[10px] text-kanban-accent-foreground'
                      : `text-[10px] ${inMonth ? 'text-kanban-muted-foreground' : 'text-kanban-muted-foreground/50'}`
                  }
                >
                  {cell.getDate()}
                </span>
                {dayTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpen(task.id)}
                    className={`mt-1 block w-full truncate rounded px-1.5 py-1 text-left text-[9px] outline-none focus-visible:ring-2 focus-visible:ring-kanban-accent kanban-timeline-${task.status}`}
                  >
                    {task.title}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ActivityView({
  tasks,
  onOpen
}: {
  tasks: Task[]
  onOpen: (id: string) => void
}): React.JSX.Element {
  /* The only real event log on a task is `dispatch` — what the agent runner
   * wrote. There is no comment or attachment history behind this view, so it
   * shows agent runs and nothing else. */
  const events = tasks
    .flatMap((task) => (task.dispatch ? [{ task, dispatch: task.dispatch }] : []))
    .sort((a, b) => b.dispatch.updatedAt - a.dispatch.updatedAt)
    .slice(0, 20)

  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-3xl space-y-3">
        {events.length ? (
          events.map(({ task, dispatch }) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpen(task.id)}
              className="flex w-full items-start gap-3 rounded-xl border border-kanban-border bg-kanban-card p-4 text-left outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
            >
              <span
                className={`mt-1 grid size-7 shrink-0 place-items-center rounded-full kanban-activity-${task.status}`}
              >
                {dispatch.status === 'succeeded' ? (
                  <Check className="size-3.5" />
                ) : (
                  <Circle className="size-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold">{task.title}</span>
                <span
                  className="mt-1 block text-[11px] text-kanban-muted-foreground"
                  title={dispatch.error ?? undefined}
                >
                  {dispatch.status === 'running'
                    ? `${dispatch.agentName} is working on this`
                    : dispatch.status === 'succeeded'
                      ? `${dispatch.agentName} finished — moved to`
                      : dispatch.status === 'dead'
                        ? `${dispatch.agentName} failed ${dispatch.attempts}x — stopped in`
                        : `${dispatch.agentName} failed in`}{' '}
                  <strong className={`font-medium kanban-status-${task.status}`}>
                    {statusNames[task.status]}
                  </strong>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[10px] tabular-nums text-kanban-muted-foreground">
                {typeof dispatch.costUsd === 'number' ? (
                  <span>${dispatch.costUsd.toFixed(2)}</span>
                ) : null}
                <span>{formatAgo(dispatch.updatedAt)}</span>
              </span>
            </button>
          ))
        ) : (
          <p className="py-10 text-center text-[11px] text-kanban-muted-foreground">
            No agent activity yet. Assign a task to an agent and move it to To Do.
          </p>
        )}
      </div>
    </div>
  )
}

function SecondaryView({
  view,
  tasks,
  onOpen
}: {
  view: Exclude<(typeof views)[number]['id'], 'board'>
  tasks: Task[]
  onOpen: (id: string) => void
}): React.JSX.Element {
  if (view === 'list') {
    return (
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-4">
        <div className="overflow-hidden rounded-xl border border-kanban-border bg-kanban-card">
          <div className="grid grid-cols-[minmax(260px,2fr)_130px_110px_110px_80px] border-b border-kanban-border bg-kanban-column px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-kanban-muted-foreground">
            <span>Task</span>
            <span>Status</span>
            <span>Type</span>
            <span>Priority</span>
            <span>Files</span>
          </div>
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpen(task.id)}
              className="grid w-full grid-cols-[minmax(260px,2fr)_130px_110px_110px_80px] items-center border-b border-kanban-border px-4 py-3 text-left text-xs outline-none last:border-0 hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
            >
              <span className="font-medium">{task.title}</span>
              <span className={`kanban-status-${task.status}`}>{statusNames[task.status]}</span>
              <span className="capitalize text-kanban-muted-foreground">{task.type}</span>
              <span className="capitalize text-kanban-muted-foreground">{task.priority}</span>
              <span className="flex items-center gap-1 tabular-nums text-kanban-muted-foreground">
                <Paperclip className="size-3" />
                {task.files.length}
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (view === 'timeline') {
    return <TimelineView tasks={tasks} onOpen={onOpen} />
  }

  if (view === 'calendar') {
    return <CalendarView tasks={tasks} onOpen={onOpen} />
  }

  if (view === 'analytics') {
    const counts = new Map<string, number>()
    for (const task of tasks) {
      if (!task.assignee) {
        continue
      }
      counts.set(task.assignee.name, (counts.get(task.assignee.name) ?? 0) + 1)
    }
    const workload = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
    const workloadMax = Math.max(1, ...workload.map((entry) => entry.count))
    const totals = statuses.map((status) => ({
      status,
      count: tasks.filter((task) => task.status === status).length
    }))
    return (
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total tasks', value: tasks.length },
            {
              label: 'In progress',
              value: totals.find((item) => item.status === 'in-progress')?.count ?? 0
            },
            {
              label: 'Completion rate',
              value: `${completionRatePercent(totals.find((item) => item.status === 'done')?.count ?? 0, tasks.length)}%`
            },
            {
              label: 'High priority',
              value: tasks.filter((task) => task.priority === 'high').length
            }
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-xl border border-kanban-border bg-kanban-card p-4"
            >
              <span className="text-[10px] text-kanban-muted-foreground">{metric.label}</span>
              <p className="mt-2 text-2xl font-bold tabular-nums">{metric.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[1.35fr_1fr] gap-3">
          <div className="rounded-xl border border-kanban-border bg-kanban-card p-5">
            <h2 className="text-sm font-semibold">Tasks by status</h2>
            <div className="mt-6 flex h-52 items-end gap-5">
              {totals.map(({ status, count }) => (
                <div key={status} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-xs font-semibold tabular-nums">{count}</span>
                  <span
                    className={`w-full rounded-t-md kanban-chart-${status}`}
                    style={{ height: `${48 + count * 25}px` }}
                  />
                  <span className="text-center text-[9px] text-kanban-muted-foreground">
                    {statusNames[status]}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-kanban-border bg-kanban-card p-5">
            <h2 className="text-sm font-semibold">Team workload</h2>
            {/* Why derived: this panel used to list four invented teammates
                with percentages from `72 - index * 11`. Counts now come from
                who the tasks are actually assigned to. */}
            <div className="mt-5 space-y-5">
              {workload.length ? (
                workload.map(({ name, count }) => (
                  <div key={name}>
                    <div className="mb-1.5 flex justify-between text-[10px]">
                      <span className="truncate">{name}</span>
                      <span className="tabular-nums text-kanban-muted-foreground">{count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-kanban-column">
                      <div
                        className="h-full rounded-full bg-kanban-accent"
                        style={{ width: `${(count / workloadMax) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-kanban-muted-foreground">
                  No tasks are assigned yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <ActivityView tasks={tasks} onOpen={onOpen} />
}

const missingTaskAuthority = async (): Promise<never> => {
  throw new Error('Vertex task authority is unavailable')
}
const unavailableTaskSource: TaskSource = {
  list: missingTaskAuthority,
  create: missingTaskAuthority,
  update: missingTaskAuthority,
  move: missingTaskAuthority,
  remove: missingTaskAuthority
}

export default function KanbanBoard({ source }: { source?: TaskSource }): React.JSX.Element {
  const taskSource = useMemo(
    () => source ?? getKanbanIpcSource() ?? unavailableTaskSource,
    [source]
  )
  const [jobsOpen, setJobsOpen] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [activeView, setActiveView] = useState<(typeof views)[number]['id']>('board')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ status: TaskStatus; index: number } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filterHigh, setFilterHigh] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>('todo')
  const [newTaskType, setNewTaskType] = useState<TaskType>('feature')
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium')
  // '' means unassigned. Real agents come from the Agents tab's roster.
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState('')
  const [newTaskDestination, setNewTaskDestination] = useState<VertexTaskDestination>('system')
  const assignablePeople = useAssignablePeople()
  // Non-zero while a drag or a local write is outstanding — see the poll below.
  const busy = useRef(0)
  const loadTasks = useCallback(
    async (isCancelled?: () => boolean): Promise<void> => {
      const listed = await taskSource.list()
      if (!isCancelled?.()) {
        setTasks(listed)
      }
    },
    [taskSource]
  )
  const refreshTasks = useCallback((): void => {
    if (refreshing) {
      return
    }
    setRefreshing(true)
    void loadTasks()
      .catch(() => {
        toast.error('Failed to refresh tasks')
      })
      .finally(() => {
        setRefreshing(false)
      })
  }, [loadTasks, refreshing])

  /* Poll, don't just load once: board-dispatch.ts writes claim -> running ->
   * succeeded straight to the store from another module, so without this the
   * card sits in To Do while the agent runs, finishes and moves it to Review.
   * Skipped mid-drag and while a write is in flight so a refresh cannot fight
   * the optimistic update. */
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      // Why a sticky toast: an unreadable board file makes the store refuse
      // every call; without this the board just looks empty.
      void loadTasks(() => cancelled).then(
        () => toast.dismiss(LOAD_ERROR_TOAST_ID),
        (error: unknown) => {
          if (!cancelled) {
            toast.error('Kanban board could not be loaded', {
              id: LOAD_ERROR_TOAST_ID,
              description: extractIpcErrorMessage(error, 'Unknown error'),
              duration: Infinity
            })
          }
        }
      )
    }
    load()
    // Why visibility-gated: a hidden window (or a board under another surface)
    // has nobody to show the refresh to; the next visible tick catches up.
    const timer = setInterval(() => {
      if (busy.current === 0 && document.visibilityState !== 'hidden') {
        load()
      }
    }, REFRESH_MS)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && busy.current === 0) {
        load()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      toast.dismiss(LOAD_ERROR_TOAST_ID)
    }
  }, [loadTasks])

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesQuery =
          !query || `${task.title} ${task.description}`.toLowerCase().includes(query.toLowerCase())
        return (
          matchesQuery && (!filterHigh || task.priority === 'high' || task.priority === 'urgent')
        )
      }),
    [tasks, query, filterHigh]
  )
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null

  // A Done write without a note waits here for the dialog; Cancel drops it,
  // so the card never leaves its column.
  const [pendingDone, setPendingDone] = useState<PendingDone | null>(null)
  const confirmDoneNote = (resultNote: string): void => {
    const pending = pendingDone
    if (!pending) {
      return
    }
    setPendingDone(null)
    if (pending.kind === 'move') {
      moveTask(pending.taskId, pending.status, pending.index, resultNote)
    } else {
      updateTask(pending.taskId, { ...pending.patch, resultNote, completedAt: Date.now() })
    }
  }

  const updateTask = (taskId: string, patch: Parameters<TaskSource['update']>[1]): void => {
    const target = tasks.find((task) => task.id === taskId)
    if (patch.status === 'done' && target && !patch.resultNote?.trim()) {
      const existing = target.resultNote?.trim()
      if (!existing) {
        setPendingDone({ kind: 'update', taskId, patch })
        return
      }
      patch = { ...patch, resultNote: existing, completedAt: Date.now() }
    }
    const previous = tasks
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, ...patch, updatedAt: Date.now() } : task
      )
    )
    busy.current += 1
    void taskSource
      .update(taskId, patch)
      .then((updated) => {
        if (!updated) {
          setTasks(previous)
        } else {
          setTasks((current) => current.map((task) => (task.id === taskId ? updated : task)))
        }
      })
      .catch(() => setTasks(previous))
      .finally(() => {
        busy.current -= 1
      })
  }
  const moveTask = (taskId: string, status: TaskStatus, index: number, note?: string): void => {
    const previous = tasks
    const target = tasks.find((task) => task.id === taskId)
    let proofPatch: Pick<Task, 'resultNote' | 'completedAt'> | null = null
    if (status === 'done' && target && !target.resultNote?.trim()) {
      if (!note) {
        setPendingDone({ kind: 'move', taskId, status, index })
        return
      }
      proofPatch = { resultNote: note, completedAt: Date.now() }
    }
    setTasks((current) =>
      moveTasksOptimistically(
        current.map((task) =>
          task.id === taskId && proofPatch ? { ...task, ...proofPatch } : task
        ),
        taskId,
        status,
        index
      )
    )
    busy.current += 1
    const persistProof = proofPatch
      ? taskSource.update(taskId, proofPatch).then((updated) => Boolean(updated))
      : Promise.resolve(true)
    void persistProof
      .then((ready) => (ready ? taskSource.move(taskId, status, index) : null))
      .then(async (moved) => {
        if (!moved) {
          setTasks(previous)
        } else {
          setTasks(await taskSource.list())
        }
      })
      .catch(() => setTasks(previous))
      .finally(() => {
        busy.current -= 1
      })
  }
  const createTask = (status: TaskStatus): void => {
    setNewTaskStatus(status)
    setNewTaskOpen(true)
  }
  const submitNewTask = async (): Promise<void> => {
    const title = newTaskTitle.trim()
    if (!title) {
      return
    }
    const task = await taskSource.create({
      title,
      status: newTaskStatus,
      type: newTaskType,
      priority: newTaskPriority,
      destination: newTaskDestination,
      assignee: assignablePeople.find((person) => person.id === newTaskAssigneeId)
    })
    if (!task) {
      return
    }
    setTasks((current) => [...current, task])
    setSelectedTaskId(task.id)
    toast.success(
      task.assignee
        ? `Created and assigned to ${task.assignee.name}`
        : `Created in ${statusNames[task.status]}`,
      { description: task.destination === 'asana' ? 'Destination: Asana' : 'Destination: system' }
    )
    setNewTaskTitle('')
    setNewTaskAssigneeId('')
    setNewTaskOpen(false)
  }
  const createChildTask = async (
    parent: Task,
    title: string,
    assigneeId: string
  ): Promise<void> => {
    const trimmed = title.trim()
    if (!trimmed) {
      return
    }
    const task = await taskSource.create({
      title: trimmed,
      status: 'todo',
      type: parent.type,
      priority: parent.priority,
      destination: 'system',
      parentTaskId: parent.id,
      assignee: assignablePeople.find((person) => person.id === assigneeId),
      origin: {
        kind: 'agent',
        name: parent.assignee?.name ?? 'Dobius system',
        note: `Child task from ${parent.title}`
      }
    })
    if (!task) {
      toast.error('Could not create child task')
      return
    }
    setTasks(await taskSource.list())
    setSelectedTaskId(task.id)
    toast.success('Child task created', {
      description: task.assignee ? `Assigned to ${task.assignee.name}` : 'Unassigned'
    })
  }

  if (jobsOpen) {
    return (
      <main className="flex h-full min-h-0 flex-1 flex-col">
        <div className="border-b border-border p-2">
          <Button variant="ghost" size="sm" onClick={() => setJobsOpen(false)}>
            Back to tasks
          </Button>
        </div>
        <KanbanJobLanes />
      </main>
    )
  }
  return (
    <TooltipProvider>
      <main className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-kanban-background font-sans text-kanban-foreground">
        <header className="shrink-0 border-b border-kanban-border px-5 pt-4">
          <div className="flex items-start justify-between gap-5">
            <p className="self-center text-[11px] text-kanban-muted-foreground">
              Visualize work. Assign agents. Ship faster.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setJobsOpen(true)}>
                Jobs
              </Button>
              <Button
                variant={filterHigh ? 'secondary' : 'outline'}
                className="h-9 border-kanban-border bg-kanban-control text-xs"
                onClick={() => setFilterHigh((value) => !value)}
              >
                <Filter />
                High priority
              </Button>
              {searchOpen ? (
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSearchOpen(false)
                      setQuery('')
                    }
                  }}
                  aria-label="Search tasks"
                  className="h-9 w-40 border-kanban-border bg-kanban-control"
                />
              ) : (
                <Button
                  variant="outline"
                  className="h-9 border-kanban-border bg-kanban-control text-xs"
                  onClick={() => setSearchOpen(true)}
                >
                  <Search />
                  Search
                </Button>
              )}
              <Button
                variant="outline"
                className="h-9 border-kanban-border bg-kanban-control text-xs"
                onClick={refreshTasks}
                disabled={refreshing}
              >
                <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
                Refresh
              </Button>
              <div className="flex">
                {/* Why: --board-accent exists only inside the Board surface, so the
                    button takes the Board blue there and keeps the Kanban purple elsewhere. */}
                <Button
                  onClick={() => createTask('todo')}
                  className="h-9 rounded-r-none bg-[var(--board-accent,var(--kanban-accent))] text-xs text-[var(--board-accent-fg,var(--kanban-accent-foreground))] hover:bg-[var(--board-accent,var(--kanban-accent-hover))] hover:opacity-90"
                >
                  <Plus />
                  New Task
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="h-9 rounded-l-none border-l border-[color:var(--board-accent-tint,var(--kanban-accent-border))] bg-[var(--board-accent,var(--kanban-accent))] px-2 text-[var(--board-accent-fg,var(--kanban-accent-foreground))] hover:bg-[var(--board-accent,var(--kanban-accent-hover))] hover:opacity-90"
                      aria-label="New task options"
                    >
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {statuses.map((status) => (
                      <DropdownMenuItem key={status} onClick={() => createTask(status)}>
                        Add to {statusNames[status]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
          <nav className="mt-4 flex h-10 items-end gap-1" aria-label="Kanban views">
            {views.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveView(id)
                  setSelectedTaskId(null)
                }}
                className={`flex h-10 items-center gap-2 border-b-2 px-3 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-kanban-accent ${activeView === id ? 'border-kanban-accent text-kanban-foreground' : 'border-transparent text-kanban-muted-foreground hover:text-kanban-foreground'}`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </nav>
        </header>

        {activeView === 'board' ? (
          <div className="scrollbar-sleek min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-2 py-3">
            <div className="flex h-full min-w-max gap-2">
              {statuses.map((status) => (
                <KanbanColumn
                  key={status}
                  status={status}
                  tasks={visibleTasks.filter((task) => task.status === status)}
                  draggedTaskId={draggedTaskId}
                  dropIndex={dropTarget?.status === status ? (dropTarget?.index ?? null) : null}
                  onOpen={setSelectedTaskId}
                  onCreate={createTask}
                  onDragStart={(taskId) => {
                    busy.current += 1
                    setDraggedTaskId(taskId)
                  }}
                  onDragEnd={() => {
                    busy.current -= 1
                    setDraggedTaskId(null)
                    setDropTarget(null)
                  }}
                  onDragOver={(nextStatus, index) => setDropTarget({ status: nextStatus, index })}
                  onDrop={(nextStatus, index, transferredTaskId) => {
                    const taskId = transferredTaskId || draggedTaskId
                    if (taskId) {
                      moveTask(taskId, nextStatus, index)
                    }
                    setDraggedTaskId(null)
                    setDropTarget(null)
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <SecondaryView view={activeView} tasks={visibleTasks} onOpen={setSelectedTaskId} />
        )}

        {selectedTask ? (
          <KanbanDetailPanel
            task={selectedTask}
            allTasks={tasks}
            onClose={() => setSelectedTaskId(null)}
            onUpdate={(patch) => updateTask(selectedTask.id, patch)}
            onComment={
              taskSource.comment
                ? (body) => {
                    busy.current += 1
                    void taskSource
                      .comment?.(selectedTask.id, OPERATOR.id, body)
                      .then((updated) => {
                        if (updated) {
                          setTasks((current) =>
                            current.map((task) => (task.id === updated.id ? updated : task))
                          )
                        }
                      })
                      .catch(() => toast.error('Failed to add comment'))
                      .finally(() => {
                        busy.current -= 1
                      })
                  }
                : undefined
            }
            onCreateChild={(title, assigneeId) => createChildTask(selectedTask, title, assigneeId)}
            onAttachmentAdded={(attachment) =>
              setTasks((current) =>
                current.map((task) =>
                  task.id === selectedTask.id
                    ? { ...task, attachments: [...(task.attachments ?? []), attachment] }
                    : task
                )
              )
            }
            onDelete={() => {
              const previous = tasks
              setTasks((current) => current.filter((task) => task.id !== selectedTask.id))
              setSelectedTaskId(null)
              busy.current += 1
              void taskSource
                .remove(selectedTask.id)
                .then((removed) => {
                  if (!removed) {
                    setTasks(previous)
                  }
                })
                .catch(() => setTasks(previous))
                .finally(() => {
                  busy.current -= 1
                })
            }}
          />
        ) : null}

        <KanbanDoneNoteDialog
          open={pendingDone !== null}
          onCancel={() => setPendingDone(null)}
          onConfirm={confirmDoneNote}
        />

        <Dialog open={newTaskOpen} onOpenChange={setNewTaskOpen}>
          <DialogContent className="max-w-md border-kanban-border bg-kanban-panel text-kanban-foreground">
            <DialogHeader>
              <DialogTitle>Create a task</DialogTitle>
              <DialogDescription>
                Choose where the task starts and how the team should classify it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <label className="space-y-1.5 text-xs font-medium">
                <span>Task title</span>
                <Input
                  autoFocus
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      submitNewTask()
                    }
                  }}
                  placeholder="What needs to be done?"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1.5 text-xs">
                  <span>Status</span>
                  <Select
                    value={newTaskStatus}
                    onValueChange={(value) => setNewTaskStatus(value as TaskStatus)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {statusNames[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5 text-xs">
                  <span>Type</span>
                  <Select
                    value={newTaskType}
                    onValueChange={(value) => setNewTaskType(value as TaskType)}
                  >
                    <SelectTrigger className="w-full capitalize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['feature', 'design', 'integration', 'ai', 'security', 'infra', 'bug'].map(
                        (type) => (
                          <SelectItem key={type} value={type} className="capitalize">
                            {type}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5 text-xs">
                  <span>Priority</span>
                  <Select
                    value={newTaskPriority}
                    onValueChange={(value) => setNewTaskPriority(value as TaskPriority)}
                  >
                    <SelectTrigger className="w-full capitalize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['low', 'medium', 'high', 'urgent'].map((priority) => (
                        <SelectItem key={priority} value={priority} className="capitalize">
                          {priority}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <label className="space-y-1.5 text-xs">
                <span>Destination</span>
                <Select
                  value={newTaskDestination}
                  onValueChange={(value) => setNewTaskDestination(value as VertexTaskDestination)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System task (stays in Dobius)</SelectItem>
                    <SelectItem value="asana">Asana</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5 text-xs">
                <span>Assign to</span>
                <Select
                  value={newTaskAssigneeId || 'unassigned'}
                  onValueChange={(value) =>
                    setNewTaskAssigneeId(value === 'unassigned' ? '' : value)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {assignablePeople.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name}
                        {person.kind === 'agent' ? ' (agent)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewTaskOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!newTaskTitle.trim()}
                onClick={submitNewTask}
                className="bg-kanban-accent text-kanban-accent-foreground hover:bg-kanban-accent-hover"
              >
                <Plus />
                Create Task
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  )
}
