// A connected console (`console-<id>`) may act only in its linked web tile.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { execFileMock, webContentsFromIdMock, partitions } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  webContentsFromIdMock: vi.fn(),
  partitions: new Map<string, { partition: string }>()
}))

vi.mock('child_process', () => ({ execFile: execFileMock }))
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => Buffer.from('')),
  accessSync: vi.fn(),
  chmodSync: vi.fn(),
  constants: { X_OK: 1 }
}))
vi.mock('os', () => ({ platform: () => 'darwin', arch: () => 'arm64' }))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/app'), getAppPath: vi.fn(() => '/project'), isPackaged: false },
  webContents: { fromId: webContentsFromIdMock },
  session: {
    fromPartition: (partition: string) => {
      let value = partitions.get(partition)
      if (!value) {
        value = { partition }
        partitions.set(partition, value)
      }
      return value
    }
  }
}))
vi.mock('./cdp-ws-proxy', () => ({
  CdpWsProxy: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.start = vi.fn(async () => 'ws://127.0.0.1:9222')
    this.stop = vi.fn(async () => {})
    this.getPort = vi.fn(() => 9222)
  })
}))
vi.mock('./cdp-bridge', () => ({
  BrowserError: class BrowserError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
}))

import { AgentBrowserBridge } from './agent-browser-bridge'
import { runWithAgentIdentity, type AgentCommandIdentity } from './agent-command-context'
import type { AgentCursorHooks } from './agent-cursor-driver'
import type { BrowserManager } from './browser-manager'
import { consoleTileBindings } from '../agents/console-tile-bindings'
import { DOBIUS_BROWSER_PARTITION, DOBIUS_WEB_TILE_PARTITION } from '../../shared/constants'
import { session } from 'electron'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(AgentBrowserBridge.prototype as any).getWebContents = function (id: number) {
  return webContentsFromIdMock(id) ?? null
}

const claude1: AgentCommandIdentity = { agentId: 'console-3f1c9a2b', name: 'Claude 1', fast: true }
const adam: AgentCommandIdentity = { agentId: 'adam', name: 'Adam', fast: true }

function mockBrowserManager(tabs: Map<string, number>): BrowserManager {
  return {
    getWebContentsIdByTabId: () => tabs,
    getWorktreeIdForTab: () => undefined,
    getGuestWebContentsId: vi.fn(() => null),
    unregisterGuest: vi.fn(),
    ensureWebviewVisible: vi.fn(async () => () => {}),
    acquireAutomationVisibility: vi.fn(async () => () => {})
  } as unknown as BrowserManager
}

const BUTTON = { tag: 'button', text: 'Open', rect: { x: 10, y: 20, w: 100, h: 40 } }

function mockWebContents(id: number, partition: string) {
  const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'Page.getFrameTree') {
      return { frameTree: { frame: { id: 'frame-main' } } }
    }
    if (method === 'Page.createIsolatedWorld') {
      return { executionContextId: 77 }
    }
    if (method === 'Runtime.evaluate') {
      return { result: { value: params?.contextId === 77 ? JSON.stringify(BUTTON) : undefined } }
    }
    return {}
  })
  return {
    id,
    session: session.fromPartition(partition),
    getURL: () => 'https://example.com/app',
    getTitle: () => 'Example',
    isDestroyed: () => false,
    focus: vi.fn(),
    sendInputEvent: vi.fn(),
    reload: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    debugger: {
      isAttached: vi.fn(() => true),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand,
      on: vi.fn(),
      removeListener: vi.fn()
    }
  }
}

function respond(): string[][] {
  const calls: string[][] = []
  type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void
  execFileMock.mockImplementation(
    (_bin: string, args: string[], _opts: unknown, cb: ExecCallback) => {
      calls.push(args)
      const data =
        args.includes('get') && args.includes('box')
          ? { x: 10, y: 20, width: 100, height: 40 }
          : args.includes('get') && args.includes('text')
            ? 'Open'
            : args.includes('click')
              ? { clicked: '@e1' }
              : {}
      cb(null, JSON.stringify({ success: true, data }), '')
    }
  )
  return calls
}

function hooks(): AgentCursorHooks {
  return {
    notify: () => {},
    awaitAgentClearance: async () => 'ok',
    claimTile: () => ({ ok: true, until: Date.now() + 3000 }),
    requestGateApproval: async () => true,
    clearanceNow: () => 'ok',
    markAgentDispatch: () => () => {}
  }
}

describe('console driver tile binding (main-side)', () => {
  const tabs = new Map([
    ['web-tile:own', 100],
    ['web-tile:other', 300],
    ['tab-1', 200]
  ])
  let bridge: AgentBrowserBridge
  let calls: string[][]

  beforeEach(() => {
    execFileMock.mockReset()
    consoleTileBindings.resetForTest()
    const own = mockWebContents(100, DOBIUS_WEB_TILE_PARTITION)
    const other = mockWebContents(300, DOBIUS_WEB_TILE_PARTITION)
    const tab = mockWebContents(200, DOBIUS_BROWSER_PARTITION)
    webContentsFromIdMock.mockImplementation((id: number) =>
      id === 100 ? own : id === 300 ? other : id === 200 ? tab : null
    )
    calls = respond()
    bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks() })
  })

  it('allows the console in its own connected tile', async () => {
    consoleTileBindings.replaceAll([{ agentId: claude1.agentId, tileId: 'own' }])
    await expect(
      runWithAgentIdentity(claude1, () => bridge.click('@e1', undefined, 'web-tile:own'))
    ).resolves.toEqual({ clicked: '@e1' })
    expect(calls.some((args) => args.includes('click'))).toBe(true)
  })

  it('refuses another web tile, dispatching nothing', async () => {
    consoleTileBindings.replaceAll([{ agentId: claude1.agentId, tileId: 'own' }])
    await expect(
      runWithAgentIdentity(claude1, () => bridge.click('@e1', undefined, 'web-tile:other'))
    ).rejects.toMatchObject({
      code: 'agent_not_connected_to_tile',
      message: expect.stringContaining('web-tile:own')
    })
    expect(calls).toEqual([])
  })

  it('refuses a regular browser tab (existing target policy still first)', async () => {
    consoleTileBindings.replaceAll([{ agentId: claude1.agentId, tileId: 'own' }])
    await expect(
      runWithAgentIdentity(claude1, () => bridge.click('@e1', undefined, 'tab-1'))
    ).rejects.toMatchObject({ code: 'agent_target_forbidden' })
    expect(calls).toEqual([])
  })

  it('refuses everything once disconnected, and before any connection', async () => {
    await expect(
      runWithAgentIdentity(claude1, () => bridge.click('@e1', undefined, 'web-tile:own'))
    ).rejects.toMatchObject({
      code: 'agent_not_connected_to_tile',
      message: expect.stringContaining('not connected')
    })
    consoleTileBindings.replaceAll([{ agentId: claude1.agentId, tileId: 'own' }])
    consoleTileBindings.replaceAll([])
    await expect(
      runWithAgentIdentity(claude1, () => bridge.click('@e1', undefined, 'web-tile:own'))
    ).rejects.toMatchObject({ code: 'agent_not_connected_to_tile' })
    expect(calls).toEqual([])
  })

  it('does not restrict non-console agents', async () => {
    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:other'))
    ).resolves.toEqual({ clicked: '@e1' })
  })
})
