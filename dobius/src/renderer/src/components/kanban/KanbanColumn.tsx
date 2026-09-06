import { Check, Circle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { KanbanCard } from './KanbanCard'
import type { Task, TaskStatus } from './kanban-types'

const statusMeta: Record<TaskStatus, { label: string; count: number }> = {
  backlog: { label: 'Backlog', count: 12 },
  todo: { label: 'To Do', count: 8 },
  'in-progress': { label: 'In Progress', count: 6 },
  review: { label: 'Review', count: 4 },
  testing: { label: 'Testing', count: 3 },
  done: { label: 'Done', count: 28 }
}

export function KanbanColumn({
  status,
  tasks,
  draggedTaskId,
  dropIndex,
  onOpen,
  onCreate,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}: {
  status: TaskStatus
  tasks: Task[]
  draggedTaskId: string | null
  dropIndex: number | null
  onOpen: (taskId: string) => void
  onCreate: (status: TaskStatus) => void
  onDragStart: (taskId: string) => void
  onDragEnd: () => void
  onDragOver: (status: TaskStatus, index: number) => void
  onDrop: (status: TaskStatus, index: number) => void
}): React.JSX.Element {
  const meta = statusMeta[status]
  return (
    <section
      className="flex h-full w-[274px] shrink-0 flex-col overflow-hidden rounded-[10px] border border-kanban-border bg-kanban-column"
      aria-labelledby={`kanban-column-${status}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); onDrop(status, tasks.length) }}
    >
      <header className={`kanban-column-header kanban-status-${status}`}>
        <span className="grid size-5 place-items-center rounded-md bg-current/15">
          {status === 'done' ? <Check className="size-3" strokeWidth={3} /> : <Circle className="size-3" fill="currentColor" />}
        </span>
        <h2 id={`kanban-column-${status}`} className="text-[12px] font-semibold text-kanban-foreground">{meta.label}</h2>
        <span className="rounded-full bg-kanban-count px-2 py-0.5 text-[10px] tabular-nums text-kanban-muted-foreground">{meta.count}</span>
        <Button variant="ghost" size="icon-xs" className="ml-auto text-current hover:bg-current/10" onClick={() => onCreate(status)} aria-label={`Add task to ${meta.label}`}>
          <Plus />
        </Button>
      </header>
      <div className="scrollbar-sleek min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {tasks.map((task, index) => (
          <div
            key={task.id}
            onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); onDragOver(status, index) }}
            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onDrop(status, index) }}
          >
            {draggedTaskId && dropIndex === index ? <div className="mb-2 h-20 rounded-lg border border-dashed border-kanban-accent bg-kanban-accent-soft" /> : null}
            <KanbanCard
              task={task}
              dragging={draggedTaskId === task.id}
              onOpen={() => onOpen(task.id)}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id); onDragStart(task.id) }}
              onDragEnd={onDragEnd}
            />
          </div>
        ))}
        {draggedTaskId && dropIndex === tasks.length ? <div className="h-20 rounded-lg border border-dashed border-kanban-accent bg-kanban-accent-soft" /> : null}
        <button type="button" onClick={() => onCreate(status)} className={cn('flex h-9 w-full items-center gap-2 rounded-md border border-kanban-border px-3 text-[11px] text-kanban-muted-foreground outline-none hover:bg-kanban-hover hover:text-kanban-foreground focus-visible:ring-2 focus-visible:ring-kanban-accent')}>
          <Plus className="size-3.5" /> Add task
        </button>
      </div>
    </section>
  )
}
