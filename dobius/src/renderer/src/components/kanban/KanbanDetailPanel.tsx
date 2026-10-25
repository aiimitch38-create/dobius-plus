import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronDown,
  Paperclip,
  Link2,
  Plus,
  Trash2,
  X,
  Workflow
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AvatarStack } from './AvatarStack'
import { KanbanAttachmentThumb } from './KanbanAttachmentThumb'
import { LabelChip } from './kanban-chips'
import { useAssignablePeople } from './kanban-people'
import type {
  Task,
  TaskPriority,
  TaskSource,
  TaskStatus,
  TaskType,
  VertexTaskDestination
} from './kanban-types'

const statuses: TaskStatus[] = [
  'backlog',
  'todo',
  'in-progress',
  'blocked',
  'review',
  'testing',
  'done'
]
const priorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const types: TaskType[] = ['feature', 'design', 'integration', 'ai', 'security', 'infra', 'bug']
const statusLabel: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  'in-progress': 'In Progress',
  blocked: 'Blocked',
  review: 'Review',
  testing: 'Testing',
  done: 'Done'
}
function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="grid min-h-9 grid-cols-[88px_1fr] items-center gap-3">
      <span className="text-[11px] text-kanban-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function KanbanDetailPanel({
  task,
  allTasks,
  onClose,
  onUpdate,
  onComment,
  onCreateChild,
  onDelete
}: {
  task: Task
  /** Every task on the board: labels and dependencies are drawn from real
   *  data rather than a hardcoded demo list. */
  allTasks: Task[]
  onClose: () => void
  onUpdate: (patch: Parameters<TaskSource['update']>[1]) => void
  /** Absent when the source cannot store comments (the standalone preview). */
  onComment?: (body: string) => void
  onCreateChild: (title: string, assigneeId: string) => void
  onDelete: () => void
}): React.JSX.Element {
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [commentBody, setCommentBody] = useState('')
  const [childTaskTitle, setChildTaskTitle] = useState('')
  const [childAssigneeId, setChildAssigneeId] = useState('')
  const [newLabel, setNewLabel] = useState('')
  // Controlled so picking someone closes the popover — leaving it open read
  // as "nothing happened".
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const assignablePeople = useAssignablePeople()
  // Labels already in use anywhere on the board, minus the ones on this task.
  const availableLabels = useMemo(
    () =>
      [...new Set(allTasks.flatMap((item) => item.labels))]
        .filter((label) => !task.labels.includes(label))
        .sort(),
    [allTasks, task.labels]
  )
  // A dependency is another real task, never a made-up component name.
  const availableDependencies = useMemo(
    () =>
      allTasks.filter(
        (item) => item.id !== task.id && !task.dependencies.includes(item.id)
      ),
    [allTasks, task.id, task.dependencies]
  )
  const parentTask = task.parentTaskId
    ? (allTasks.find((item) => item.id === task.parentTaskId) ?? null)
    : null
  const childTasks = task.childTaskIds
    .map((childId) => allTasks.find((item) => item.id === childId))
    .filter((item): item is Task => Boolean(item))
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <aside
      className="absolute inset-y-2 right-2 z-40 flex w-[420px] max-w-[calc(100%-16px)] animate-in slide-in-from-right-8 flex-col overflow-hidden rounded-xl border border-kanban-border-strong bg-kanban-panel shadow-kanban-panel"
      aria-label={`Task details for ${task.title}`}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-kanban-border px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-kanban-accent text-kanban-accent-foreground">
          <Workflow className="size-4" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{task.title}</h2>
        {/* "Open in new window" was removed rather than left inert: there is no
            route that opens a single task. Copy link is kept because the task
            id is a real, useful thing to hand to an agent or paste in chat. */}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy task id"
          onClick={() => {
            void navigator.clipboard
              .writeText(task.id)
              .then(() => toast.success('Task id copied'))
              .catch(() => toast.error('Could not copy to the clipboard'))
          }}
        >
          <Link2 />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onDelete} aria-label="Delete task">
          <Trash2 />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close task details">
          <X />
        </Button>
      </header>

      <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-kanban-border px-4 py-3">
        <label className="space-y-1 text-[9px] text-kanban-muted-foreground">
          <span>Status</span>
          <Select
            value={task.status}
            onValueChange={(value) => onUpdate({ status: value as TaskStatus })}
          >
            <SelectTrigger size="sm" className={`w-full kanban-status-${task.status}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((value) => (
                <SelectItem key={value} value={value}>
                  {statusLabel[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-[9px] text-kanban-muted-foreground">
          <span>Priority</span>
          <Select
            value={task.priority}
            onValueChange={(value) => onUpdate({ priority: value as TaskPriority })}
          >
            <SelectTrigger
              size="sm"
              className={`w-full capitalize kanban-priority-${task.priority}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorities.map((value) => (
                <SelectItem key={value} value={value} className="capitalize">
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-[9px] text-kanban-muted-foreground">
          <span>Type</span>
          <Select
            value={task.type}
            onValueChange={(value) => onUpdate({ type: value as TaskType })}
          >
            <SelectTrigger size="sm" className={`w-full capitalize kanban-chip-${task.type}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((value) => (
                <SelectItem key={value} value={value} className="capitalize">
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="h-10 w-full shrink-0 justify-start rounded-none border-b border-kanban-border bg-transparent px-3">
          {['details', 'subtasks', 'files', 'activity'].map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="h-10 flex-1 rounded-none border-b-2 border-transparent px-2.5 text-[10px] capitalize data-[state=active]:border-kanban-accent data-[state=active]:bg-transparent"
            >
              {tab}
              {tab === 'files' ? (
                <span className="ml-1 rounded-full bg-kanban-count px-1.5 tabular-nums">
                  {task.files.length}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent
          value="details"
          className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-4 py-4"
        >
          <p className="text-[12px] leading-relaxed text-kanban-foreground">{task.description}</p>
          <div className="mt-4 flex gap-2">
            {task.files
              .filter((file) => file.url)
              .slice(0, 2)
              .map((file, index) => (
                <img
                  key={file.id}
                  src={file.url}
                  alt={file.name}
                  className="aspect-video min-w-0 flex-1 rounded-md border border-kanban-border object-cover"
                  style={{ objectPosition: index ? '70% top' : '25% top' }}
                />
              ))}
          </div>
          {task.attachments?.length ? (
            <div className="mt-4">
              <p className="mb-2 text-[11px] text-kanban-muted-foreground">
                Screenshots ({task.attachments.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {task.attachments.map((attachment) => (
                  <KanbanAttachmentThumb
                    key={attachment.id}
                    taskId={task.id}
                    attachment={attachment}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-4 space-y-1">
            <Field label="Assignee">
              <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-[11px] outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
                  >
                    <AvatarStack people={task.assignee ? [task.assignee] : []} />
                    {task.assignee?.name ?? 'Unassigned'}
                    <ChevronDown className="size-3" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAssigneeOpen(false)
                      if (!task.assignee) {
                        return
                      }
                      onUpdate({ assignee: undefined })
                      toast.success(`Unassigned "${task.title}"`)
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-xs text-kanban-muted-foreground outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
                  >
                    Unassigned
                  </button>
                  {assignablePeople.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => {
                        setAssigneeOpen(false)
                        if (task.assignee?.id === person.id) {
                          return
                        }
                        onUpdate({ assignee: person })
                        // Why a toast: assigning has no other visible effect on
                        // this panel, so without it the click reads as a no-op.
                        toast.success(`Assigned to ${person.name}`, {
                          description:
                            person.kind === 'agent'
                              ? /* Not "will not start on its own": with board
                                   auto mode on, board-dispatch.ts picks the card
                                   up from To Do within 15s and spends real
                                   money (MAX_BUDGET_USD, board-dispatch.ts:31). */
                                task.status === 'todo'
                                ? `"${task.title}" is now on ${person.name}. In To Do with board auto mode on, it starts on its own and can spend up to $3.`
                                : `"${task.title}" is now on ${person.name}. Move it to To Do to start the run.`
                              : `"${task.title}"`
                        })
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-xs outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
                    >
                      <AvatarStack people={[person]} />
                      <span className="flex-1 truncate text-left">{person.name}</span>
                      {person.kind === 'agent' ? (
                        <span className="text-[9px] text-kanban-muted-foreground">agent</span>
                      ) : null}
                      {task.assignee?.id === person.id ? '✓' : ''}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </Field>
            <Field label="Destination">
              <Select
                value={task.destination}
                onValueChange={(value) => {
                  const next = value as VertexTaskDestination
                  if (next === task.destination) {
                    return
                  }
                  onUpdate({ destination: next })
                  toast.success(
                    next === 'asana' ? 'Destination set to Asana' : 'Destination set to system',
                    {
                      description:
                        next === 'asana'
                          ? 'Routing intent only — nothing is pushed to Asana yet.'
                          : 'Stays inside Dobius.'
                    }
                  )
                }}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System task</SelectItem>
                  <SelectItem value="asana">Asana</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Collaborators">
              <div className="flex items-center gap-2">
                <AvatarStack people={task.collaborators} />
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label="Add collaborator">
                      <Plus />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-1">
                    {assignablePeople.map((person) => {
                      const selected = task.collaborators.some((item) => item.id === person.id)
                      return (
                        <button
                          key={person.id}
                          type="button"
                          onClick={() =>
                            onUpdate({
                              collaborators: selected
                                ? task.collaborators.filter((item) => item.id !== person.id)
                                : [...task.collaborators, person]
                            })
                          }
                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-xs outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
                        >
                          <span
                            className={`grid size-4 place-items-center rounded border border-kanban-border ${selected ? 'bg-kanban-accent text-kanban-accent-foreground' : ''}`}
                          >
                            {selected ? '✓' : ''}
                          </span>
                          {person.name}
                        </button>
                      )
                    })}
                  </PopoverContent>
                </Popover>
              </div>
            </Field>
            <Field label="Due date">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md border border-kanban-border px-2.5 py-1.5 text-[11px] outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
                  >
                    <CalendarDays className="size-3.5" />
                    {task.dueDate
                      ? new Intl.DateTimeFormat('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          timeZone: 'UTC'
                        }).format(new Date(task.dueDate))
                      : 'Set date'}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 space-y-1 p-2">
                  {/* Was three hardcoded dates (Sep 12/18/25 2026) and no way to
                      clear one. A native date input is the whole feature. */}
                  <Input
                    type="date"
                    value={task.dueDate ?? ''}
                    onChange={(event) =>
                      onUpdate({ dueDate: event.target.value || undefined })
                    }
                    className="h-8 text-xs"
                  />
                  {task.dueDate ? (
                    <button
                      type="button"
                      onClick={() => onUpdate({ dueDate: undefined })}
                      className="block w-full rounded px-3 py-1.5 text-left text-xs text-kanban-muted-foreground hover:bg-kanban-hover"
                    >
                      Clear due date
                    </button>
                  ) : null}
                </PopoverContent>
              </Popover>
            </Field>
            <Field label="Labels">
              <div className="flex flex-wrap items-center gap-1">
                {task.labels.map((label) => (
                  <LabelChip key={label} label={label} />
                ))}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label="Add label">
                      <Plus />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-48 p-1">
                    {/* Why a text input first: on a fresh board no labels
                        exist yet, so picking from prior labels alone would
                        leave the control permanently empty. */}
                    <Input
                      value={newLabel}
                      onChange={(event) => setNewLabel(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') {
                          return
                        }
                        const next = newLabel.trim()
                        if (!next || task.labels.includes(next)) {
                          return
                        }
                        onUpdate({ labels: [...task.labels, next] })
                        setNewLabel('')
                      }}
                      placeholder="New label"
                      className="mb-1 h-8 text-xs"
                    />
                    {availableLabels.map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() =>
                          onUpdate({
                            labels: task.labels.includes(label)
                              ? task.labels.filter((item) => item !== label)
                              : [...task.labels, label]
                          })
                        }
                        className="flex w-full items-center justify-between rounded px-3 py-2 text-xs hover:bg-kanban-hover"
                      >
                        <LabelChip label={label} />
                        {task.labels.includes(label) ? '✓' : ''}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            </Field>
            <Field label="Dependencies">
              <div className="flex flex-wrap items-center gap-1">
                {task.dependencies.map((dependencyId) => {
                  const dependency = allTasks.find((item) => item.id === dependencyId)
                  return (
                    <button
                      key={dependencyId}
                      type="button"
                      onClick={() =>
                        onUpdate({
                          dependencies: task.dependencies.filter((item) => item !== dependencyId)
                        })
                      }
                      title="Remove dependency"
                      className="flex max-w-[190px] items-center gap-1 rounded-md border border-kanban-border px-2 py-1 text-[10px] outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
                    >
                      <Workflow className="size-3 shrink-0 text-kanban-blue" />
                      <span className="truncate">{dependency?.title ?? dependencyId}</span>
                    </button>
                  )
                })}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label="Add dependency">
                      <Plus />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-1">
                    {availableDependencies.length ? (
                      availableDependencies.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          onClick={() =>
                            onUpdate({ dependencies: [...task.dependencies, candidate.id] })
                          }
                          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs hover:bg-kanban-hover"
                        >
                          <Workflow className="size-3.5 shrink-0 text-kanban-blue" />
                          <span className="truncate">{candidate.title}</span>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-2 text-xs text-kanban-muted-foreground">
                        No other tasks yet.
                      </p>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </Field>
            <Field label="Parent">
              {parentTask ? (
                <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-kanban-border px-2 py-1 text-[10px]">
                  <Workflow className="size-3 shrink-0 text-kanban-blue" />
                  <span className="truncate">{parentTask.title}</span>
                </span>
              ) : (
                <span className="text-[11px] text-kanban-muted-foreground">None</span>
              )}
            </Field>
            <Field label="Children">
              {childTasks.length ? (
                <div className="flex flex-wrap gap-1">
                  {childTasks.map((child) => (
                    <span
                      key={child.id}
                      className={`inline-flex max-w-[190px] items-center gap-1 rounded-md border border-kanban-border px-2 py-1 text-[10px] kanban-status-${child.status}`}
                      title={statusLabel[child.status]}
                    >
                      <Workflow className="size-3 shrink-0" />
                      <span className="truncate text-kanban-foreground">{child.title}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] text-kanban-muted-foreground">None</span>
              )}
            </Field>
          </div>
          <section className="mt-4">
            <h3 className="text-[12px] font-semibold">Description</h3>
            <textarea
              key={task.id}
              defaultValue={task.description}
              onBlur={(event) => {
                const next = event.target.value
                if (next !== task.description) {
                  onUpdate({ description: next })
                }
              }}
              placeholder="What needs to be done?"
              rows={6}
              className="mt-1 w-full resize-y rounded-lg border border-kanban-border bg-transparent p-3 text-[11px] leading-[1.55] outline-none placeholder:text-kanban-muted-foreground focus-visible:ring-2 focus-visible:ring-kanban-accent"
            />
          </section>
          <section className="mt-4">
            <h3 className="text-[12px] font-semibold">Result note</h3>
            <textarea
              key={`${task.id}-result`}
              defaultValue={task.resultNote ?? ''}
              onBlur={(event) => {
                const next = event.target.value.trim()
                if (next !== (task.resultNote ?? '')) {
                  onUpdate({ resultNote: next || undefined })
                }
              }}
              placeholder="Required before Done."
              rows={3}
              className="mt-1 w-full resize-y rounded-lg border border-kanban-border bg-transparent p-3 text-[11px] leading-[1.55] outline-none placeholder:text-kanban-muted-foreground focus-visible:ring-2 focus-visible:ring-kanban-accent"
            />
            {task.completedAt ? (
              <p className="mt-1 text-[10px] text-kanban-muted-foreground">
                Completed {new Date(task.completedAt).toLocaleString()}
              </p>
            ) : null}
          </section>
        </TabsContent>
        <TabsContent value="subtasks" className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {task.subtasks.length ? (
              task.subtasks.map((subtask) => (
                <button
                  key={subtask.id}
                  type="button"
                  onClick={() =>
                    onUpdate({
                      subtasks: task.subtasks.map((item) =>
                        item.id === subtask.id ? { ...item, done: !item.done } : item
                      )
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-lg border border-kanban-border p-3 text-left text-xs hover:bg-kanban-hover"
                >
                  <span
                    className={`grid size-4 place-items-center rounded border border-kanban-border ${subtask.done ? 'bg-kanban-success text-kanban-success-foreground' : ''}`}
                  >
                    {subtask.done ? '✓' : ''}
                  </span>
                  {subtask.title}
                </button>
              ))
            ) : (
              <p className="py-8 text-center text-xs text-kanban-muted-foreground">
                Create the first subtask for this task.
              </p>
            )}
          </div>
        </TabsContent>
        <TabsContent
          value="files"
          className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-4"
        >
          {task.files.length ? (
            <ul className="space-y-1">
              {task.files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center gap-2 rounded-md border border-kanban-border px-3 py-2 text-xs"
                >
                  <Paperclip className="size-3.5 shrink-0 text-kanban-muted-foreground" />
                  <span className="truncate">{file.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="grid h-full place-items-center text-sm text-kanban-muted-foreground">
              No files on this task.
            </p>
          )}
        </TabsContent>
        {/* Why this tab exists: dispatch.report holds the agent's own closing
            message — what it changed and what the operator must check by hand —
            and it was written to the task but rendered nowhere, so the one
            piece of evidence a run produces was unreadable. */}
        <TabsContent
          value="activity"
          className="scrollbar-sleek min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
        >
          {task.sourceQuote ? (
            <section>
              <h3 className="text-[11px] font-semibold">Original message (quoted, untrusted)</h3>
              <p className="text-[10px] text-kanban-muted-foreground">
                {task.sourceQuote.origin}
                {task.sourceQuote.sender ? ` · from ${task.sourceQuote.sender}` : ''}
                {task.sourceQuote.receivedAt
                  ? ` · ${new Date(task.sourceQuote.receivedAt).toLocaleString()}`
                  : ''}
              </p>
              {/* Plain text on purpose: this is whatever someone sent, never
                  markdown or HTML, and never something to act on. */}
              <pre className="mt-1 font-sans whitespace-pre-wrap break-words rounded-md border border-kanban-border bg-kanban-column p-3 text-[11px] leading-[1.55]">
                {task.sourceQuote.text}
              </pre>
            </section>
          ) : null}

          {task.lease ? (
            <p className="text-[11px] text-kanban-muted-foreground">
              Held by <span className="font-medium text-kanban-foreground">{task.lease.claimedBy}</span>{' '}
              ({task.lease.kind}) since {new Date(task.lease.claimedAt).toLocaleString()}; lease
              until {new Date(task.lease.leaseUntil).toLocaleTimeString()}.
              {task.lease.note ? ` Last note: ${task.lease.note}` : ''}
            </p>
          ) : null}
          {task.blockedReason ? (
            <p className="rounded-md border border-kanban-border bg-kanban-column p-3 text-[11px] leading-[1.55] text-kanban-red">
              Blocked: {task.blockedReason}
            </p>
          ) : null}

          {task.dispatch ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-medium">{task.dispatch.agentName}</span>
                <span className={`kanban-status-${task.status}`}>{task.dispatch.status}</span>
                <span className="text-kanban-muted-foreground">
                  attempt {task.dispatch.attempts}
                </span>
                {typeof task.dispatch.costUsd === 'number' ? (
                  <span className="tabular-nums text-kanban-muted-foreground">
                    ${task.dispatch.costUsd.toFixed(2)}
                  </span>
                ) : null}
                <span className="ml-auto text-kanban-muted-foreground">
                  {new Date(task.dispatch.updatedAt).toLocaleString()}
                </span>
              </div>

              {task.dispatch.error ? (
                <p className="rounded-md border border-kanban-border bg-kanban-column p-3 text-[11px] leading-[1.55] text-kanban-red">
                  {task.dispatch.error}
                </p>
              ) : null}

              {task.dispatch.report ? (
                <div>
                  <h3 className="mb-1 text-[11px] font-semibold">
                    {task.dispatch.agentName} reported
                  </h3>
                  <p className="whitespace-pre-wrap rounded-md border border-kanban-border bg-kanban-column p-3 text-[11px] leading-[1.55]">
                    {task.dispatch.report}
                  </p>
                </div>
              ) : task.dispatch.status === 'running' ? (
                <p className="text-[11px] text-kanban-muted-foreground">
                  Still working. The report appears here when the run ends.
                </p>
              ) : (
                <p className="text-[11px] text-kanban-muted-foreground">
                  The run ended without a report.
                </p>
              )}
            </div>
          ) : !task.lease && !task.comments?.length ? (
            <p className="text-[11px] text-kanban-muted-foreground">
              No agent has run this task yet.
            </p>
          ) : null}

          <section>
            <h3 className="mb-1 text-[11px] font-semibold">Comments</h3>
            {task.comments?.length ? (
              <ul className="space-y-2">
                {task.comments.map((comment) => (
                  <li
                    key={comment.id}
                    className="rounded-md border border-kanban-border bg-kanban-column p-2 text-[11px] leading-[1.5]"
                  >
                    <div className="flex gap-2 text-[10px] text-kanban-muted-foreground">
                      <span className="font-medium text-kanban-foreground">{comment.author}</span>
                      <span>{new Date(comment.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words">{comment.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-kanban-muted-foreground">No comments yet.</p>
            )}
            {onComment ? (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const body = commentBody.trim()
                  if (!body) {
                    return
                  }
                  onComment(body)
                  setCommentBody('')
                }}
              >
                <Input
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="Add a comment"
                  aria-label="New comment"
                  className="h-8 text-[11px]"
                />
                <Button type="submit" variant="secondary" size="sm" disabled={!commentBody.trim()}>
                  Add
                </Button>
              </form>
            ) : null}
          </section>
        </TabsContent>
      </Tabs>
      <footer className="grid shrink-0 grid-cols-3 gap-2 border-t border-kanban-border bg-kanban-panel px-4 py-3">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Plus />
              Create Subtask
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-72 p-3">
            <p className="mb-2 text-xs font-semibold">New subtask</p>
            <div className="flex gap-2">
              <Input
                value={subtaskTitle}
                onChange={(event) => setSubtaskTitle(event.target.value)}
                placeholder="Subtask title"
                className="h-8"
              />
              <Button
                size="sm"
                disabled={!subtaskTitle.trim()}
                onClick={() => {
                  onUpdate({
                    subtasks: [
                      ...task.subtasks,
                      { id: `subtask-${Date.now()}`, title: subtaskTitle.trim(), done: false }
                    ]
                  })
                  setSubtaskTitle('')
                }}
              >
                Add
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Workflow />
              Child Task
            </Button>
          </PopoverTrigger>
          <PopoverContent align="center" side="top" className="w-80 p-3">
            <p className="mb-2 text-xs font-semibold">New child task</p>
            <div className="space-y-2">
              <Input
                value={childTaskTitle}
                onChange={(event) => setChildTaskTitle(event.target.value)}
                placeholder="Task title"
                className="h-8"
              />
              <Select
                value={childAssigneeId || 'unassigned'}
                onValueChange={(value) => setChildAssigneeId(value === 'unassigned' ? '' : value)}
              >
                <SelectTrigger className="h-8 w-full">
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
              <Button
                size="sm"
                disabled={!childTaskTitle.trim()}
                onClick={() => {
                  onCreateChild(childTaskTitle, childAssigneeId)
                  setChildTaskTitle('')
                  setChildAssigneeId('')
                }}
                className="w-full"
              >
                Create
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button className="bg-kanban-accent text-kanban-accent-foreground hover:bg-kanban-accent-hover">
              <Workflow />
              Assign to Agent
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-60 p-1">
            <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-kanban-muted-foreground">
              Choose destination
            </p>
            {assignablePeople.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => onUpdate({ assignee: person })}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-xs hover:bg-kanban-hover"
              >
                <AvatarStack people={[person]} />
                <span>{person.name}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </footer>
    </aside>
  )
}
