import { describe, expect, it } from 'vitest'
import { moveTasksOptimistically } from './kanban-ordering'
import type { Task } from './kanban-types'

const task = (id: string, status: Task['status']): Task => ({
  id,
  title: id,
  description: '',
  status,
  priority: 'medium',
  type: 'feature',
  destination: 'system' as const,
  order: 0,
  collaborators: [],
  labels: [],
  related: [],
  dependencies: [],
  subtasks: [],
  files: [],
  createdAt: 0,
  updatedAt: 0
})

describe('moveTasksOptimistically', () => {
  it('accounts for removal when moving down within a column', () => {
    expect(
      moveTasksOptimistically(
        [task('a', 'todo'), task('b', 'todo'), task('c', 'todo')],
        'a',
        'todo',
        2
      ).map((item) => item.id)
    ).toEqual(['b', 'a', 'c'])
  })
  it('moves to the bottom of another column', () => {
    expect(
      moveTasksOptimistically([task('a', 'todo'), task('b', 'done')], 'a', 'done', 1)
        .filter((item) => item.status === 'done')
        .map((item) => item.id)
    ).toEqual(['b', 'a'])
  })
})
