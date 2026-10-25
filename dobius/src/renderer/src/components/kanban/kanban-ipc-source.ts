import type { TaskSource } from './kanban-types'

export function getKanbanIpcSource(): TaskSource | null {
  const api = window.api?.vertexTasks
  if (!api) {
    return null
  }
  return {
    list: () => api.list(),
    reload: () => api.reload(),
    create: (input) => api.create(input),
    update: (taskId, patch) => api.update(taskId, patch),
    move: (taskId, to, toIndex) => api.move(taskId, to, toIndex),
    remove: (taskId) => api.remove(taskId),
    comment: (taskId, author, body) => api.comment({ taskId, author, body })
  }
}
