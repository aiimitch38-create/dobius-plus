import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentCursorEvent } from '../../shared/agent-cursor'

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

import { AGENT_PAGE_CONTENT_PROVENANCE, AgentBrowserBridge } from './agent-browser-bridge'
import { AGENT_BROWSER_METHOD_POLICY } from './agent-browser-method-policy'
import { runWithAgentIdentity, type AgentCommandIdentity } from './agent-command-context'
import type { AgentCursorHooks } from './agent-cursor-driver'
import type { BrowserManager } from './browser-manager'
import { DOBIUS_BROWSER_PARTITION, DOBIUS_WEB_TILE_PARTITION } from '../../shared/constants'
import { session } from 'electron'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(AgentBrowserBridge.prototype as any).getWebContents = function (id: number) {
  return webContentsFromIdMock(id) ?? null
}

const adam: AgentCommandIdentity = { agentId: 'adam', name: 'Adam', fast: true }

function mockBrowserManager(
  tabs: Map<string, number>,
  worktrees: Map<string, string> = new Map()
): BrowserManager {
  return {
    getWebContentsIdByTabId: () => tabs,
    getWorktreeIdForTab: (tabId: string) => worktrees.get(tabId),
    getGuestWebContentsId: vi.fn(() => null),
    unregisterGuest: vi.fn(),
    ensureWebviewVisible: vi.fn(async () => () => {}),
    acquireAutomationVisibility: vi.fn(async () => () => {})
  } as unknown as BrowserManager
}

type DescriptorOrNull = Record<string, unknown> | null
type CdpBehaviour = { descriptor?: DescriptorOrNull; isolatedWorld?: boolean; url?: string }

function mockWebContents(id: number, partition: string, behaviour: CdpBehaviour = {}) {
  const { descriptor = null, isolatedWorld = true, url = 'https://example.com/app' } = behaviour
  const sendCommand = vi.fn(
    async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'frame-main' } } }
      }
      if (method === 'Page.createIsolatedWorld') {
        if (!isolatedWorld) {
          throw new Error('isolated worlds unavailable')
        }
        return { executionContextId: 77 }
      }
      if (method === 'Runtime.evaluate') {
        // Why: only the isolated-world context may answer the descriptor; a main-world
        // read (no contextId) returns nothing so a regression would gate as unverified.
        if (params?.contextId !== 77) {
          return { result: { value: undefined } }
        }
        return { result: { value: descriptor === null ? 'null' : JSON.stringify(descriptor) } }
      }
      return {}
    }
  )
  return {
    id,
    session: session.fromPartition(partition),
    getURL: () => url,
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

type ExecCall = string[]

function respondByCommand(options: { refText?: string } = {}): ExecCall[] {
  const calls: ExecCall[] = []
  type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void
  execFileMock.mockImplementation((_bin: string, args: string[], _opts: unknown, cb: ExecCallback) => {
    calls.push(args)
    const cmd = args.filter((a) => a !== '--json' && a !== '--session' && a !== '--cdp')
    const data =
      cmd.includes('get') && cmd.includes('box')
        ? { x: 10, y: 20, width: 100, height: 40 }
        : cmd.includes('get') && cmd.includes('text')
          ? (options.refText ?? 'Open')
          : cmd.includes('click')
            ? { clicked: '@e1' }
            : cmd.includes('snapshot')
              ? { snapshot: '- button "Open" [ref=e1]', refs: [], url: 'u', title: 't' }
              : cmd.includes('goto')
                ? { url: 'https://example.com/next', title: 'Next' }
                : {}
    cb(null, JSON.stringify({ success: true, data }), '')
  })
  return calls
}

function commandNames(calls: ExecCall[]): string[] {
  return (
    calls
      .map((args) => args.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a)))
      .map((args) => args.filter((a) => !a.startsWith('dobius-tab-')).slice(0, 2).join(' '))
      // Why: session creation always closes a possibly-stale daemon session first.
      .filter((name) => name !== 'close')
  )
}

function makeHooks(): {
  hooks: AgentCursorHooks
  events: AgentCursorEvent[]
  dispatchMarks: { open: number; closed: number }
} {
  const events: AgentCursorEvent[] = []
  const dispatchMarks = { open: 0, closed: 0 }
  return {
    events,
    dispatchMarks,
    hooks: {
      notify: (event) => {
        events.push(event)
      },
      awaitAgentClearance: async () => 'ok',
      claimTile: () => ({ ok: true, until: Date.now() + 3000 }),
      requestGateApproval: async () => true,
      clearanceNow: () => 'ok',
      markAgentDispatch: () => {
        dispatchMarks.open++
        return () => {
          dispatchMarks.closed++
        }
      }
    }
  }
}

const BUTTON = { tag: 'button', text: 'Open', rect: { x: 10, y: 20, w: 100, h: 40 } }

describe('AgentBrowserBridge agent co-presence', () => {
  const tabs = new Map([
    ['web-tile:card-1', 100],
    ['tab-1', 200],
    ['web-tile:card-2', 300]
  ])
  let privateTile: ReturnType<typeof mockWebContents>
  let browserTab: ReturnType<typeof mockWebContents>
  let sharedTile: ReturnType<typeof mockWebContents>

  beforeEach(() => {
    execFileMock.mockReset()
    privateTile = mockWebContents(100, DOBIUS_WEB_TILE_PARTITION, { descriptor: BUTTON })
    browserTab = mockWebContents(200, DOBIUS_BROWSER_PARTITION)
    sharedTile = mockWebContents(300, DOBIUS_BROWSER_PARTITION, { descriptor: BUTTON })
    webContentsFromIdMock.mockImplementation((id: number) =>
      id === 100 ? privateTile : id === 200 ? browserTab : id === 300 ? sharedTile : null
    )
  })

  it('keeps BrowserPane tabs on the legacy path: one click command, no cursor events', async () => {
    const calls = respondByCommand()
    const { hooks, events } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await expect(bridge.click('@e1', undefined, 'tab-1')).resolves.toEqual({ clicked: '@e1' })

    expect(commandNames(calls)).toEqual(['click @e1'])
    expect(events).toEqual([])
    expect(browserTab.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('agent click on a private tile: move -> hover -> click, isolated-world descriptor, no wc.focus()', async () => {
    const calls = respondByCommand()
    const { hooks, events, dispatchMarks } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    const result = await runWithAgentIdentity(adam, () =>
      bridge.click('@e1', undefined, 'web-tile:card-1')
    )

    expect(result).toEqual({ clicked: '@e1' })
    expect(commandNames(calls)).toEqual(['scrollintoview @e1', 'get box', 'get text', 'click @e1'])
    expect(events.map((e) => e.kind)).toEqual(['move', 'hover', 'click'])
    expect(events[1].target).toEqual({ tileId: 'card-1', x: 10, y: 20, w: 100, h: 40 })
    expect(events[2].target).toEqual({ tileId: 'card-1', x: 60, y: 40 })

    const cdp = privateTile.debugger.sendCommand.mock.calls
    expect(cdp.some(([m]) => m === 'Page.createIsolatedWorld')).toBe(true)
    expect(
      cdp.some(([m, p]) => m === 'Runtime.evaluate' && (p as { contextId?: number })?.contextId === 77)
    ).toBe(true)
    expect(cdp.some(([m, p]) => m === 'Input.dispatchMouseEvent' && (p as { type?: string })?.type === 'mouseMoved')).toBe(true)
    expect(privateTile.focus).not.toHaveBeenCalled()
    expect(privateTile.sendInputEvent).not.toHaveBeenCalled()
    // Every synthetic input (mouseMoved steps + the click itself) was bracketed.
    expect(dispatchMarks.open).toBeGreaterThanOrEqual(2)
    expect(dispatchMarks.closed).toBe(dispatchMarks.open)
  })

  it('enables focus emulation on every action (not cached) and disables it on a handoff error', async () => {
    respondByCommand()
    const { hooks } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    await runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    const enables = (): number =>
      privateTile.debugger.sendCommand.mock.calls.filter(
        ([m, p]) => m === 'Emulation.setFocusEmulationEnabled' && (p as { enabled?: boolean })?.enabled === true
      ).length
    expect(enables()).toBe(2)

    hooks.awaitAgentClearance = async () => 'stopped'
    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    ).rejects.toMatchObject({ code: 'agent_stopped' })
    expect(
      privateTile.debugger.sendCommand.mock.calls.some(
        ([m, p]) => m === 'Emulation.setFocusEmulationEnabled' && (p as { enabled?: boolean })?.enabled === false
      )
    ).toBe(true)
  })

  it('a web tile without --as is driven as the synthesized "Agent": visible and gated, never legacy', async () => {
    const calls = respondByCommand()
    const { hooks, events } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await bridge.click('@e1', undefined, 'web-tile:card-1')

    // Why: the synthesized agent is not --fast, so travel emits several moves.
    const kinds = events.map((e) => e.kind)
    expect(kinds[0]).toBe('move')
    expect(kinds.slice(-2)).toEqual(['hover', 'click'])
    expect(events.every((e) => e.agentId === 'agent' && e.name === 'Agent')).toBe(true)
    expect(commandNames(calls)[0]).toBe('scrollintoview @e1')
    expect(privateTile.focus).not.toHaveBeenCalled()

    // Denied commands stay denied for the synthesized identity too.
    await expect(bridge.evaluate('1+1', undefined, 'web-tile:card-1')).rejects.toMatchObject({
      code: 'agent_action_forbidden'
    })
  })

  it('refuses agent commands against a regular browser tab, dispatching nothing', async () => {
    const calls = respondByCommand()
    const { hooks, events } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'tab-1'))
    ).rejects.toMatchObject({
      code: 'agent_target_forbidden',
      message: expect.stringContaining('web-tile:')
    })
    expect(calls).toEqual([])
    expect(events).toEqual([])
  })

  it('refuses a tile the user switched to the shared (signed-in) session, with a hint', async () => {
    const calls = respondByCommand()
    const { hooks } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-2'))
    ).rejects.toMatchObject({
      code: 'agent_target_forbidden',
      message: expect.stringContaining('private')
    })
    await expect(bridge.type('hello', undefined, 'web-tile:card-2')).rejects.toMatchObject({
      code: 'agent_target_forbidden'
    })
    expect(calls).toEqual([])
  })

  it('refuses tiles that belong to another worktree than the command targets', async () => {
    respondByCommand()
    const { hooks } = makeHooks()
    const worktrees = new Map([
      ['web-tile:card-1', 'wt-a'],
      ['tab-1', 'wt-b']
    ])
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs, worktrees), { agentCursor: hooks })

    // Why: an explicit --worktree scopes the tab lookup itself, so a foreign tile
    // is simply not found there (nothing dispatched either way).
    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', 'wt-b', 'web-tile:card-1'))
    ).rejects.toMatchObject({ code: 'browser_tab_not_found' })

    // Explicit matching worktree: allowed.
    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', 'wt-a', 'web-tile:card-1'))
    ).resolves.toEqual({ clicked: '@e1' })

    // No worktree given: the active tab's worktree is the scope.
    bridge.setActiveTab(200, 'wt-b')
    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    ).rejects.toMatchObject({
      code: 'agent_target_forbidden',
      message: expect.stringMatching(/belongs to worktree wt-a, not wt-b/)
    })
    bridge.setActiveTab(100, 'wt-a')
    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    ).resolves.toEqual({ clicked: '@e1' })
  })

  it('denies eval/exec/find/mouse down|up/upload/download for agents with a hint; dispatches nothing', async () => {
    const calls = respondByCommand()
    const { hooks } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })
    const page = 'web-tile:card-1'
    const denied: (() => Promise<unknown>)[] = [
      () => bridge.evaluate('document.title', undefined, page),
      () => bridge.exec('click @e1', undefined, page),
      () => bridge.find('role', 'button', 'click', undefined, undefined, page),
      () => bridge.mouseDown('left', undefined, page),
      () => bridge.mouseUp('left', undefined, page),
      () => bridge.upload('@e1', ['/tmp/x.png'], undefined, page),
      () => bridge.download('@e1', '/tmp/out', undefined, page)
    ]
    for (const run of denied) {
      await expect(runWithAgentIdentity(adam, run)).rejects.toMatchObject({
        code: 'agent_action_forbidden',
        message: expect.stringMatching(/click|snapshot|user/i)
      })
    }
    expect(commandNames(calls)).toEqual([])

    // The same commands still work for a human on a BrowserPane tab.
    await expect(bridge.evaluate('1', undefined, 'tab-1')).resolves.toBeDefined()
  })

  it('routes every staged command through the driver (an event is emitted for each)', async () => {
    respondByCommand()
    const { hooks, events } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })
    const page = 'web-tile:card-1'
    const staged: [string, () => Promise<unknown>, string][] = [
      ['click', () => bridge.click('@e1', undefined, page), 'click'],
      ['dblclick', () => bridge.dblclick('@e1', undefined, page), 'dblclick'],
      ['fill', () => bridge.fill('@e1', 'x', undefined, page), 'type'],
      ['type', () => bridge.type('x', undefined, page), 'type'],
      ['inserttext', () => bridge.keyboardInsertText('x', undefined, page), 'type'],
      ['select', () => bridge.select('@e1', 'v', undefined, page), 'click'],
      ['scroll', () => bridge.scroll('down', 100, undefined, page), 'scroll'],
      ['scrollIntoView', () => bridge.scrollIntoView('@e1', undefined, page), 'scroll'],
      ['mouseMove', () => bridge.mouseMove(5, 5, undefined, page), 'move'],
      ['mouseClick', () => bridge.mouseClick(5, 5, 'left', undefined, page), 'click'],
      ['mouseWheel', () => bridge.mouseWheel(10, undefined, undefined, page), 'scroll'],
      ['hover', () => bridge.hover('@e1', undefined, page), 'hover'],
      ['highlight', () => bridge.highlight('#x', undefined, page), 'hover'],
      ['drag', () => bridge.drag('@e1', '@e2', undefined, page), 'drag'],
      ['keypress', () => bridge.keypress('Tab', undefined, page), 'key'],
      ['check', () => bridge.check('@e1', true, undefined, page), 'click'],
      ['focus', () => bridge.focus('@e1', undefined, page), 'click'],
      ['clear', () => bridge.clear('@e1', undefined, page), 'type'],
      ['selectAll', () => bridge.selectAll('@e1', undefined, page), 'key'],
      ['goto', () => bridge.goto('https://example.com/next', undefined, page), 'thinking'],
      ['back', () => bridge.back(undefined, page), 'thinking'],
      ['forward', () => bridge.forward(undefined, page), 'thinking'],
      ['dialogAccept', () => bridge.dialogAccept(undefined, undefined, page), 'click'],
      ['dialogDismiss', () => bridge.dialogDismiss(undefined, page), 'click']
    ]
    for (const [name, run, expectedKind] of staged) {
      events.length = 0
      await runWithAgentIdentity(adam, run)
      const kinds = events.map((e) => e.kind)
      expect(kinds, name).toContain('hover')
      expect(kinds.at(-1), name).toBe(expectedKind)
    }
  })

  it('fails closed: a click whose target cannot be described in an isolated world is gated as unverified', async () => {
    respondByCommand()
    const { hooks, events } = makeHooks()
    const approvals: string[] = []
    hooks.requestGateApproval = async (_agentId, gate) => {
      approvals.push(gate.kind)
      return false
    }
    privateTile = mockWebContents(100, DOBIUS_WEB_TILE_PARTITION, { isolatedWorld: false })
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    ).rejects.toMatchObject({ code: 'agent_gate_denied' })
    expect(approvals).toEqual(['unverified'])
    const waiting = events.find((e) => e.kind === 'waiting_human')!
    expect(waiting.gated?.kind).toBe('unverified')
    expect(waiting.text).toContain('<unverified target> on example.com')

    // Pointer landing in an iframe is unverified too, even with a descriptor.
    privateTile = mockWebContents(100, DOBIUS_WEB_TILE_PARTITION, { descriptor: { tag: 'iframe' } })
    approvals.length = 0
    await expect(
      runWithAgentIdentity(adam, () => bridge.mouseClick(5, 5, 'left', undefined, 'web-tile:card-1'))
    ).rejects.toMatchObject({ code: 'agent_gate_denied' })
    expect(approvals).toEqual(['unverified'])
  })

  it('gates a click when the element under the pointer is not the ref (overlay / clickjack)', async () => {
    respondByCommand({ refText: 'Save draft' })
    const { hooks, events } = makeHooks()
    hooks.requestGateApproval = async () => false
    privateTile = mockWebContents(100, DOBIUS_WEB_TILE_PARTITION, {
      descriptor: { tag: 'button', text: 'Accept all cookies', rect: { x: 0, y: 0, w: 900, h: 80 } }
    })
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    ).rejects.toMatchObject({ code: 'agent_gate_denied' })
    const waiting = events.find((e) => e.kind === 'waiting_human')!
    expect(waiting.gated?.kind).toBe('unverified')
    expect(waiting.text).toContain('overlay')
    expect(waiting.text).toContain('page says: "Accept all cookies"')
  })

  it('gates by trusted URL (from webContents, not the page) and labels with hostname + tag', async () => {
    respondByCommand({ refText: 'Next' })
    const { hooks, events } = makeHooks()
    const approvals: string[] = []
    hooks.requestGateApproval = async (_agentId, gate) => {
      approvals.push(gate.kind)
      return true
    }
    privateTile = mockWebContents(100, DOBIUS_WEB_TILE_PARTITION, {
      descriptor: { ...BUTTON, text: 'Next', url: 'https://totally-safe.example/' },
      url: 'https://accounts.google.com/signin'
    })
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    expect(approvals).toEqual(['login'])
    const waiting = events.find((e) => e.kind === 'waiting_human')!
    expect(waiting.text).toBe('click <button> on accounts.google.com (page says: "Next")')
  })

  it('agent type emits textLength only, never the text', async () => {
    const calls = respondByCommand()
    const { hooks, events } = makeHooks()
    privateTile = mockWebContents(100, DOBIUS_WEB_TILE_PARTITION, {
      descriptor: { tag: 'input', type: 'text', rect: { x: 0, y: 0, w: 200, h: 30 } }
    })
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await runWithAgentIdentity(adam, () =>
      bridge.type('hunter2 secret', undefined, 'web-tile:card-1')
    )

    const typed = events.find((e) => e.kind === 'type')!
    expect(typed.textLength).toBe('hunter2 secret'.length)
    expect(typed.text).toBeUndefined()
    expect(JSON.stringify(events)).not.toContain('hunter2')
    expect(calls.some((args) => args.includes('hunter2 secret'))).toBe(true)
  })

  it('agent type into a password field is gated as login and refused when denied', async () => {
    const calls = respondByCommand()
    const { hooks, events } = makeHooks()
    hooks.requestGateApproval = async () => false
    privateTile = mockWebContents(100, DOBIUS_WEB_TILE_PARTITION, {
      descriptor: { tag: 'input', type: 'password', rect: { x: 0, y: 0, w: 200, h: 30 } }
    })
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await expect(
      runWithAgentIdentity(adam, () => bridge.type('s3cret', undefined, 'web-tile:card-1'))
    ).rejects.toMatchObject({ code: 'agent_gate_denied' })
    expect(events.find((e) => e.kind === 'waiting_human')?.gated?.kind).toBe('login')
    expect(calls.some((args) => args.includes('s3cret'))).toBe(false)
  })

  it('Enter in a composer and text ending in a newline are gated as send', async () => {
    respondByCommand()
    const { hooks } = makeHooks()
    const approvals: string[] = []
    hooks.requestGateApproval = async (_agentId, gate) => {
      approvals.push(gate.kind)
      return true
    }
    privateTile = mockWebContents(100, DOBIUS_WEB_TILE_PARTITION, {
      descriptor: { tag: 'textarea', rect: { x: 0, y: 0, w: 300, h: 80 } }
    })
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await runWithAgentIdentity(adam, () => bridge.keypress('Enter', undefined, 'web-tile:card-1'))
    await runWithAgentIdentity(adam, () => bridge.type('hello\n', undefined, 'web-tile:card-1'))
    await runWithAgentIdentity(adam, () => bridge.type('hello', undefined, 'web-tile:card-1'))
    expect(approvals).toEqual(['send', 'send'])
  })

  it('mouseClick for an agent never calls wc.focus(); a human on a BrowserPane tab still does', async () => {
    respondByCommand()
    const { hooks } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await runWithAgentIdentity(adam, () =>
      bridge.mouseClick(5, 6, 'left', undefined, 'web-tile:card-1')
    )
    expect(privateTile.focus).not.toHaveBeenCalled()

    await bridge.mouseClick(5, 6, 'left', undefined, 'tab-1')
    expect(browserTab.focus).toHaveBeenCalledTimes(1)
  })

  it('refuses `wait --fn` (an eval) for explicit and synthesized identities, allows other waits', async () => {
    const calls = respondByCommand()
    const { hooks } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await expect(
      runWithAgentIdentity(adam, () => bridge.wait({ fn: 'window.secret' }, undefined, 'web-tile:card-1'))
    ).rejects.toMatchObject({ code: 'agent_action_forbidden', message: expect.stringContaining('--selector') })
    await expect(bridge.wait({ fn: 'window.secret' }, undefined, 'web-tile:card-1')).rejects.toMatchObject({
      code: 'agent_action_forbidden'
    })
    expect(commandNames(calls)).toEqual([])

    await expect(bridge.wait({ text: 'Done', timeout: 10 }, undefined, 'web-tile:card-1')).resolves.toBeDefined()
    await expect(bridge.wait({ fn: 'true' }, undefined, 'tab-1')).resolves.toBeDefined()
  })

  it('the bridge is the single enforcement point: every deny-listed page command is refused on an anonymous tile', async () => {
    const calls = respondByCommand()
    const { hooks } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })
    const page = 'web-tile:card-1'
    const denyCalls: Record<string, () => Promise<unknown>> = {
      'browser.eval': () => bridge.evaluate('1', undefined, page),
      'browser.exec': () => bridge.exec('click @e1', undefined, page),
      'browser.find': () => bridge.find('role', 'button', 'click', undefined, undefined, page),
      'browser.mouseDown': () => bridge.mouseDown('left', undefined, page),
      'browser.mouseUp': () => bridge.mouseUp('left', undefined, page),
      'browser.upload': () => bridge.upload('@e1', ['/tmp/x'], undefined, page),
      'browser.download': () => bridge.download('@e1', '/tmp/out', undefined, page),
      'browser.cookie.set': () => bridge.cookieSet({ name: 'a', value: 'b' }, undefined, page),
      'browser.cookie.delete': () => bridge.cookieDelete('a', undefined, undefined, undefined, page),
      'browser.viewport': () => bridge.setViewport(800, 600, 1, false, undefined, page),
      'browser.geolocation': () => bridge.setGeolocation(1, 2, undefined, undefined, page),
      'browser.intercept.enable': () => bridge.interceptEnable(['**/*'], undefined, page),
      'browser.intercept.disable': () => bridge.interceptDisable(undefined, page),
      'browser.capture.start': () => bridge.captureStart(undefined, page),
      'browser.capture.stop': () => bridge.captureStop(undefined, page),
      'browser.setDevice': () => bridge.setDevice('iPhone', undefined, page),
      'browser.setOffline': () => bridge.setOffline('on', undefined, page),
      'browser.setHeaders': () => bridge.setHeaders('{}', undefined, page),
      'browser.setCredentials': () => bridge.setCredentials('u', 'p', undefined, page),
      'browser.setMedia': () => bridge.setMedia('dark', undefined, undefined, page),
      'browser.clipboardWrite': () => bridge.clipboardWrite('x', undefined, page),
      'browser.storage.local.set': () => bridge.storageLocalSet('k', 'v', undefined, page),
      'browser.storage.local.clear': () => bridge.storageLocalClear(undefined, page),
      'browser.storage.session.set': () => bridge.storageSessionSet('k', 'v', undefined, page),
      'browser.storage.session.clear': () => bridge.storageSessionClear(undefined, page)
    }
    // Why: tab/profile management is not a page command; the RPC layer denies it
    // for explicit identities and it never reaches a tile through the bridge.
    const notPageCommands = new Set([
      'browser.tabSwitch',
      'browser.tabCreate',
      'browser.tabSetProfile',
      'browser.tabProfileClone',
      'browser.tabClose',
      'browser.profileCreate',
      'browser.profileDelete',
      'browser.profileDetectBrowsers',
      'browser.profileImportFromBrowser',
      'browser.profileClearDefaultCookies'
    ])
    const denyEntries = Object.entries(AGENT_BROWSER_METHOD_POLICY)
      .filter(([, policy]) => policy === 'deny')
      .map(([name]) => name)
    const unaccounted = denyEntries.filter((n) => !(n in denyCalls) && !notPageCommands.has(n))
    expect(unaccounted).toEqual([])

    for (const name of denyEntries.filter((n) => n in denyCalls)) {
      // No --as: the synthesized tile identity must still be refused.
      await expect(denyCalls[name](), name).rejects.toMatchObject({ code: 'agent_action_forbidden' })
    }
    expect(commandNames(calls)).toEqual([])

    // The same bridge methods keep working for a human on a BrowserPane tab.
    await expect(bridge.storageLocalSet('k', 'v', undefined, 'tab-1')).resolves.toBeDefined()
    await expect(bridge.cookieSet({ name: 'a', value: 'b' }, undefined, 'tab-1')).resolves.toBeDefined()
  })

  it('checks a synchronous clearance snapshot before touching the page (no focus emulation, no locate)', async () => {
    const calls = respondByCommand()
    const { hooks } = makeHooks()
    hooks.clearanceNow = () => 'paused'
    const awaitSpy = vi.fn(async () => 'ok' as const)
    hooks.awaitAgentClearance = awaitSpy
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    ).rejects.toMatchObject({ code: 'agent_paused' })
    expect(commandNames(calls)).toEqual([])
    expect(
      privateTile.debugger.sendCommand.mock.calls.filter(
        ([m, p]) => m === 'Emulation.setFocusEmulationEnabled' && (p as { enabled?: boolean })?.enabled === true
      )
    ).toHaveLength(0)
    expect(awaitSpy).not.toHaveBeenCalled()
  })

  it('brackets only real input dispatch as agent input: goto marks nothing, click marks move + click', async () => {
    respondByCommand()
    const { hooks, dispatchMarks } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    await runWithAgentIdentity(adam, () => bridge.goto('https://example.com/x', undefined, 'web-tile:card-1'))
    // --fast travel sends one mouseMoved; navigation itself is never marked.
    expect(dispatchMarks.open).toBe(1)
    expect(dispatchMarks.closed).toBe(1)

    await runWithAgentIdentity(adam, () => bridge.fill('@e1', 'hello', undefined, 'web-tile:card-1'))
    // fill sets the value through evals, not key events: only the mouseMoved is marked.
    expect(dispatchMarks.open).toBe(2)

    await runWithAgentIdentity(adam, () => bridge.keypress('Tab', undefined, 'web-tile:card-1'))
    expect(dispatchMarks.open).toBe(4)
    expect(dispatchMarks.closed).toBe(4)
  })

  it('drops focus emulation after a successful action as well', async () => {
    respondByCommand()
    const { hooks } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })
    await runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    const focusCalls = privateTile.debugger.sendCommand.mock.calls
      .filter(([m]) => m === 'Emulation.setFocusEmulationEnabled')
      .map(([, p]) => (p as { enabled?: boolean })?.enabled)
    expect(focusCalls).toEqual([true, false])
  })

  it('refuses agent commands when no co-presence hooks are wired', async () => {
    respondByCommand()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs))
    await expect(
      runWithAgentIdentity(adam, () => bridge.click('@e1', undefined, 'web-tile:card-1'))
    ).rejects.toMatchObject({ code: 'agent_cursor_unavailable' })
  })

  it('marks agent snapshots as untrusted page content; BrowserPane snapshots are unchanged', async () => {
    respondByCommand()
    const { hooks } = makeHooks()
    const bridge = new AgentBrowserBridge(mockBrowserManager(tabs), { agentCursor: hooks })

    const agentSnapshot = await runWithAgentIdentity(adam, () =>
      bridge.snapshot(undefined, 'web-tile:card-1')
    )
    expect(agentSnapshot).toMatchObject({ provenance: AGENT_PAGE_CONTENT_PROVENANCE })

    const humanSnapshot = await bridge.snapshot(undefined, 'tab-1')
    expect('provenance' in humanSnapshot).toBe(false)
  })
})
