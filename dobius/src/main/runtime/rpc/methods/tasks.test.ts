import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../../../agents/agent-runs-store', () => ({
  getStoredAgentRun: () => null,
  listStoredAgentRuns: () => []
}))
vi.mock('../../../agents/agents-store', () => ({ listAgents: () => [] }))

import { setVertexTaskStorageDir, vertexTaskStore } from '../../../vertex/vertex-task-store'
import { setVertexAttachmentsRoot } from '../../../vertex/vertex-attachment-paths'
import type { RpcContext } from '../core'
import { TASK_METHODS } from './tasks'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const LOCAL = { authenticatedLocal: true } as unknown as RpcContext
const PAIRED = {} as RpcContext

function method(name: string) {
  const found = TASK_METHODS.find((candidate) => candidate.name === name)
  if (!found) {
    throw new Error(`no method ${name}`)
  }
  // Why async: the handlers throw synchronously; the dispatcher awaits them
  // the same way, so a thrown error becomes a rejected call.
  return async (params: unknown, ctx: RpcContext = LOCAL) =>
    found.handler(found.params ? found.params.parse(params) : params, ctx)
}

let dir: string
let taskId: string
let shot: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vertex-rpc-tasks-'))
  setVertexTaskStorageDir(dir)
  setVertexAttachmentsRoot(join(dir, 'vertex-attachments'))
  taskId = vertexTaskStore.create({ title: 'Fix login', status: 'todo' }).id
  shot = join(dir, 'shot.png')
  writeFileSync(shot, PNG)
})

afterEach(() => {
  setVertexTaskStorageDir(null)
  setVertexAttachmentsRoot(null)
  rmSync(dir, { recursive: true, force: true })
})

const status = (): string => vertexTaskStore.list().find((t) => t.id === taskId)?.status ?? '?'

describe('tasks.attach', () => {
  it('local transport + lease holder: attaches by path with kind and addedBy', async () => {
    vertexTaskStore.claim(taskId, { by: 'console-w1', kind: 'worker' })
    const result = (await method('tasks.attach')({
      id: taskId,
      file: shot,
      kind: 'proof',
      addedBy: 'console-w1'
    })) as { attachment: { kind: string; addedBy: string; mime: string } }
    expect(result.attachment).toMatchObject({ kind: 'proof', addedBy: 'console-w1', mime: 'image/png' })
  })

  it('refuses a file path from a non-local (paired) transport, but takes bytes', async () => {
    vertexTaskStore.claim(taskId, { by: 'console-w1', kind: 'worker' })
    await expect(
      method('tasks.attach')({ id: taskId, file: shot, addedBy: 'console-w1' }, PAIRED)
    ).rejects.toThrow(/file is local-only; send dataBase64/)
    const result = (await method('tasks.attach')(
      { id: taskId, dataBase64: PNG.toString('base64'), addedBy: 'console-w1' },
      PAIRED
    )) as { attachment: { mime: string } }
    expect(result.attachment.mime).toBe('image/png')
  })

  it('refuses when the caller does not hold the live lease', async () => {
    await expect(
      method('tasks.attach')({ id: taskId, file: shot, addedBy: 'console-w1' })
    ).rejects.toThrow(/not-ready/)
    vertexTaskStore.claim(taskId, { by: 'lead-x', kind: 'lead' })
    await expect(
      method('tasks.attach')({ id: taskId, file: shot, addedBy: 'console-w1' })
    ).rejects.toThrow(/held-by:lead-x/)
    await expect(method('tasks.attach')({ id: taskId, file: shot })).rejects.toThrow(/held-by/)
    expect(vertexTaskStore.list().find((t) => t.id === taskId)?.attachments).toBeUndefined()
  })
})

describe('tasks.review', () => {
  it('moves an in-progress card the caller holds to review, with a trimmed-author comment', async () => {
    vertexTaskStore.claim(taskId, { by: 'console-w1', kind: 'worker' })
    const result = (await method('tasks.review')({
      id: taskId,
      by: '  console-w1 ',
      note: 'see shot'
    })) as { ok: boolean; task: { status: string; lease?: unknown; comments: { author: string; body: string }[] } }
    expect(result.ok).toBe(true)
    expect(result.task.status).toBe('review')
    expect(result.task.lease).toBeUndefined()
    expect(result.task.comments.at(-1)).toMatchObject({
      author: 'console-w1',
      body: 'Ready for review: see shot'
    })
  })

  it('refuses an unclaimed card, a card held by someone else, and a Done card', async () => {
    expect(await method('tasks.review')({ id: taskId, by: 'console-w1' })).toEqual({
      ok: false,
      reason: 'not-ready'
    })
    vertexTaskStore.claim(taskId, { by: 'lead-x', kind: 'lead' })
    expect(await method('tasks.review')({ id: taskId, by: 'console-w1' })).toEqual({
      ok: false,
      reason: 'held-by:lead-x'
    })
    vertexTaskStore.complete(taskId, { by: 'lead-x', resultNote: 'done' })
    expect(status()).toBe('done')
    expect(await method('tasks.review')({ id: taskId, by: 'lead-x' })).toEqual({
      ok: false,
      reason: 'not-ready'
    })
    expect(status()).toBe('done')
    expect(await method('tasks.review')({ id: 'missing', by: 'x' })).toEqual({
      ok: false,
      reason: 'not-found'
    })
  })
})
