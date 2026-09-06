import { create } from 'zustand'
import boardReference from '@/assets/kanban/vertex-kanban-reference.jpg'
import type { Person, Task, TaskSource, TaskStatus, TaskType, TaskPriority } from './kanban-types'

const people: Person[] = [
  { kind: 'agent', id: 'vision', name: 'Vision (Design)', initials: 'VD' },
  { kind: 'human', id: 'maya', name: 'Maya Chen', initials: 'MC' },
  { kind: 'agent', id: 'sam', name: 'Sam Ortiz', initials: 'SO' },
  { kind: 'human', id: 'lee', name: 'Lee Park', initials: 'LP' }
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
  const now = Date.now() + index
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
    order: (index + 1) * 1000,
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
        : Array.from({ length: seed.attachments ?? 0 }, (_, fileIndex) => ({
            id: `${id}-file-${fileIndex}`,
            name: `Attachment ${fileIndex + 1}`
          })),
    createdAt: now,
    updatedAt: now
  }
}

// Why empty: this board runs on real tasks. The mock exists only so the
// standalone preview renders without Electron IPC, not to ship demo content.
const seedInputs: SeedInput[] = []

const seededTasks = seedInputs.map(makeTask)
seededTasks[0] = {
  ...seededTasks[0],
  description:
    'Add native image annotation tools with arrows, highlights, text, shapes, and voice notes. Must support screenshots, images, and live previews.'
}

type KanbanStore = { tasks: Task[]; revision: number }

export const useKanbanStore = create<KanbanStore>(() => ({ tasks: seededTasks, revision: 0 }))

export const kanbanMockSource: TaskSource = {
  async list() {
    return useKanbanStore.getState().tasks
  },
  async move(taskId, to, toIndex) {
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
    return useKanbanStore.getState().tasks.find((task) => task.id === taskId) ?? null
  },
  async update(taskId, patch) {
    useKanbanStore.setState((state) => ({
      tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
      revision: state.revision + 1
    }))
    return useKanbanStore.getState().tasks.find((task) => task.id === taskId) ?? null
  },
  async create(input) {
    const task = makeTask(
      {
        title: input.title,
        status: input.status ?? 'backlog',
        type: input.type,
        priority: input.priority,
        description: input.description
      },
      Date.now()
    )
    useKanbanStore.setState((state) => ({
      tasks: [...state.tasks, task],
      revision: state.revision + 1
    }))
    return task
  },
  async remove(taskId) {
    const exists = useKanbanStore.getState().tasks.some((task) => task.id === taskId)
    if (!exists) return false
    useKanbanStore.setState((state) => ({
      tasks: state.tasks.filter((task) => task.id !== taskId),
      revision: state.revision + 1
    }))
    return true
  }
}
