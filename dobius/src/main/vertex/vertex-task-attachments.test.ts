import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The store imports electron only for app.getPath, which the dir overrides replace.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../agents/agent-runs-store', () => ({
  getStoredAgentRun: () => null,
  listStoredAgentRuns: () => []
}))
vi.mock('../agents/agents-store', () => ({ listAgents: () => [] }))

import { setVertexTaskStorageDir, vertexTaskStore } from './vertex-task-store'
import { setVertexAttachmentsRoot, vertexAttachmentsRoot } from './vertex-attachment-paths'
import { addVertexTaskAttachment, readVertexTaskAttachment } from './vertex-task-attachments'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const png64 = PNG.toString('base64')

let dir: string
let taskId: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vertex-attach-'))
  setVertexTaskStorageDir(dir)
  setVertexAttachmentsRoot(join(dir, 'vertex-attachments'))
  taskId = vertexTaskStore.create({ title: 'Zoom resets', status: 'todo' }).id
})

afterEach(() => {
  vi.restoreAllMocks()
  setVertexTaskStorageDir(null)
  setVertexAttachmentsRoot(null)
  rmSync(dir, { recursive: true, force: true })
})

function taskNow(): ReturnType<typeof vertexTaskStore.list>[number] {
  const task = vertexTaskStore.list().find((t) => t.id === taskId)
  if (!task) {
    throw new Error('task vanished')
  }
  return task
}

describe('addVertexTaskAttachment', () => {
  it('writes the file 0600 under the task dir, names it by mime, and records it', () => {
    const record = addVertexTaskAttachment(taskId, {
      name: '../../evil.exe',
      mime: 'image/png',
      dataBase64: png64
    })
    expect(record.path.startsWith(join(vertexAttachmentsRoot(), taskId) + '/')).toBe(true)
    expect(record.path.endsWith(`${record.id}.png`)).toBe(true)
    expect(record.id).toMatch(/^[0-9a-f]{24}$/)
    expect(record.bytes).toBe(PNG.byteLength)
    expect(readFileSync(record.path)).toEqual(PNG)
    expect(statSync(record.path).mode & 0o777).toBe(0o600)
    expect(taskNow().attachments).toEqual([record])
  })

  it('refuses a mime outside the allowlist', () => {
    expect(() =>
      addVertexTaskAttachment(taskId, { name: 'a.svg', mime: 'image/svg+xml', dataBase64: png64 })
    ).toThrow(/Unsupported image type/)
    expect(() =>
      addVertexTaskAttachment(taskId, { name: 'a.png', mime: 'text/html', dataBase64: png64 })
    ).toThrow(/Unsupported image type/)
    for (const mime of ['constructor', 'toString', '__proto__']) {
      expect(() => addVertexTaskAttachment(taskId, { name: 'a.png', mime, dataBase64: png64 })).toThrow(
        /Unsupported image type/
      )
    }
    expect(taskNow().attachments).toBeUndefined()
    expect(existsSync(join(vertexAttachmentsRoot(), taskId))).toBe(false)
  })

  it('refuses an image over 10 MB and an empty one', () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString('base64')
    expect(() =>
      addVertexTaskAttachment(taskId, { name: 'big.png', mime: 'image/png', dataBase64: big })
    ).toThrow(/larger than/)
    expect(() =>
      addVertexTaskAttachment(taskId, { name: 'empty.png', mime: 'image/png', dataBase64: '' })
    ).toThrow(/empty/)
    expect(taskNow().attachments).toBeUndefined()
  })

  it('refuses the eleventh image on a card', () => {
    for (let i = 0; i < 10; i += 1) {
      addVertexTaskAttachment(taskId, { name: `s${i}.png`, mime: 'image/png', dataBase64: png64 })
    }
    expect(() =>
      addVertexTaskAttachment(taskId, { name: 's10.png', mime: 'image/png', dataBase64: png64 })
    ).toThrow(/at most 10/)
    expect(taskNow().attachments).toHaveLength(10)
  })

  it('refuses a task id that is not a plain id, and an unknown task', () => {
    expect(() =>
      addVertexTaskAttachment('../escape', { name: 'a.png', mime: 'image/png', dataBase64: png64 })
    ).toThrow(/Invalid task id/)
    expect(() =>
      addVertexTaskAttachment('0000missing', { name: 'a.png', mime: 'image/png', dataBase64: png64 })
    ).toThrow(/Task not found/)
    expect(existsSync(vertexAttachmentsRoot())).toBe(false)
  })
})

describe('readVertexTaskAttachment', () => {
  it('returns the stored image as a data URL', () => {
    const record = addVertexTaskAttachment(taskId, {
      name: 'shot.png',
      mime: 'image/png',
      dataBase64: png64
    })
    expect(readVertexTaskAttachment(taskId, record.id)).toBe(`data:image/png;base64,${png64}`)
  })

  it('rejects malformed ids and a record whose path left the attachments root', () => {
    const record = addVertexTaskAttachment(taskId, {
      name: 'shot.png',
      mime: 'image/png',
      dataBase64: png64
    })
    expect(readVertexTaskAttachment(taskId, '../' + record.id)).toBeNull()
    expect(readVertexTaskAttachment('../' + taskId, record.id)).toBeNull()
    expect(readVertexTaskAttachment(taskId, 'nope')).toBeNull()

    const outside = join(dir, 'secret.png')
    writeFileSync(outside, PNG)
    // Why: the record is stored data; a tampered path must not read outside the root.
    vertexTaskStore.update(taskId, { attachments: [{ ...record, path: outside }] })
    expect(readVertexTaskAttachment(taskId, record.id)).toBeNull()
    vertexTaskStore.update(taskId, {
      attachments: [{ ...record, path: join(vertexAttachmentsRoot(), taskId, '..', '..', 'secret.png') }]
    })
    expect(readVertexTaskAttachment(taskId, record.id)).toBeNull()
  })
})

describe('vertexTaskStore.remove', () => {
  it('deletes the task attachment directory with the card', () => {
    const record = addVertexTaskAttachment(taskId, {
      name: 'shot.png',
      mime: 'image/png',
      dataBase64: png64
    })
    expect(existsSync(record.path)).toBe(true)
    expect(vertexTaskStore.remove(taskId)).toBe(true)
    expect(existsSync(join(vertexAttachmentsRoot(), taskId))).toBe(false)
  })
})
