import { describe, expect, it, vi } from 'vitest'
import type { AgentCursorEvent } from '../../../../shared/agent-cursor'
import type { RuntimeBoardOpenWebTileEvent } from '../../../../shared/runtime-client-events'
import { DobiusRuntimeService } from '../../dobius-runtime'
import type { RpcRequest, RpcResponse } from '../core'
import { RpcDispatcher } from '../dispatcher'

vi.mock('../../../ipc/browser', () => ({ waitForTabRegistration: vi.fn(() => Promise.resolve()) }))

const { BOARD_WEB_TILE_METHODS, openBoardWebTile } = await import('./board-web-tiles')
const { waitForTabRegistration } = await import('../../../ipc/browser')

const WT = 'wt-1'

function makeRuntime(cardId: string | null = 'card-9') {
  const notify = vi.fn(async (_event: RuntimeBoardOpenWebTileEvent) => ({
    cardId,
    delivered: cardId !== null
  }))
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    showManagedWorktree: vi.fn(async () => ({ id: WT })),
    notifyBoardOpenWebTile: notify
  }
  return { runtime: runtime as unknown as DobiusRuntimeService, notify }
}

function request(params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method: 'board.openWebTile', params }
}

function result(response: RpcResponse): unknown {
  if (!response.ok) {
    throw new Error(JSON.stringify(response.error))
  }
  return response.result
}

describe('board.openWebTile', () => {
  it('notifies the renderer, waits for the guest and returns the page handle', async () => {
    const { runtime, notify } = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: BOARD_WEB_TILE_METHODS })
    const response = await dispatcher.dispatch(
      request({ worktree: `id:${WT}`, url: 'https://example.com/a?b=1', title: ' Docs ', agentId: 'adam' })
    )
    expect(result(response)).toMatchObject({
      worktreeId: WT,
      cardId: 'card-9',
      browserPageId: 'web-tile:card-9'
    })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({
      type: 'boardOpenWebTile',
      worktreeId: WT,
      url: 'https://example.com/a?b=1',
      title: 'Docs',
      agentId: 'adam'
    })
    expect(waitForTabRegistration).toHaveBeenCalledWith('web-tile:card-9', expect.any(Number))
  })

  it('rejects non-http(s) URLs, bad agent ids and unknown keys', async () => {
    const { runtime, notify } = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: BOARD_WEB_TILE_METHODS })
    for (const params of [
      { worktree: 'active', url: 'javascript:alert(1)' },
      { worktree: 'active', url: 'file:///etc/passwd' },
      { worktree: 'active', url: 'not a url' },
      { worktree: 'active', url: 'https://x.test', agentId: 'Adam' },
      { worktree: 'active', url: 'https://x.test', session: 'shared' },
      { url: 'https://x.test' }
    ]) {
      const response = await dispatcher.dispatch(request(params))
      expect(response.ok, JSON.stringify(params)).toBe(false)
    }
    expect(notify).not.toHaveBeenCalled()
  })

  it('fails when no window could add the card', async () => {
    const { runtime } = makeRuntime(null)
    await expect(
      openBoardWebTile(runtime, { worktree: 'active', url: 'https://x.test' })
    ).rejects.toThrow(/no_window/)
  })
})

describe('DobiusRuntimeService notify paths', () => {
  const cursor: AgentCursorEvent = {
    agentId: 'adam',
    name: 'Adam',
    color: 'oklch(0.56 0.17 255)',
    kind: 'move',
    target: { tileId: 'card-1', x: 1, y: 2 },
    seq: 1,
    ts: 1
  }

  function fakeRuntime(notifier: object | null, listeners = 0) {
    const emitClientEvent = vi.fn()
    return {
      self: {
        notifier,
        clientEventListeners: new Set(Array.from({ length: listeners }, () => vi.fn())),
        emitClientEvent
      },
      emitClientEvent
    }
  }

  it('notifyAgentCursor sends over window IPC and the client-event stream, reporting delivery', () => {
    const agentCursor = vi.fn()
    const withWindow = fakeRuntime({ agentCursor })
    expect(DobiusRuntimeService.prototype.notifyAgentCursor.call(withWindow.self, cursor)).toEqual({
      delivered: true
    })
    expect(agentCursor).toHaveBeenCalledWith(cursor)
    expect(withWindow.emitClientEvent).toHaveBeenCalledWith({ type: 'agentCursor', event: cursor })

    const nobody = fakeRuntime(null)
    expect(DobiusRuntimeService.prototype.notifyAgentCursor.call(nobody.self, cursor)).toEqual({
      delivered: false
    })
    const remoteOnly = fakeRuntime({}, 1)
    expect(DobiusRuntimeService.prototype.notifyAgentCursor.call(remoteOnly.self, cursor)).toEqual({
      delivered: true
    })
  })

  it('keeps gate request ids and waiting_human off the client-event stream', () => {
    const agentCursor = vi.fn()
    const rt = fakeRuntime({ agentCursor }, 1)
    const gated: AgentCursorEvent = {
      ...cursor,
      kind: 'hover',
      gated: { kind: 'purchase', requestId: 'secret-gate' }
    }
    DobiusRuntimeService.prototype.notifyAgentCursor.call(rt.self, gated)
    expect(agentCursor).toHaveBeenCalledWith(gated)
    expect(rt.emitClientEvent).toHaveBeenCalledTimes(1)
    const relayed = rt.emitClientEvent.mock.calls[0][0] as { event: Record<string, unknown> }
    expect(relayed.event).not.toHaveProperty('gated')
    expect(JSON.stringify(relayed)).not.toContain('secret-gate')

    const waiting: AgentCursorEvent = { ...cursor, kind: 'waiting_human', seq: 2 }
    expect(DobiusRuntimeService.prototype.notifyAgentCursor.call(rt.self, waiting)).toEqual({
      delivered: true
    })
    expect(agentCursor).toHaveBeenCalledWith(waiting)
    expect(rt.emitClientEvent).toHaveBeenCalledTimes(1)
  })

  it('notifyBoardOpenWebTile resolves the card id from the window and null without one', async () => {
    const event: RuntimeBoardOpenWebTileEvent = {
      type: 'boardOpenWebTile',
      requestId: 'r1',
      worktreeId: WT,
      url: 'https://x.test/'
    }
    const boardOpenWebTile = vi.fn(async () => ({ cardId: 'card-2' }))
    const withWindow = fakeRuntime({ boardOpenWebTile })
    await expect(
      DobiusRuntimeService.prototype.notifyBoardOpenWebTile.call(withWindow.self, event)
    ).resolves.toEqual({ cardId: 'card-2', delivered: true })
    expect(withWindow.emitClientEvent).toHaveBeenCalledWith(event)

    const nobody = fakeRuntime(null)
    await expect(
      DobiusRuntimeService.prototype.notifyBoardOpenWebTile.call(nobody.self, event)
    ).resolves.toEqual({ cardId: null, delivered: false })
  })
})
