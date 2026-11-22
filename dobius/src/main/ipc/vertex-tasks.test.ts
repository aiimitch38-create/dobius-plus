import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, fromId, update, list, create, onVertexTaskCreated, isRegisteredRendererWebContents } =
  vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>(),
  fromId: vi.fn(),
  update: vi.fn((_taskId: string, _patch: unknown) => null),
  list: vi.fn(() => []),
  create: vi.fn((input: { title: string }) => ({ id: 'new', createdAt: 5, ...input })),
  onVertexTaskCreated: vi.fn(),
  isRegisteredRendererWebContents: vi.fn((_contents: unknown) => true)
}))

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: (channel: string, handler: (event: unknown, args: unknown) => unknown) =>
      handlers.set(channel, handler)
  },
  webContents: { fromId }
}))
vi.mock('../vertex/vertex-task-store', () => ({
  reloadVertexTasksFromDisk: vi.fn(),
  vertexTaskStore: { update, list, create }
}))
vi.mock('../vertex/bug-autofix', () => ({ onVertexTaskCreated }))
vi.mock('../window/renderer-window-registry', () => ({ isRegisteredRendererWebContents }))
vi.mock('../vertex/vertex-dispatch-recovery', async (importOriginal) => {
  const actual = await importOriginal<typeof recovery>()
  return { ...actual, withLostClaimCheck: vi.fn(actual.withLostClaimCheck) }
})

import { registerVertexTaskHandlers } from './vertex-tasks'
import { stampClaimOwner, withLostClaimCheck } from '../vertex/vertex-dispatch-recovery'
import type * as recovery from '../vertex/vertex-dispatch-recovery'

const event = { sender: { id: 7 } }

beforeEach(() => {
  handlers.clear()
  vi.clearAllMocks()
  registerVertexTaskHandlers()
})

describe('vertex task IPC ownership (#94)', () => {
  it('applies an update on behalf of the calling window', async () => {
    update.mockImplementationOnce((_taskId, patch) => {
      stampClaimOwner(patch as Parameters<typeof stampClaimOwner>[0])
      return null
    })
    const patch = {
      dispatch: {
        status: 'running' as const,
        agentId: 'a',
        agentName: 'A',
        attempts: 1,
        updatedAt: 1,
        ownerWebContentsId: 99
      }
    }
    await handlers.get('vertexTasks:update')?.(event, { taskId: 't1', patch })
    expect(update).toHaveBeenCalledWith('t1', patch)
    expect(patch.dispatch.ownerWebContentsId).toBe(7)
  })

  it('releases lost claims for the calling window only', async () => {
    await handlers.get('vertexTasks:releaseInterruptedClaims')?.(event, {
      activeTaskIds: ['t1']
    })
    expect(list).toHaveBeenCalledTimes(1)
    const check = vi.mocked(withLostClaimCheck).mock.calls[0][0] as {
      webContentsId: number
      activeTaskIds: Set<string>
      isWebContentsLive: (id: number) => boolean
    }
    expect(check.webContentsId).toBe(7)
    expect([...check.activeTaskIds]).toEqual(['t1'])

    fromId.mockReturnValueOnce(undefined)
    expect(check.isWebContentsLive(8)).toBe(false)
    fromId.mockReturnValueOnce({ isDestroyed: () => false, isCrashed: () => true })
    expect(check.isWebContentsLive(8)).toBe(false)
    fromId.mockReturnValueOnce({ isDestroyed: () => false, isCrashed: () => false })
    expect(check.isWebContentsLive(8)).toBe(true)
  })

  it('ignores a malformed release request', async () => {
    await handlers.get('vertexTasks:releaseInterruptedClaims')?.(event, { activeTaskIds: 't1' })
    await handlers.get('vertexTasks:releaseInterruptedClaims')?.(event, { activeTaskIds: [3] })
    expect(withLostClaimCheck).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
})

describe('vertex task IPC bug auto-fix hook', () => {
  const appWindow = {
    sender: { id: 7, isDestroyed: () => false },
    senderFrame: { parent: null }
  }

  it('stamps operator provenance in main and hands the card to bug auto-fix once', async () => {
    update.mockImplementationOnce((taskId, patch) => ({ id: taskId, title: 'Broken', ...(patch as object) }) as never)
    const created = await handlers.get('vertexTasks:create')?.(appWindow, {
      title: 'Broken',
      type: 'bug',
      provenance: { channel: 'operator-ui', at: 0 }
    })
    expect(update).toHaveBeenCalledWith('new', { provenance: { channel: 'operator-ui', at: 5 } })
    expect(created).toMatchObject({ id: 'new', provenance: { channel: 'operator-ui', at: 5 } })
    expect(onVertexTaskCreated).toHaveBeenCalledTimes(1)
    expect(onVertexTaskCreated).toHaveBeenCalledWith(created)
  })

  it('refuses a create from a subframe or an unregistered window', async () => {
    const subframe = { ...appWindow, senderFrame: { parent: {} } }
    expect(await handlers.get('vertexTasks:create')?.(subframe, { title: 'Forged', type: 'bug' })).toBeNull()
    isRegisteredRendererWebContents.mockReturnValueOnce(false)
    expect(await handlers.get('vertexTasks:create')?.(appWindow, { title: 'Forged', type: 'bug' })).toBeNull()
    expect(create).not.toHaveBeenCalled()
    expect(onVertexTaskCreated).not.toHaveBeenCalled()
  })

  it('never lets a renderer patch change the auto-fix mark or provenance', async () => {
    const patch = {
      title: 'x',
      autoFix: { status: 'queued' as const, queuedAt: 1, updatedAt: 1 },
      provenance: { channel: 'operator-ui' as const, at: 1 }
    }
    await handlers.get('vertexTasks:update')?.(event, { taskId: 't1', patch })
    expect(update).toHaveBeenCalledWith('t1', { title: 'x' })
  })
})
