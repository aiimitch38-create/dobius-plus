import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The store imports electron only for app.getPath, which the storage-dir
// override replaces in tests.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { setVertexTaskStorageDir, vertexTaskStore } from './vertex-task-store'
import type { VertexTaskStatus } from '../../shared/vertex-task-types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vertex-tasks-'))
  setVertexTaskStorageDir(dir)
})

afterEach(() => {
  setVertexTaskStorageDir(null)
  rmSync(dir, { recursive: true, force: true })
})

const ids = (status: VertexTaskStatus): string[] =>
  vertexTaskStore
    .list()
    .filter((t) => t.status === status)
    .map((t) => t.title)

describe('create', () => {
  it('defaults a bare task to backlog / medium / feature', () => {
    const t = vertexTaskStore.create({ title: 'Canvas 2.0' })
    expect(t.status).toBe('backlog')
    expect(t.priority).toBe('medium')
    expect(t.type).toBe('feature')
    expect(t.id).toBeTruthy()
  })

  it('rejects a task with no title', () => {
    expect(() => vertexTaskStore.create({ title: '   ' })).toThrow('needs a title')
  })

  it('appends to the end of its column', () => {
    vertexTaskStore.create({ title: 'first' })
    vertexTaskStore.create({ title: 'second' })
    expect(ids('backlog')).toEqual(['first', 'second'])
  })
})

describe('move', () => {
  it('reorders within a column', () => {
    vertexTaskStore.create({ title: 'a' })
    const b = vertexTaskStore.create({ title: 'b' })
    vertexTaskStore.create({ title: 'c' })
    vertexTaskStore.move(b.id, 'backlog', 0)
    expect(ids('backlog')).toEqual(['b', 'a', 'c'])
  })

  it('moves across columns at the requested index', () => {
    vertexTaskStore.create({ title: 'x', status: 'todo' })
    vertexTaskStore.create({ title: 'y', status: 'todo' })
    const moved = vertexTaskStore.create({ title: 'z' })
    vertexTaskStore.move(moved.id, 'todo', 1)
    expect(ids('todo')).toEqual(['x', 'z', 'y'])
    expect(ids('backlog')).toEqual([])
  })

  it('clamps an out-of-range index instead of throwing', () => {
    vertexTaskStore.create({ title: 'a' })
    const b = vertexTaskStore.create({ title: 'b' })
    vertexTaskStore.move(b.id, 'backlog', 99)
    expect(ids('backlog')).toEqual(['a', 'b'])
    vertexTaskStore.move(b.id, 'backlog', -5)
    expect(ids('backlog')).toEqual(['b', 'a'])
  })

  it('survives repeated inserts between the same two neighbours', () => {
    // Why: each insert halves the gap. Without reindexing, order values
    // eventually collide and the column silently loses its ordering.
    vertexTaskStore.create({ title: 'top' })
    vertexTaskStore.create({ title: 'bottom' })
    for (let i = 0; i < 60; i += 1) {
      const t = vertexTaskStore.create({ title: `mid-${i}` })
      vertexTaskStore.move(t.id, 'backlog', 1)
    }
    const order = ids('backlog')
    expect(order[0]).toBe('top')
    expect(order[order.length - 1]).toBe('bottom')
    expect(new Set(order).size).toBe(order.length)
  })

  it('returns null for an unknown task', () => {
    expect(vertexTaskStore.move('nope', 'todo', 0)).toBeNull()
  })
})

describe('update', () => {
  it('applies a patch and stamps updatedAt', () => {
    const t = vertexTaskStore.create({ title: 'a' })
    const updated = vertexTaskStore.update(t.id, { priority: 'urgent', labels: ['Canvas'] })
    expect(updated?.priority).toBe('urgent')
    expect(updated?.labels).toEqual(['Canvas'])
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(t.updatedAt)
  })

  it('moves a task to the end of the new column when status changes', () => {
    vertexTaskStore.create({ title: 'existing', status: 'review' })
    const t = vertexTaskStore.create({ title: 'promoted' })
    vertexTaskStore.update(t.id, { status: 'review' })
    expect(ids('review')).toEqual(['existing', 'promoted'])
  })

  it('returns null for an unknown task', () => {
    expect(vertexTaskStore.update('nope', { title: 'x' })).toBeNull()
  })
})

describe('persistence', () => {
  it('survives a cache drop', () => {
    vertexTaskStore.create({ title: 'durable' })
    setVertexTaskStorageDir(dir) // clears the cache
    expect(vertexTaskStore.list().map((t) => t.title)).toEqual(['durable'])
  })

  it('starts empty rather than throwing on a corrupt file', () => {
    writeFileSync(join(dir, 'vertex-tasks.json'), '{not json', 'utf8')
    setVertexTaskStorageDir(dir)
    expect(vertexTaskStore.list()).toEqual([])
  })

  it('drops malformed rows but keeps the good ones', () => {
    writeFileSync(
      join(dir, 'vertex-tasks.json'),
      JSON.stringify([
        { id: '1', title: 'good', status: 'todo', order: 1000 },
        { id: '2', title: 'no status', order: 2000 },
        'not an object',
      ]),
      'utf8',
    )
    setVertexTaskStorageDir(dir)
    expect(vertexTaskStore.list().map((t) => t.title)).toEqual(['good'])
  })

  it('writes valid JSON to disk', () => {
    vertexTaskStore.create({ title: 'on disk' })
    const raw = readFileSync(join(dir, 'vertex-tasks.json'), 'utf8')
    expect(JSON.parse(raw)[0].title).toBe('on disk')
  })
})

describe('remove', () => {
  it('deletes and reports whether anything was removed', () => {
    const t = vertexTaskStore.create({ title: 'gone' })
    expect(vertexTaskStore.remove(t.id)).toBe(true)
    expect(vertexTaskStore.list()).toEqual([])
    expect(vertexTaskStore.remove(t.id)).toBe(false)
  })
})
