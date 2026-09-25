import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, fromId, update, list } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>(),
  fromId: vi.fn(),
  update: vi.fn((_taskId: string, _patch: unknown) => null),
  list: vi.fn(() => [])
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
  vertexTaskStore: { update, list }
}))
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
