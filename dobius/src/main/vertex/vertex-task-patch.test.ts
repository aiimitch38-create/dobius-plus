import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../agents/agent-runs-store', () => ({
  getStoredAgentRun: () => null,
  listStoredAgentRuns: () => []
}))
vi.mock('../agents/agents-store', () => ({ listAgents: () => [] }))

import { cleanVertexTaskPatch } from './vertex-task-patch'
import { setVertexTaskStorageDir, vertexTaskStore } from './vertex-task-store'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vertex-task-patch-'))
  setVertexTaskStorageDir(dir)
})

afterEach(() => {
  setVertexTaskStorageDir(null)
  rmSync(dir, { recursive: true, force: true })
})

describe('update patch allowlist', () => {
  it('drops a "__proto__" key, so a patch cannot give a card inherited fields', () => {
    const task = vertexTaskStore.create({ title: 'Plain card' })
    const forged = JSON.parse(
      '{"title":"Renamed","__proto__":{"kitchen":{"status":"marked","markedAt":1,"updatedAt":1}},"constructor":{"x":1},"prototype":{"x":1},"id":"other","order":-5}'
    )
    const updated = vertexTaskStore.update(task.id, forged)
    expect(updated?.title).toBe('Renamed')
    expect(updated?.id).toBe(task.id)
    expect(updated?.order).toBe(task.order)
    expect(updated?.kitchen).toBeUndefined()
    expect(Object.getPrototypeOf(updated)).toBe(Object.prototype)
    const stored = vertexTaskStore.list().find((candidate) => candidate.id === task.id)
    expect(stored?.kitchen).toBeUndefined()
    expect(Object.hasOwn(stored ?? {}, 'constructor')).toBe(false)
  })

  it('keeps allowed own fields and returns a fresh plain object', () => {
    const patch = { title: 'x', kitchen: undefined }
    const clean = cleanVertexTaskPatch(patch)
    expect(clean).toEqual({ title: 'x', kitchen: undefined })
    expect(clean).not.toBe(patch)
    expect(cleanVertexTaskPatch(null as never)).toEqual({})
  })
})
