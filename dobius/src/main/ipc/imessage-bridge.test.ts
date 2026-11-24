import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  config: { enabled: true, triggerPrefix: 'd:', selfHandle: '+15550102000', lastSeenRowid: 4 },
  update: vi.fn((updates: Record<string, unknown>) => updates),
  restart: vi.fn(),
  testSend: vi.fn(async () => ({ ok: true })),
  openExternal: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler)
  },
  shell: { openExternal: mocks.openExternal }
}))
vi.mock('../imessage-bridge/bridge-service', () => ({
  getImessageBridgeConfig: () => ({ ...mocks.config }),
  getImessageBridgeStatus: () => ({ enabled: true, selfHandle: mocks.config.selfHandle }),
  restartImessageBridge: mocks.restart,
  testImessageSend: mocks.testSend,
  updateImessageBridgeSettings: mocks.update
}))

import { IMESSAGE_BRIDGE_UNTRUSTED, registerImessageBridgeHandlers } from './imessage-bridge'

const TRUSTED = { trusted: true }
const UNTRUSTED = { trusted: false }

function invoke(channel: string, event: unknown, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return handler(event, ...args)
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  registerImessageBridgeHandlers((event) => (event as unknown as { trusted: boolean }).trusted)
})

describe('iMessage bridge IPC trust', () => {
  it('gives an untrusted sender no data and changes nothing', async () => {
    expect(invoke('imessageBridge:getConfig', UNTRUSTED)).toBeNull()
    expect(invoke('imessageBridge:status', UNTRUSTED)).toBeNull()
    expect(() => invoke('imessageBridge:updateConfig', UNTRUSTED, { enabled: true, selfHandle: '+1999' })).toThrow(
      IMESSAGE_BRIDGE_UNTRUSTED
    )
    expect(await invoke('imessageBridge:testSend', UNTRUSTED)).toEqual({ ok: false, error: IMESSAGE_BRIDGE_UNTRUSTED })
    expect(await invoke('imessageBridge:openFullDiskAccess', UNTRUSTED)).toBeUndefined()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.restart).not.toHaveBeenCalled()
    expect(mocks.testSend).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('serves the trusted main window as before', async () => {
    expect(invoke('imessageBridge:getConfig', TRUSTED)).toMatchObject({ selfHandle: '+15550102000' })
    expect(invoke('imessageBridge:status', TRUSTED)).toMatchObject({ enabled: true })
    invoke('imessageBridge:updateConfig', TRUSTED, { enabled: false, lastSeenRowid: 0 })
    expect(mocks.update).toHaveBeenCalledWith({ enabled: false, triggerPrefix: undefined, selfHandle: undefined })
    expect(mocks.restart).toHaveBeenCalledTimes(1)
    expect(await invoke('imessageBridge:testSend', TRUSTED)).toEqual({ ok: true })
  })

  it('refuses everyone by default until the main window exists', () => {
    mocks.handlers.clear()
    registerImessageBridgeHandlers()
    expect(invoke('imessageBridge:getConfig', TRUSTED)).toBeNull()
  })
})
