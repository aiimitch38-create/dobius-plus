import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, removeHandlerMock, fromWebContentsMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  fromWebContentsMock: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: fromWebContentsMock
  },
  ipcMain: {
    handle: handleMock,
    removeHandler: removeHandlerMock
  }
}))

import { registerRuntimeHandlers } from './runtime'
import { registerRendererWindow } from '../window/renderer-window-registry'

function makeAppWindowSender(): { isDestroyed: () => boolean } {
  const sender = { isDestroyed: () => false }
  registerRendererWindow({
    once: vi.fn(),
    isDestroyed: () => false,
    webContents: sender
  } as never)
  return sender
}

function topFrameEvent(sender: unknown): unknown {
  return { sender, senderFrame: { parent: null } }
}

describe('registerRuntimeHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    removeHandlerMock.mockReset()
    fromWebContentsMock.mockReset()
  })

  it('routes sync requests through the authoritative browser window id', () => {
    const runtime = {
      syncWindowGraph: vi.fn().mockReturnValue({ graphStatus: 'ready' }),
      getStatus: vi.fn().mockReturnValue({ graphStatus: 'unavailable' }),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1')
    }

    registerRuntimeHandlers(runtime as never)

    const syncRegistration = handleMock.mock.calls.find(
      ([channel]) => channel === 'runtime:syncWindowGraph'
    )
    expect(syncRegistration).toBeTruthy()

    fromWebContentsMock.mockReturnValue({ id: 17 })

    const handler = syncRegistration![1]
    const result = handler({ sender: {} }, { tabs: [], leaves: [] })

    expect(runtime.syncWindowGraph).toHaveBeenCalledWith(17, { tabs: [], leaves: [] })
    expect(result).toEqual({ graphStatus: 'ready' })
  })

  it('routes generic local runtime RPC calls through the dispatcher', async () => {
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        runtimeId: 'runtime-1',
        rendererGraphEpoch: 0,
        graphStatus: 'ready',
        authoritativeWindowId: null,
        liveTabCount: 0,
        liveLeafCount: 0
      }),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1')
    }

    registerRuntimeHandlers(runtime as never)

    const callRegistration = handleMock.mock.calls.find(([channel]) => channel === 'runtime:call')
    expect(callRegistration).toBeTruthy()

    const handler = callRegistration![1]
    const result = await handler(topFrameEvent(makeAppWindowSender()), { method: 'status.get' })

    expect(result).toMatchObject({
      ok: true,
      result: { runtimeId: 'runtime-1', graphStatus: 'ready' },
      _meta: { runtimeId: 'runtime-1' }
    })
  })

  it('registers project group runtime RPC methods for local desktop callers', async () => {
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn(),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1'),
      listProjectGroups: vi.fn().mockReturnValue([{ id: 'group-1', name: 'Platform' }])
    }

    registerRuntimeHandlers(runtime as never)

    const callRegistration = handleMock.mock.calls.find(([channel]) => channel === 'runtime:call')
    expect(callRegistration).toBeTruthy()

    const handler = callRegistration![1]
    const result = await handler(topFrameEvent(makeAppWindowSender()), {
      method: 'projectGroup.list'
    })

    expect(result).toMatchObject({
      ok: true,
      result: { groups: [{ id: 'group-1', name: 'Platform' }] },
      _meta: { runtimeId: 'runtime-1' }
    })
  })

  describe('runtime:call sender trust (#21)', () => {
    const makeRuntime = () => ({
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ graphStatus: 'ready' }),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1'),
      listProjectGroups: vi.fn().mockReturnValue([])
    })

    const callHandler = (): ((event: unknown, args: unknown) => Promise<unknown>) => {
      const registration = handleMock.mock.calls.find(([channel]) => channel === 'runtime:call')
      return registration![1]
    }

    const forbidden = {
      ok: false,
      error: expect.objectContaining({ code: 'forbidden' }),
      _meta: { runtimeId: 'runtime-1' }
    }

    it('denies a webContents that is not a registered app window', async () => {
      const runtime = makeRuntime()
      registerRuntimeHandlers(runtime as never)

      const result = await callHandler()(topFrameEvent({ isDestroyed: () => false }), {
        method: 'projectGroup.list'
      })

      expect(result).toMatchObject(forbidden)
      expect(runtime.listProjectGroups).not.toHaveBeenCalled()
    })

    it('denies a subframe inside a registered app window', async () => {
      const runtime = makeRuntime()
      registerRuntimeHandlers(runtime as never)

      const result = await callHandler()(
        { sender: makeAppWindowSender(), senderFrame: { parent: { url: 'app://top' } } },
        { method: 'projectGroup.list' }
      )

      expect(result).toMatchObject(forbidden)
      expect(runtime.listProjectGroups).not.toHaveBeenCalled()
    })

    it('denies when the sending frame is gone', async () => {
      const runtime = makeRuntime()
      registerRuntimeHandlers(runtime as never)

      const result = await callHandler()(
        { sender: makeAppWindowSender(), senderFrame: null },
        { method: 'projectGroup.list' }
      )

      expect(result).toMatchObject(forbidden)
      expect(runtime.listProjectGroups).not.toHaveBeenCalled()
    })

    it('denies a destroyed webContents', async () => {
      const runtime = makeRuntime()
      registerRuntimeHandlers(runtime as never)
      const sender = makeAppWindowSender()
      sender.isDestroyed = () => true

      const result = await callHandler()(topFrameEvent(sender), { method: 'projectGroup.list' })

      expect(result).toMatchObject(forbidden)
      expect(runtime.listProjectGroups).not.toHaveBeenCalled()
    })
  })
})
