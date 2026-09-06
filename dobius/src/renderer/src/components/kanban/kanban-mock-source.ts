import { create } from 'zustand'
import boardReference from '@/assets/kanban/vertex-kanban-reference.jpg'
import type { Person, Task, TaskSource, TaskStatus, TaskType, TaskPriority } from './kanban-types'

const people: Person[] = [
  { id: 'vision', name: 'Vision (Design)', initials: 'VD' },
  { id: 'maya', name: 'Maya Chen', initials: 'MC' },
  { id: 'sam', name: 'Sam Ortiz', initials: 'SO' },
  { id: 'lee', name: 'Lee Park', initials: 'LP' }
]

type SeedInput = {
  title: string
  status: TaskStatus
  type?: TaskType
  priority?: TaskPriority
  description?: string
  comments?: number
  attachments?: number
  people?: number
  cover?: boolean
}

function makeTask(seed: SeedInput, index: number): Task {
  const id = `vertex-${index + 1}`
  const collaborators = people.slice(1, 1 + (seed.people ?? 2))
  return {
    id,
    title: seed.title,
    description: seed.description ?? 'Completed foundational work for the Vertex experience.',
    status: seed.status,
    priority: seed.priority ?? 'medium',
    type: seed.type ?? 'feature',
    coverImageUrl: seed.cover ? boardReference : undefined,
    commentCount: seed.comments ?? 0,
    attachmentCount: seed.attachments ?? 0,
    assignee: people[0],
    collaborators,
    dueDate: id === 'vertex-1' ? '2026-09-12' : undefined,
    labels: id === 'vertex-1' ? ['Canvas', 'UI/UX', 'High Priority'] : [],
    related:
      id === 'vertex-1'
        ? [
            { id: 'canvas-2', label: 'Canvas 2.0' },
            { id: 'vertex', label: 'VERTEX' }
          ]
        : [],
    dependencies: id === 'vertex-1' ? ['canvas-core', 'annotation-engine'] : [],
    subtasks: [],
    files:
      id === 'vertex-1'
        ? [
            { id: 'file-1', name: 'canvas-overview.png', url: boardReference },
            { id: 'file-2', name: 'annotation-workspace.png', url: boardReference },
            { id: 'file-3', name: 'interaction-notes.md' }
          ]
        : []
  }
}

const seedInputs: SeedInput[] = [
  { title: 'Canvas 2.0 – Image Annotation', status: 'backlog', type: 'feature', priority: 'high', cover: true, description: 'Add native image annotation tools with arrows, callouts, and notes.', comments: 12, attachments: 4, people: 2 },
  { title: 'Mobile App – iOS', status: 'backlog', type: 'feature', priority: 'medium', description: 'Initial mobile layout and navigation system.', comments: 8, attachments: 2, people: 2 },
  { title: 'AI Voice Commands', status: 'backlog', type: 'integration', priority: 'high', description: 'Global voice controls for all pages.', comments: 15, attachments: 6, people: 2 },
  { title: 'Knowledge Graph View', status: 'backlog', type: 'feature', priority: 'medium', description: 'Visualize relationships between notes, tasks, and projects.', comments: 10, attachments: 3, people: 2 },
  { title: 'Command Center – Redesign', status: 'todo', type: 'design', priority: 'high', cover: true, description: 'New layout with spatial UI and live system status.', comments: 8, attachments: 4, people: 2 },
  { title: 'Agent Management UI', status: 'todo', type: 'feature', priority: 'high', description: 'Full agent control panel with status, logs, and memory.', comments: 12, attachments: 5, people: 2 },
  { title: 'Canvas – Slideshow Mode', status: 'todo', type: 'feature', priority: 'medium', description: 'Convert frames to presentation mode.', comments: 6, attachments: 2, people: 2 },
  { title: 'Integrations – GitHub', status: 'todo', type: 'integration', priority: 'high', description: 'Repo sync, PR view, commit history.', comments: 8, attachments: 3, people: 2 },
  { title: 'Kanban – Full Functionality', status: 'in-progress', type: 'feature', priority: 'high', cover: true, description: 'Drag & drop, assignees, dependencies, everything.', comments: 14, attachments: 5, people: 2 },
  { title: 'Canvas – Live Browser', status: 'in-progress', type: 'feature', priority: 'high', description: 'Embed live browser with DOM selection.', comments: 10, attachments: 4, people: 2 },
  { title: 'Visual QA Agent', status: 'in-progress', type: 'ai', priority: 'high', description: 'Compare screenshots and detect UI changes.', comments: 16, attachments: 3, people: 2 },
  { title: 'Database Optimization', status: 'in-progress', type: 'infra', priority: 'medium', description: 'Improve indexing and performance.', comments: 8, attachments: 2, people: 2 },
  { title: 'UI Component Library', status: 'review', type: 'design', priority: 'medium', cover: true, description: 'Finalize component library and variants.', comments: 6, attachments: 3, people: 2 },
  { title: 'Agent Permissions', status: 'review', type: 'security', priority: 'high', description: 'Role-based access and approval system.', comments: 8, attachments: 4, people: 2 },
  { title: 'Canvas – File Support', status: 'review', type: 'feature', priority: 'medium', description: 'Support PDFs, videos, and code files.', comments: 6, attachments: 3, people: 2 },
  { title: 'Real-time Collaboration', status: 'testing', type: 'feature', priority: 'high', description: 'Multiple cursors, live presence.', comments: 10, attachments: 4, people: 3 },
  { title: 'Task → Agent Pipeline', status: 'testing', type: 'ai', priority: 'high', description: 'Send annotated tasks directly to agents.', comments: 12, attachments: 5, people: 2 },
  { title: 'Notification System', status: 'testing', type: 'feature', priority: 'medium', description: 'In-app, email, and mobile alerts.', comments: 8, attachments: 2, people: 2 },
  { title: 'Authentication', status: 'done' },
  { title: 'Project Framework', status: 'done' },
  { title: 'Basic Kanban', status: 'done' },
  { title: 'File Management', status: 'done' }
]

const seededTasks = seedInputs.map(makeTask)
seededTasks[0] = {
  ...seededTasks[0],
  description:
    'Add native image annotation tools with arrows, highlights, text, shapes, and voice notes. Must support screenshots, images, and live previews.'
}

type KanbanStore = { tasks: Task[]; revision: number }

export const useKanbanStore = create<KanbanStore>(() => ({ tasks: seededTasks, revision: 0 }))

export const kanbanMockSource: TaskSource = {
  list: () => useKanbanStore.getState().tasks,
  move(taskId, to, toIndex) {
    useKanbanStore.setState((state) => {
      const moving = state.tasks.find((task) => task.id === taskId)
      if (!moving) return state
      const without = state.tasks.filter((task) => task.id !== taskId)
      const targetIndexes = without.reduce<number[]>((indexes, task, index) => {
        if (task.status === to) indexes.push(index)
        return indexes
      }, [])
      const insertionIndex =
        toIndex >= targetIndexes.length
          ? (targetIndexes.at(-1) ?? without.length - 1) + 1
          : targetIndexes[toIndex]
      without.splice(Math.max(0, insertionIndex), 0, { ...moving, status: to })
      return { tasks: without, revision: state.revision + 1 }
    })
  },
  update(taskId, patch) {
    useKanbanStore.setState((state) => ({
      tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
      revision: state.revision + 1
    }))
  },
  create(partial) {
    const task = makeTask({ ...partial }, Date.now())
    useKanbanStore.setState((state) => ({
      tasks: [...state.tasks, task],
      revision: state.revision + 1
    }))
    return task
  }
}
