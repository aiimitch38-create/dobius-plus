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

describe('tasks.update', () => {
  const update = (params: Record<string, unknown>) => method('tasks.update')(params)
  const task = () => vertexTaskStore.list().find((t) => t.id === taskId)

  it('patches title, body, labels, priority and assignee of an unheld card', async () => {
    const result = (await update({
      id: taskId,
      by: 'adam',
      title: '  Fix login redirect ',
      description: 'New body',
      labels: ['auth'],
      priority: 'high',
      assignee: { id: 'console-w1', kind: 'console', name: 'Worker One' }
    })) as { ok: boolean; task: { title: string } }
    expect(result.ok).toBe(true)
    expect(task()).toMatchObject({
      title: 'Fix login redirect',
      description: 'New body',
      labels: ['auth'],
      priority: 'high',
      assignee: { id: 'console-w1', kind: 'console', name: 'Worker One' },
      status: 'todo'
    })
  })

  it('refuses a card someone else holds, and allows the holder', async () => {
    vertexTaskStore.claim(taskId, { by: 'console-w1', kind: 'worker' })
    expect(await update({ id: taskId, by: 'console-w2', title: 'Stolen' })).toEqual({
      ok: false,
      reason: 'held-by:console-w1'
    })
    expect(task()?.title).toBe('Fix login')
    expect(await update({ id: taskId, by: 'console-w1', title: 'Mine' })).toMatchObject({ ok: true })
    expect(task()?.title).toBe('Mine')
  })

  it('refuses an agent assignee, an empty patch, and an unknown card', async () => {
    await expect(
      update({ id: taskId, by: 'adam', assignee: { id: 'a', kind: 'agent', name: 'A' } })
    ).rejects.toThrow()
    await expect(update({ id: taskId, by: 'adam' })).rejects.toThrow(/Nothing to update/)
    await expect(update({ id: taskId, by: 'adam', title: '   ' })).rejects.toThrow(/Title is empty/)
    expect(await update({ id: 'nope', by: 'adam', title: 'x' })).toEqual({
      ok: false,
      reason: 'not-found'
    })
  })
})

describe('tasks.move', () => {
  const move = (params: Record<string, unknown>) => method('tasks.move')(params)

  it('moves an unheld card to another column', async () => {
    expect(await move({ id: taskId, by: 'adam', to: 'backlog' })).toMatchObject({ ok: true })
    expect(status()).toBe('backlog')
  })

  it('refuses done and in-progress (complete and claim own those)', async () => {
    expect(await move({ id: taskId, by: 'adam', to: 'done' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^use-complete/)
    })
    expect(await move({ id: taskId, by: 'adam', to: 'in-progress' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^use-claim/)
    })
    expect(status()).toBe('todo')
  })

  it('refuses moving a card someone else holds; the holder may move it on', async () => {
    vertexTaskStore.claim(taskId, { by: 'console-w1', kind: 'worker' })
    expect(await move({ id: taskId, by: 'console-w2', to: 'blocked' })).toEqual({
      ok: false,
      reason: 'held-by:console-w1'
    })
    expect(status()).toBe('in-progress')
    expect(await move({ id: taskId, by: 'console-w1', to: 'testing' })).toMatchObject({ ok: true })
    expect(status()).toBe('testing')
    expect(vertexTaskStore.list().find((t) => t.id === taskId)?.lease).toBeUndefined()
  })

  it('refuses putting an agent card back in To Do (that starts a paid run)', async () => {
    const agentCard = vertexTaskStore.create({
      title: 'Agent job',
      status: 'backlog',
      assignee: { kind: 'agent', id: 'ag1', name: 'Agent', initials: 'A' }
    }).id
    expect(await move({ id: agentCard, by: 'adam', to: 'todo' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^agent-dispatch/)
    })
    expect(vertexTaskStore.list().find((t) => t.id === agentCard)?.status).toBe('backlog')
  })

  it('rejects an unknown column and reports an unknown card', async () => {
    await expect(move({ id: taskId, by: 'adam', to: 'archive' })).rejects.toThrow()
    expect(await move({ id: 'nope', by: 'adam', to: 'backlog' })).toEqual({
      ok: false,
      reason: 'not-found'
    })
  })
})
