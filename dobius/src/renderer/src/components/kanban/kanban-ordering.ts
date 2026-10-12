import type { Task, TaskStatus } from './kanban-types'

export function moveTasksOptimistically(
  tasks: Task[],
  taskId: string,
  to: TaskStatus,
  toIndex: number
): Task[] {
  const moving = tasks.find((task) => task.id === taskId)
  if (!moving) {
    return tasks
  }
  const sourceIndex = tasks
    .filter((task) => task.status === moving.status)
    .findIndex((task) => task.id === taskId)
  const without = tasks.filter((task) => task.id !== taskId)
  const destination = without.filter((task) => task.status === to)
  const adjustedIndex = moving.status === to && sourceIndex < toIndex ? toIndex - 1 : toIndex
  const index = Math.max(0, Math.min(adjustedIndex, destination.length))
  destination.splice(index, 0, { ...moving, status: to })
  let cursor = 0
  const result = without.map((task) => (task.status === to ? destination[cursor++] : task))
  while (cursor < destination.length) {
    result.push(destination[cursor++])
  }
  return result
}
