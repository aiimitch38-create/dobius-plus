import { useEffect, useState } from 'react'
import {
  Bold,
  CalendarDays,
  ChevronDown,
  Code,
  ExternalLink,
  FileImage,
  Italic,
  Link2,
  List,
  ListOrdered,
  Plus,
  Quote,
  Strikethrough,
  Table2,
  Trash2,
  X,
  Workflow
} from 'lucide-react'
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
import { LabelChip } from './kanban-chips'
import type { Task, TaskPriority, TaskSource, TaskStatus, TaskType } from './kanban-types'

const statuses: TaskStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'testing', 'done']
const priorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const types: TaskType[] = ['feature', 'design', 'integration', 'ai', 'security', 'infra', 'bug']
const statusLabel: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  'in-progress': 'In Progress',
  review: 'Review',
  testing: 'Testing',
  done: 'Done'
}
const editorItems = [
  'Arrow, text, shapes, highlights',
  'Voice annotations (STT)',
  'Attach notes and files',
  'Convert annotations to tasks',
  'AI analysis of screenshots',
  'Work on images and live previews',
  'Integrate with agents and tasks'
]
const assignablePeople = [
  { kind: 'human' as const, id: 'me', name: 'Me', initials: 'ME' },
  { kind: 'agent' as const, id: 'vision', name: 'Vision (Design)', initials: 'VD' },
  { kind: 'agent' as const, id: 'atlas', name: 'Atlas (Engineering)', initials: 'AE' },
  { kind: 'agent' as const, id: 'sage', name: 'Sage (Research)', initials: 'SR' }
]
const availableLabels = ['Canvas', 'UI/UX', 'High Priority', 'Agent', 'Desktop']
const availableFolders = ['Vertex / Canvas', 'Vertex / Desktop', 'Vertex / Agents']
const availableDependencies = ['Annotation engine', 'Canvas renderer', 'Agent permissions']

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
  onClose,
  onUpdate,
  onDelete
}: {
  task: Task
  onClose: () => void
  onUpdate: (patch: Parameters<TaskSource['update']>[1]) => void
  onDelete: () => void
}): React.JSX.Element {
  const [subtaskTitle, setSubtaskTitle] = useState('')
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
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
        <Button variant="ghost" size="icon-xs" aria-label="Copy task link">
          <Link2 />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Open task in new window">
          <ExternalLink />
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
            <button
              type="button"
              className="grid aspect-square w-[62px] shrink-0 place-items-center rounded-md border border-dashed border-kanban-border-strong text-[10px] text-kanban-muted-foreground outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
            >
              <span className="grid place-items-center gap-1">
                <Plus className="size-4" />
                Add
              </span>
            </button>
          </div>
          <div className="mt-4 space-y-1">
            <Field label="Assignee">
              <Popover>
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
                  {assignablePeople.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => onUpdate({ assignee: person })}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-xs outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
                    >
                      <AvatarStack people={[person]} />
                      {person.name}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
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
                <PopoverContent align="start" className="w-48 p-1">
                  {[
                    ['2026-09-12', 'Sep 12, 2026'],
                    ['2026-09-18', 'Sep 18, 2026'],
                    ['2026-09-25', 'Sep 25, 2026']
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onUpdate({ dueDate: value })}
                      className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-kanban-hover"
                    >
                      {label}
                    </button>
                  ))}
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
            <Field label="Related">
              <div className="flex flex-wrap items-center gap-1">
                {task.related.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex items-center gap-1 rounded-md border border-kanban-border px-2 py-1 text-[10px] outline-none hover:bg-kanban-hover focus-visible:ring-2 focus-visible:ring-kanban-accent"
                  >
                    <Workflow className="size-3 text-kanban-blue" />
                    {item.label}
                  </button>
                ))}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label="Add related folder">
                      <Plus />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-1">
                    {availableFolders.map((folder) => (
                      <button
                        key={folder}
                        type="button"
                        onClick={() =>
                          onUpdate({
                            related: [
                              ...task.related.filter((item) => item.label !== folder),
                              { id: folder.toLowerCase().replaceAll(' ', '-'), label: folder }
                            ]
                          })
                        }
                        className="flex w-full items-center gap-2 rounded px-3 py-2 text-xs hover:bg-kanban-hover"
                      >
                        <Workflow className="size-3.5 text-kanban-blue" />
                        {folder}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            </Field>
            <Field label="Dependencies">
              <div className="flex items-center gap-1">
                <span className="rounded-md border border-kanban-border px-2 py-1 text-[10px]">
                  {task.dependencies.length} tasks
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label="Add dependency">
                      <Plus />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-1">
                    {availableDependencies.map((dependency) => (
                      <button
                        key={dependency}
                        type="button"
                        onClick={() =>
                          onUpdate({
                            dependencies: task.dependencies.includes(dependency)
                              ? task.dependencies.filter((item) => item !== dependency)
                              : [...task.dependencies, dependency]
                          })
                        }
                        className="flex w-full items-center justify-between rounded px-3 py-2 text-xs hover:bg-kanban-hover"
                      >
                        <span>{dependency}</span>
                        {task.dependencies.includes(dependency) ? '✓' : ''}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            </Field>
          </div>
          <section className="mt-4">
            <div className="flex items-end justify-between">
              <h3 className="text-[12px] font-semibold">Description</h3>
              <div className="flex text-[10px]">
                <button type="button" className="border-b border-kanban-accent px-2 py-1">
                  Write
                </button>
                <button type="button" className="px-2 py-1 text-kanban-muted-foreground">
                  Preview
                </button>
              </div>
            </div>
            <div className="mt-1 overflow-hidden rounded-lg border border-kanban-border">
              <div className="flex flex-wrap gap-0.5 border-b border-kanban-border p-1.5">
                {[
                  Bold,
                  Italic,
                  Strikethrough,
                  Link2,
                  List,
                  ListOrdered,
                  Quote,
                  Code,
                  FileImage,
                  Table2
                ].map((Icon, index) => (
                  <Button
                    key={index}
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Formatting option ${index + 1}`}
                  >
                    <Icon />
                  </Button>
                ))}
              </div>
              <div className="p-3 text-[10px] leading-[1.55]">
                <p>This feature should allow:</p>
                <ul className="mt-1 list-disc pl-5">
                  {editorItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
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
        {['files', 'activity'].map((tab) => (
          <TabsContent
            key={tab}
            value={tab}
            className="grid flex-1 place-items-center text-sm text-kanban-muted-foreground"
          >
            No {tab} selected
          </TabsContent>
        ))}
      </Tabs>
      <footer className="grid shrink-0 grid-cols-[1fr_1.18fr] gap-2 border-t border-kanban-border bg-kanban-panel px-4 py-3">
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
