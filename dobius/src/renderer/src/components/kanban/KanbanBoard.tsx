import { useEffect, useMemo, useState } from 'react'
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
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  SlidersHorizontal
} from 'lucide-react'
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
import { kanbanMockSource } from './kanban-mock-source'
import { getKanbanIpcSource } from './kanban-ipc-source'
import { moveTasksOptimistically } from './kanban-ordering'
import { KanbanColumn } from './KanbanColumn'
import { KanbanDetailPanel } from './KanbanDetailPanel'
import type { Task, TaskPriority, TaskSource, TaskStatus, TaskType } from './kanban-types'

const statuses: TaskStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'testing', 'done']
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
  review: 'Review',
  testing: 'Testing',
  done: 'Done'
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
  if (view === 'list')
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

  if (view === 'timeline')
    return (
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-4">
        <div className="min-w-[900px] rounded-xl border border-kanban-border bg-kanban-card p-4">
          <div className="mb-4 grid grid-cols-[180px_repeat(6,1fr)] text-center text-[10px] text-kanban-muted-foreground">
            <span className="text-left">September 2026</span>
            {['Mon 7', 'Tue 8', 'Wed 9', 'Thu 10', 'Fri 11', 'Sat 12'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="space-y-3">
            {tasks.slice(0, 12).map((task, index) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpen(task.id)}
                className="grid w-full grid-cols-[180px_1fr] items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-kanban-accent"
              >
                <span className="truncate text-xs font-medium">{task.title}</span>
                <span className="relative h-8 rounded-md bg-kanban-column">
                  <span
                    className={`absolute inset-y-1 rounded-md px-3 py-1 text-[10px] font-medium kanban-timeline-${task.status}`}
                    style={{ left: `${(index % 5) * 12}%`, width: `${24 + (index % 3) * 8}%` }}
                  >
                    {statusNames[task.status]}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )

  if (view === 'calendar')
    return (
      <div className="min-h-0 flex-1 p-4">
        <div className="flex h-full flex-col rounded-xl border border-kanban-border bg-kanban-card">
          <div className="flex items-center justify-between border-b border-kanban-border px-4 py-3">
            <h2 className="text-sm font-semibold">September 2026</h2>
            <div className="flex gap-1">
              <Button variant="outline" size="sm">
                Today
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Previous month">
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next month">
                <ChevronRight />
              </Button>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-7 grid-rows-[28px_repeat(5,1fr)]">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div
                key={day}
                className="border-b border-r border-kanban-border p-2 text-center text-[10px] font-medium text-kanban-muted-foreground"
              >
                {day}
              </div>
            ))}
            {Array.from({ length: 35 }, (_, index) => {
              const day = index + 1
              const dayTasks = tasks.filter((_, taskIndex) => taskIndex % 30 === index)
              return (
                <div key={day} className="min-h-20 border-b border-r border-kanban-border p-1.5">
                  <span
                    className={`text-[10px] ${day === 12 ? 'grid size-5 place-items-center rounded-full bg-kanban-accent text-kanban-accent-foreground' : 'text-kanban-muted-foreground'}`}
                  >
                    {day}
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

  if (view === 'analytics') {
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
              value: `${Math.round(((totals.find((item) => item.status === 'done')?.count ?? 0) / tasks.length) * 100)}%`
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
            <div className="mt-5 space-y-5">
              {['Vision (Design)', 'Maya Chen', 'Sam Ortiz', 'Lee Park'].map((name, index) => (
                <div key={name}>
                  <div className="mb-1.5 flex justify-between text-[10px]">
                    <span>{name}</span>
                    <span className="tabular-nums text-kanban-muted-foreground">
                      {72 - index * 11}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-kanban-column">
                    <div
                      className="h-full rounded-full bg-kanban-accent"
                      style={{ width: `${72 - index * 11}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-3xl space-y-3">
        {tasks.slice(0, 12).map((task, index) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onOpen(task.id)}
            className="flex w-full items-start gap-3 rounded-xl border border-kanban-border bg-kanban-card p-4 text-left outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
          >
            <span
              className={`mt-1 grid size-7 shrink-0 place-items-center rounded-full kanban-activity-${task.status}`}
            >
              {task.status === 'done' ? (
                <Check className="size-3.5" />
              ) : (
                <Circle className="size-3.5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">{task.title}</span>
              <span className="mt-1 block text-[11px] text-kanban-muted-foreground">
                {index % 3 === 0
                  ? 'Status changed to'
                  : index % 3 === 1
                    ? 'New comment added in'
                    : 'Attachment uploaded to'}{' '}
                <strong className={`font-medium kanban-status-${task.status}`}>
                  {statusNames[task.status]}
                </strong>
              </span>
            </span>
            <span className="flex items-center gap-1 text-[10px] text-kanban-muted-foreground">
              <MessageCircle className="size-3" />
              {index + 2}h
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function KanbanBoard({ source }: { source?: TaskSource }): React.JSX.Element {
  const taskSource = useMemo(() => source ?? getKanbanIpcSource() ?? kanbanMockSource, [source])
  const [tasks, setTasks] = useState<Task[]>([])
  const [activeView, setActiveView] = useState<(typeof views)[number]['id']>('board')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ status: TaskStatus; index: number } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filterHigh, setFilterHigh] = useState(false)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>('todo')
  const [newTaskType, setNewTaskType] = useState<TaskType>('feature')
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium')

  useEffect(() => {
    let cancelled = false
    void taskSource.list().then((listed) => {
      if (!cancelled) setTasks(listed)
    })
    return () => {
      cancelled = true
    }
  }, [taskSource])

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

  const updateTask = (taskId: string, patch: Parameters<TaskSource['update']>[1]): void => {
    const previous = tasks
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, ...patch, updatedAt: Date.now() } : task
      )
    )
    void taskSource
      .update(taskId, patch)
      .then((updated) => {
        if (!updated) setTasks(previous)
        else setTasks((current) => current.map((task) => (task.id === taskId ? updated : task)))
      })
      .catch(() => setTasks(previous))
  }
  const moveTask = (taskId: string, status: TaskStatus, index: number): void => {
    const previous = tasks
    setTasks((current) => moveTasksOptimistically(current, taskId, status, index))
    void taskSource
      .move(taskId, status, index)
      .then(async (moved) => {
        if (!moved) setTasks(previous)
        else setTasks(await taskSource.list())
      })
      .catch(() => setTasks(previous))
  }
  const createTask = (status: TaskStatus): void => {
    setNewTaskStatus(status)
    setNewTaskOpen(true)
  }
  const submitNewTask = async (): Promise<void> => {
    const title = newTaskTitle.trim()
    if (!title) return
    const task = await taskSource.create({
      title,
      status: newTaskStatus,
      type: newTaskType,
      priority: newTaskPriority
    })
    if (!task) return
    setTasks((current) => [...current, task])
    setSelectedTaskId(task.id)
    setNewTaskTitle('')
    setNewTaskOpen(false)
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
              <div className="flex">
                <Button
                  onClick={() => createTask('todo')}
                  className="h-9 rounded-r-none bg-kanban-accent text-xs text-kanban-accent-foreground hover:bg-kanban-accent-hover"
                >
                  <Plus />
                  New Task
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="h-9 rounded-l-none border-l border-kanban-accent-border bg-kanban-accent px-2 text-kanban-accent-foreground hover:bg-kanban-accent-hover"
                      aria-label="New task options"
                    >
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {statuses.map((status) => (
                      <DropdownMenuItem key={status} onClick={() => createTask(status)}>
                        Add to {status}
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
                  onDragStart={setDraggedTaskId}
                  onDragEnd={() => {
                    setDraggedTaskId(null)
                    setDropTarget(null)
                  }}
                  onDragOver={(nextStatus, index) => setDropTarget({ status: nextStatus, index })}
                  onDrop={(nextStatus, index, transferredTaskId) => {
                    const taskId = transferredTaskId || draggedTaskId
                    if (taskId) moveTask(taskId, nextStatus, index)
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
            onClose={() => setSelectedTaskId(null)}
            onUpdate={(patch) => updateTask(selectedTask.id, patch)}
            onDelete={() => {
              const previous = tasks
              setTasks((current) => current.filter((task) => task.id !== selectedTask.id))
              setSelectedTaskId(null)
              void taskSource
                .remove(selectedTask.id)
                .then((removed) => {
                  if (!removed) setTasks(previous)
                })
                .catch(() => setTasks(previous))
            }}
          />
        ) : null}

        <Dialog open={newTaskOpen} onOpenChange={setNewTaskOpen}>
          <DialogContent className="max-w-md border-kanban-border bg-kanban-panel text-kanban-foreground">
            <DialogHeader>
              <DialogTitle>Create a Vertex task</DialogTitle>
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
                    if (event.key === 'Enter') submitNewTask()
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
