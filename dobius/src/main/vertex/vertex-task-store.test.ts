import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The store imports electron only for app.getPath, which the storage-dir
// override replaces in tests.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../agents/agents-store', () => ({
  listAgents: () => [
    {
      id: 'agent-watson-uuid',
      name: 'Watson',
      description: '',
      icon: 'bot',
      color: 'blue',
      systemPrompt: '',
      engine: 'codex',
      accountId: null,
      model: 'gpt-5.5',
      allowedTools: [],
      skills: [],
      cwd: '',
      bypassPermissions: false,
      heartbeat: { enabled: false },
      notify: { enabled: false },
      channels: { enabled: false },
      createdAt: 0,
      updatedAt: 0
    }
  ]
}))

import {
  reloadVertexTasksFromDisk,
  setVertexTaskStorageDir,
  vertexTaskStore
} from './vertex-task-store'
import type { VertexTaskStatus } from '../../shared/vertex-task-types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vertex-tasks-'))
  setVertexTaskStorageDir(dir)
})

afterEach(() => {
  vi.restoreAllMocks()
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

  it('links child tasks back to the parent task', () => {
    const parent = vertexTaskStore.create({ title: 'parent' })
    const child = vertexTaskStore.create({ title: 'child', parentTaskId: parent.id })
    const updatedParent = vertexTaskStore.list().find((task) => task.id === parent.id)
    expect(child.parentTaskId).toBe(parent.id)
    expect(updatedParent?.childTaskIds).toEqual([child.id])
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
    expect(order.at(-1)).toBe('bottom')
    expect(new Set(order).size).toBe(order.length)
  })

  it('returns null for an unknown task', () => {
    expect(vertexTaskStore.move('nope', 'todo', 0)).toBeNull()
  })

  it('does not move a task to done without a result note', () => {
    const t = vertexTaskStore.create({ title: 'needs proof' })
    expect(vertexTaskStore.move(t.id, 'done', 0)).toBeNull()
    expect(vertexTaskStore.list()[0].status).toBe('backlog')
  })

  it('stamps completedAt when a proven task moves to done', () => {
    const t = vertexTaskStore.create({ title: 'proved' })
    vertexTaskStore.update(t.id, { resultNote: 'Verified locally.' })
    const done = vertexTaskStore.move(t.id, 'done', 0)
    expect(done?.status).toBe('done')
    expect(done?.completedAt).toEqual(expect.any(Number))
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

  it('does not update a task to done without a result note', () => {
    const t = vertexTaskStore.create({ title: 'needs proof' })
    expect(vertexTaskStore.update(t.id, { status: 'done' })).toBeNull()
    expect(vertexTaskStore.list()[0].status).toBe('backlog')
  })

  it('allows done when the patch includes a result note', () => {
    const t = vertexTaskStore.create({ title: 'proved' })
    const done = vertexTaskStore.update(t.id, {
      status: 'done',
      resultNote: 'Build passed.'
    })
    expect(done?.status).toBe('done')
    expect(done?.resultNote).toBe('Build passed.')
    expect(done?.completedAt).toEqual(expect.any(Number))
  })
})

describe('persistence', () => {
  it('survives a cache drop', () => {
    vertexTaskStore.create({ title: 'durable' })
    setVertexTaskStorageDir(dir) // clears the cache
    expect(vertexTaskStore.list().map((t) => t.title)).toEqual(['durable'])
  })

  it('recovers without a restart once an unreadable file is repaired', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const file = join(dir, 'vertex-tasks.json')
    writeFileSync(file, '{not json', 'utf8')
    setVertexTaskStorageDir(dir)
    expect(() => vertexTaskStore.list()).toThrow('read-only')
    writeFileSync(file, JSON.stringify([{ id: '1', title: 'fixed', status: 'todo', order: 1 }]))
    expect(vertexTaskStore.list().map((t) => t.title)).toEqual(['fixed'])
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

  it('normalizes legacy friendly agent ids to the real agent roster id', () => {
    writeFileSync(
      join(dir, 'vertex-tasks.json'),
      JSON.stringify([
        {
          id: '1',
          title: 'legacy assignee',
          status: 'todo',
          destination: 'system',
          order: 1000,
          assignee: { kind: 'agent', id: 'watson', name: 'Watson', initials: 'WT' },
          collaborators: [{ kind: 'agent', id: 'watson', name: 'Watson', initials: 'WT' }],
          labels: [],
          related: [],
          dependencies: [],
          subtasks: [],
          files: [],
          dispatch: {
            status: 'failed',
            agentId: 'watson',
            agentName: 'Watson',
            attempts: 1,
            updatedAt: 0,
            error: 'No such agent: watson'
          },
          createdAt: 0,
          updatedAt: 0
        }
      ]),
      'utf8'
    )
    setVertexTaskStorageDir(dir)
    const [task] = vertexTaskStore.list()

    expect(task.assignee?.id).toBe('agent-watson-uuid')
    expect(task.collaborators[0]?.id).toBe('agent-watson-uuid')
    expect(task.dispatch?.agentId).toBe('agent-watson-uuid')
  })
})

describe('destination', () => {
  it('defaults to system', () => {
    expect(vertexTaskStore.create({ title: 'a' }).destination).toBe('system')
  })

  it('honours an explicit destination', () => {
    expect(vertexTaskStore.create({ title: 'a', destination: 'asana' }).destination).toBe('asana')
  })

  it('defaults records written before the field existed', () => {
    // Why: a missing destination must never read as Asana, or old tasks would
    // silently look like they are routed to an external service.
    writeFileSync(
      join(dir, 'vertex-tasks.json'),
      JSON.stringify([{ id: '1', title: 'legacy', status: 'todo', order: 1000 }]),
      'utf8'
    )
    setVertexTaskStorageDir(dir)
    expect(vertexTaskStore.list()[0].destination).toBe('system')
  })

  it('rejects a bogus destination', () => {
    expect(vertexTaskStore.create({ title: 'a', destination: 'slack' as never }).destination).toBe(
      'system'
    )
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

// #28: a board file that cannot be read must never be replaced by an empty one.
describe('unreadable board file', () => {
  const boardFile = (): string => join(dir, 'vertex-tasks.json')

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    try {
      chmodSync(boardFile(), 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  })

  const validBoard = JSON.stringify([{ id: '1', title: 'real card', status: 'todo', order: 1000 }])
  const cases: [string, string, boolean][] = [
    ['malformed JSON', '[{"id":"1","title":"real card"', false],
    ['a non-array top level', '{"tasks":[]}', false],
    ['EACCES', validBoard, true]
  ]

  it.each(cases)('keeps the original bytes and refuses every change (%s)', (_label, text, lock) => {
    if (lock && process.getuid?.() === 0) { // root ignores file modes
      return
    }
    writeFileSync(boardFile(), text, 'utf8')
    if (lock) {
      chmodSync(boardFile(), 0o000)
    }
    setVertexTaskStorageDir(dir)

    expect(() => vertexTaskStore.list()).toThrow('read-only')
    expect(() => vertexTaskStore.create({ title: 'new card' })).toThrow('read-only')
    expect(() => vertexTaskStore.update('1', { title: 'x' })).toThrow('read-only')
    expect(() => vertexTaskStore.move('1', 'todo', 0)).toThrow('read-only')
    expect(() => vertexTaskStore.remove('1')).toThrow('read-only')
    expect(() => reloadVertexTasksFromDisk()).toThrow('read-only')

    chmodSync(boardFile(), 0o600)
    expect(readFileSync(boardFile(), 'utf8')).toBe(text)
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('throws and keeps showing the disk state when a save fails', () => {
    if (process.getuid?.() === 0) { // root ignores directory modes
      return
    }
    const kept = vertexTaskStore.create({ title: 'kept' })
    chmodSync(dir, 0o500)
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      expect(() => vertexTaskStore.create({ title: 'lost' })).toThrow('could not be saved')
      expect(() => vertexTaskStore.update(kept.id, { title: 'renamed' })).toThrow(
        'could not be saved'
      )
      expect(vertexTaskStore.list().map((t) => t.title)).toEqual(['kept'])
    } finally {
      chmodSync(dir, 0o700)
    }
  })
})

// #47: deleting a task must not leave its id behind in any other row.
describe('remove relationships', () => {
  const onDisk = (): { id: string; parentTaskId?: string; childTaskIds: string[]; dependencies: string[] }[] =>
    JSON.parse(readFileSync(join(dir, 'vertex-tasks.json'), 'utf8'))

  it('removes a deleted child from its parent in the same write', () => {
    const parent = vertexTaskStore.create({ title: 'parent' })
    const child = vertexTaskStore.create({ title: 'child', parentTaskId: parent.id })
    const sibling = vertexTaskStore.create({ title: 'sibling', parentTaskId: parent.id })

    expect(vertexTaskStore.remove(child.id)).toBe(true)

    const rows = onDisk()
    expect(rows.map((t) => t.id)).toEqual([parent.id, sibling.id])
    expect(rows.find((t) => t.id === parent.id)?.childTaskIds).toEqual([sibling.id])
    expect(vertexTaskStore.list().find((t) => t.id === parent.id)?.childTaskIds).toEqual([
      sibling.id
    ])
  })

  it('unlinks children and dependents when a parent is deleted, deleting nothing else', () => {
    const parent = vertexTaskStore.create({ title: 'parent' })
    const child = vertexTaskStore.create({ title: 'child', parentTaskId: parent.id })
    const waiter = vertexTaskStore.create({ title: 'waiter' })
    vertexTaskStore.update(waiter.id, { dependencies: [parent.id, child.id] })

    expect(vertexTaskStore.remove(parent.id)).toBe(true)

    const rows = onDisk()
    expect(rows.map((t) => t.id)).toEqual([child.id, waiter.id])
    expect(rows.find((t) => t.id === child.id)?.parentTaskId).toBeUndefined()
    expect(rows.find((t) => t.id === waiter.id)?.dependencies).toEqual([child.id])
  })
})
