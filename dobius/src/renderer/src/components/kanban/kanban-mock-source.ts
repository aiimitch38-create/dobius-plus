/* In-memory TaskSource for the standalone preview.
 *
 * This exists for ONE reason: kanban.html renders the board in a plain
 * browser, where there is no Electron IPC and window.api is undefined. It is
 * not a demo fixture — it ships no tasks, no people, and no attachments, so
 * what you see in the preview is what an empty real board looks like.
 *
 * Inside the app the board uses getKanbanIpcSource() instead, backed by
 * main/vertex/vertex-task-store.ts. */

import { create } from 'zustand'

import type { Task, TaskSource, TaskStatus } from './kanban-types'

type KanbanStore = { tasks: Task[]; revision: number }

export const useKanbanStore = create<KanbanStore>(() => ({ tasks: [], revision: 0 }))

function newTask(input: Parameters<TaskSource['create']>[0]): Task {
  const now = Date.now()
  return {
    id: `preview-${now}-${Math.round(performance.now())}`,
    title: input.title,
    description: input.description ?? '',
    status: input.status ?? 'backlog',
    priority: input.priority ?? 'medium',
    type: input.type ?? 'feature',
    destination: input.destination ?? 'system',
    order: now,
    assignee: input.assignee,
    collaborators: [],
    labels: [],
    related: [],
    dependencies: [],
    parentTaskId: input.parentTaskId,
    childTaskIds: [],
    subtasks: [],
    files: [],
    origin: input.origin
      ? { ...input.origin, createdAt: input.origin.createdAt ?? now }
      : undefined,
    projectId: input.projectId,
    missionId: input.missionId,
    createdAt: now,
    updatedAt: now
  }
}

function find(taskId: string): Task | null {
  return useKanbanStore.getState().tasks.find((task) => task.id === taskId) ?? null
}

export const kanbanMockSource: TaskSource = {
  async list() {
    return useKanbanStore.getState().tasks
  },

  async move(taskId: string, to: TaskStatus, toIndex: number) {
    useKanbanStore.setState((state) => {
      const moving = state.tasks.find((task) => task.id === taskId)
      if (!moving) {
        return state
      }
      if (to === 'done' && !moving.resultNote?.trim()) {
        return state
      }
      const without = state.tasks.filter((task) => task.id !== taskId)
      const targetIndexes = without.reduce<number[]>((indexes, task, index) => {
        if (task.status === to) {
          indexes.push(index)
        }
        return indexes
      }, [])
      const insertionIndex =
        toIndex >= targetIndexes.length
          ? (targetIndexes.at(-1) ?? without.length - 1) + 1
          : targetIndexes[toIndex]
      without.splice(Math.max(0, insertionIndex), 0, {
        ...moving,
        status: to,
        completedAt: to === 'done' ? (moving.completedAt ?? Date.now()) : moving.completedAt
      })
      return { tasks: without, revision: state.revision + 1 }
    })
    return find(taskId)
  },

  async update(taskId, patch) {
    const existing = find(taskId)
    if ((patch.status ?? existing?.status) === 'done' && !(patch.resultNote ?? existing?.resultNote)?.trim()) {
      return null
    }
    useKanbanStore.setState((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              ...patch,
              completedAt:
                (patch.status ?? task.status) === 'done'
                  ? (patch.completedAt ?? task.completedAt ?? Date.now())
                  : patch.completedAt,
              updatedAt: Date.now()
            }
          : task
      ),
      revision: state.revision + 1
    }))
    return find(taskId)
  },

  async create(input) {
    const task = newTask(input)
    useKanbanStore.setState((state) => ({
      tasks: [
        ...state.tasks.map((item) =>
          task.parentTaskId && item.id === task.parentTaskId
            ? { ...item, childTaskIds: [...item.childTaskIds, task.id], updatedAt: task.updatedAt }
            : item
        ),
        task
      ],
      revision: state.revision + 1
    }))
    return task
  },

  async remove(taskId) {
    if (!find(taskId)) {
      return false
    }
    useKanbanStore.setState((state) => ({
      tasks: state.tasks.filter((task) => task.id !== taskId),
      revision: state.revision + 1
    }))
    return true
  }
}
