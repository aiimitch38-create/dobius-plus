import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
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
import {
  addVertexTaskAttachment,
  addVertexTaskAttachmentFromBytes,
  addVertexTaskAttachmentFromFile,
  readVertexTaskAttachment
} from './vertex-task-attachments'

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

describe('addVertexTaskAttachmentFromFile (proof from an agent)', () => {
  // A real 1x1 PNG, so the magic bytes and the body agree.
  const REAL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  )

  it('accepts a real PNG, derives the mime from the bytes, and records kind + addedBy', () => {
    const file = join(dir, 'shot.PNG')
    writeFileSync(file, REAL_PNG)
    const record = addVertexTaskAttachmentFromFile(taskId, file, { kind: 'proof', addedBy: 'console-w1' })
    expect(record.mime).toBe('image/png')
    expect(record.name).toBe('shot.PNG')
    expect(record.kind).toBe('proof')
    expect(record.addedBy).toBe('console-w1')
    expect(record.path.endsWith(`${record.id}.png`)).toBe(true)
    expect(readFileSync(record.path)).toEqual(REAL_PNG)
    expect(taskNow().attachments).toEqual([record])
  })

  it('refuses a text file renamed to .png (extension is not trusted)', () => {
    const file = join(dir, 'notes.png')
    writeFileSync(file, 'hello, this is not an image\n')
    expect(() => addVertexTaskAttachmentFromFile(taskId, file, { kind: 'proof' })).toThrow(
      /Not a PNG, JPEG, WebP or GIF/
    )
    expect(taskNow().attachments).toBeUndefined()
  })

  it('refuses a symlink, a relative path, a directory and a missing file', () => {
    const real = join(dir, 'real.png')
    writeFileSync(real, REAL_PNG)
    const link = join(dir, 'link.png')
    symlinkSync(real, link)
    expect(() => addVertexTaskAttachmentFromFile(taskId, link, {})).toThrow(/symlink/)
    expect(() => addVertexTaskAttachmentFromFile(taskId, 'shot.png', {})).toThrow(/absolute/)
    expect(() => addVertexTaskAttachmentFromFile(taskId, dir, {})).toThrow(/regular file/)
    expect(() => addVertexTaskAttachmentFromFile(taskId, join(dir, 'gone.png'), {})).toThrow(
      /not found/
    )
    expect(taskNow().attachments).toBeUndefined()
  })

  it('refuses a FIFO without blocking on it', () => {
    const fifo = join(dir, 'pipe.png')
    execFileSync('mkfifo', [fifo])
    expect(() => addVertexTaskAttachmentFromFile(taskId, fifo, {})).toThrow(/regular file/)
    expect(taskNow().attachments).toBeUndefined()
  })

  it('refuses a file over 10 MB before reading it', () => {
    const file = join(dir, 'huge.png')
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0)
    REAL_PNG.copy(big)
    writeFileSync(file, big)
    expect(() => addVertexTaskAttachmentFromFile(taskId, file, { kind: 'proof' })).toThrow(
      /larger than/
    )
    expect(taskNow().attachments).toBeUndefined()
  })

  it('from bytes: sniffs jpeg/gif/webp and defaults the kind to screenshot', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
    const gif = Buffer.from('GIF89a\u0000\u0000', 'latin1')
    const webp = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1')
    expect(addVertexTaskAttachmentFromBytes(taskId, jpeg, {}).mime).toBe('image/jpeg')
    expect(addVertexTaskAttachmentFromBytes(taskId, gif, {}).mime).toBe('image/gif')
    const record = addVertexTaskAttachmentFromBytes(taskId, webp, { addedBy: '  ' })
    expect(record.mime).toBe('image/webp')
    expect(record.kind).toBe('screenshot')
    expect(record.addedBy).toBeUndefined()
    expect(() => addVertexTaskAttachmentFromBytes(taskId, Buffer.from('<svg/>'), {})).toThrow(
      /Not a PNG/
    )
  })
})
