import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AudioWaveform, BarChart3, CalendarDays, ChevronDown, ChevronsLeft, Clock3,
  Columns3, Filter, ImagePlus, List, Mic2, NotebookPen, Plus, Search, SlidersHorizontal,
  Sparkles, SquareDashed, Workflow
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { kanbanMockSource } from './kanban-mock-source'
import { KanbanColumn } from './KanbanColumn'
import { KanbanDetailPanel } from './KanbanDetailPanel'
import type { TaskSource, TaskStatus } from './kanban-types'

const statuses: TaskStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'testing', 'done']
const views = [
  { id: 'board', label: 'Board', icon: Columns3 }, { id: 'list', label: 'List', icon: List },
  { id: 'timeline', label: 'Timeline', icon: SlidersHorizontal }, { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 }, { id: 'activity', label: 'Activity', icon: Activity }
] as const

function IconButton({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={label}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}

export default function KanbanBoard({ source = kanbanMockSource }: { source?: TaskSource }): React.JSX.Element {
  const [revision, setRevision] = useState(0)
  const [activeView, setActiveView] = useState<(typeof views)[number]['id']>('board')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>('vertex-1')
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ status: TaskStatus; index: number } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filterHigh, setFilterHigh] = useState(false)
  const [time, setTime] = useState(() => new Date())
  const tasks = source.list()

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const matchesQuery = !query || `${task.title} ${task.description}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (!filterHigh || task.priority === 'high' || task.priority === 'urgent')
  }), [tasks, query, filterHigh, revision])
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null

  const mutate = (action: () => void): void => { action(); setRevision((value) => value + 1) }
  const createTask = (status: TaskStatus): void => {
    const task = source.create({ title: 'Untitled Vertex task', status })
    setSelectedTaskId(task.id)
    setRevision((value) => value + 1)
  }

  return (
    <main className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-kanban-background font-sans text-kanban-foreground">
      <header className="shrink-0 border-b border-kanban-border px-5 pt-4">
        <div className="flex items-start justify-between gap-5">
          <div><h1 className="text-[25px] leading-tight font-bold tracking-tight">Kanban Board</h1><p className="mt-1 text-[11px] text-kanban-muted-foreground">Visualize work. Assign agents. Ship faster.</p></div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="h-9 min-w-48 justify-between border-kanban-border bg-kanban-control text-xs"><span className="text-kanban-muted-foreground">Project</span><span className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-md bg-kanban-accent text-kanban-accent-foreground"><Workflow className="size-3" /></span>Vertex</span><ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Vertex</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            <Button variant={filterHigh ? 'secondary' : 'outline'} className="h-9 border-kanban-border bg-kanban-control text-xs" onClick={() => setFilterHigh((value) => !value)}><Filter />Filter</Button>
            {searchOpen ? <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setSearchOpen(false); setQuery('') } }} aria-label="Search tasks" className="h-9 w-40 border-kanban-border bg-kanban-control" /> : <Button variant="outline" className="h-9 border-kanban-border bg-kanban-control text-xs" onClick={() => setSearchOpen(true)}><Search />Search</Button>}
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="h-9 border-kanban-border bg-kanban-control text-xs">Group by: Status<ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Status</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            <div className="flex"><Button onClick={() => createTask('todo')} className="h-9 rounded-r-none bg-kanban-accent text-xs text-kanban-accent-foreground hover:bg-kanban-accent-hover"><Plus />New Task</Button><DropdownMenu><DropdownMenuTrigger asChild><Button className="h-9 rounded-l-none border-l border-kanban-accent-border bg-kanban-accent px-2 text-kanban-accent-foreground hover:bg-kanban-accent-hover" aria-label="New task options"><ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{statuses.map((status) => <DropdownMenuItem key={status} onClick={() => createTask(status)}>Add to {status}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>
          </div>
        </div>
        <nav className="mt-4 flex h-10 items-end gap-1" aria-label="Kanban views">
          {views.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveView(id)} className={`flex h-10 items-center gap-2 border-b-2 px-3 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-kanban-accent ${activeView === id ? 'border-kanban-accent text-kanban-foreground' : 'border-transparent text-kanban-muted-foreground hover:text-kanban-foreground'}`}><Icon className="size-3.5" />{id === 'activity' ? <Plus className="size-3" /> : null}{label}</button>)}
        </nav>
      </header>

      {activeView === 'board' ? (
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-2 pt-3 pb-14">
          <div className="flex h-full min-w-max gap-2">
            {statuses.map((status) => <KanbanColumn key={status} status={status} tasks={visibleTasks.filter((task) => task.status === status)} draggedTaskId={draggedTaskId} dropIndex={dropTarget?.status === status ? dropTarget.index : null} onOpen={setSelectedTaskId} onCreate={createTask} onDragStart={setDraggedTaskId} onDragEnd={() => { setDraggedTaskId(null); setDropTarget(null) }} onDragOver={(nextStatus, index) => setDropTarget({ status: nextStatus, index })} onDrop={(nextStatus, index) => { if (draggedTaskId) mutate(() => source.move(draggedTaskId, nextStatus, index)); setDraggedTaskId(null); setDropTarget(null) }} />)}
          </div>
        </div>
      ) : <div className="grid flex-1 place-items-center"><div className="text-center"><SquareDashed className="mx-auto size-9 text-kanban-muted-foreground" /><h2 className="mt-3 text-sm font-semibold">{views.find((view) => view.id === activeView)?.label} view</h2><p className="mt-1 text-xs text-kanban-muted-foreground">Choose Board to return to Vertex tasks.</p></div></div>}

      {selectedTask ? <KanbanDetailPanel task={selectedTask} onClose={() => setSelectedTaskId(null)} onUpdate={(patch) => mutate(() => source.update(selectedTask.id, patch))} /> : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex h-12 items-center justify-between border-t border-kanban-border bg-kanban-dock/95 px-3 backdrop-blur-xl">
        <div className="pointer-events-auto flex items-center gap-2"><IconButton label="Collapse audio"><ChevronsLeft /></IconButton><span className="flex h-7 items-center gap-1 rounded-full bg-kanban-control px-2 text-kanban-accent"><Mic2 className="size-3.5" /><AudioWaveform className="size-5" /></span></div>
        <div className="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 gap-1 rounded-full border border-kanban-border bg-kanban-panel p-1 shadow-kanban-card">
          {[{ label: 'New Task', icon: Plus, action: () => createTask('todo') }, { label: 'Capture Screen', icon: ImagePlus }, { label: 'Add to Canvas', icon: SquareDashed }, { label: 'Ask AI', icon: Sparkles }, { label: 'Create Note', icon: NotebookPen }].map(({ label, icon: Icon, action }) => <Button key={label} variant="ghost" size="sm" className="h-7 rounded-full px-3 text-[10px]" onClick={action}><Icon />{label}</Button>)}
        </div>
        <div className="pointer-events-auto flex items-center gap-4 text-[10px] text-kanban-muted-foreground"><span className="flex items-center gap-2"><span className="size-2 rounded-full bg-kanban-success" />All Systems Operational</span><span className="flex items-center gap-1.5 tabular-nums"><Clock3 className="size-3" />{time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
      </div>
    </main>
  )
}
