import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from './dispatcher'
import type { RpcRequest } from './core'
import type { DobiusRuntimeService } from '../dobius-runtime'
import { TERMINAL_METHODS } from './methods/terminal'

function stubRuntime(overrides: Partial<DobiusRuntimeService> = {}): DobiusRuntimeService {
  return {
    getRuntimeId: () => 'runtime-a',
    ...overrides
  } as DobiusRuntimeService
}

function request(method: string, params: unknown): RpcRequest {
  return { id: 'req-bound', authToken: 'test-token', method, params }
}

function noSideEffects(response: Awaited<ReturnType<RpcDispatcher['dispatch']>>) {
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  expect(response.result).toEqual({
    send: { handle: 'term-1', accepted: false, bytesWritten: 0 }
  })
}

describe('terminal.sendBound RPC', () => {
  afterEach(() => vi.useRealTimers())

  it('refuses a stale runtime initially without resolving or writing to a terminal', async () => {
    const runtime = stubRuntime({
      getRuntimeId: () => 'runtime-current',
      resolveLeafForHandle: vi.fn(),
      sendTerminal: vi.fn(),
      mobileTookFloor: vi.fn()
    })
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
    const response = await dispatcher.dispatch(
      request('terminal.sendBound', {
        terminal: 'term-1',
        expectedRuntimeId: 'runtime-old',
        text: 'danger',
        enter: true
      })
    )
    noSideEffects(response)
    expect(runtime.resolveLeafForHandle).not.toHaveBeenCalled()
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
    expect(runtime.mobileTookFloor).not.toHaveBeenCalled()
  })

  it('rechecks runtime identity after the awaited agent-status preflight', async () => {
    let runtimeId = 'runtime-a'
    let finishStatus!: (status: {
      handle: string
      isRunningAgent: boolean
      status: 'working' | 'permission' | 'idle' | null
    }) => void
    const status = new Promise<{
      handle: string
      isRunningAgent: boolean
      status: 'working' | 'permission' | 'idle' | null
    }>((resolve) => {
      finishStatus = resolve
    })
    const runtime = stubRuntime({
      getRuntimeId: () => runtimeId,
      getDriver: vi.fn().mockReturnValue({ kind: 'desktop' }),
      getTerminalAgentStatus: vi.fn(() => status),
      resolveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
      sendTerminal: vi.fn(),
      mobileTookFloor: vi.fn()
    })
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
    const responsePromise = dispatcher.dispatch(
      request('terminal.sendBound', {
        terminal: 'term-1',
        expectedRuntimeId: 'runtime-a',
        text: 'do not submit',
        requireAgentStatus: 'sendable'
      })
    )
    await vi.waitFor(() => expect(runtime.getTerminalAgentStatus).toHaveBeenCalledOnce())
    runtimeId = 'runtime-b'
    finishStatus({ handle: 'term-1', isRunningAgent: true, status: 'working' })
    noSideEffects(await responsePromise)
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
    expect(runtime.mobileTookFloor).not.toHaveBeenCalled()
  })

  it('rechecks after the awaited beforeWrite status and sends no text if identity changed', async () => {
    let runtimeId = 'runtime-a'
    let statusCalls = 0
    let finishBoundaryStatus!: (status: {
      handle: string
      isRunningAgent: boolean
      status: 'working' | 'permission' | 'idle' | null
    }) => void
    const boundaryStatus = new Promise<{
      handle: string
      isRunningAgent: boolean
      status: 'working' | 'permission' | 'idle' | null
    }>((resolve) => {
      finishBoundaryStatus = resolve
    })
    const writes: string[] = []
    const runtime = stubRuntime({
      getRuntimeId: () => runtimeId,
      getDriver: vi.fn().mockReturnValue({ kind: 'desktop' }),
      getTerminalAgentStatus: vi.fn(() => {
        statusCalls += 1
        return statusCalls === 1
          ? Promise.resolve({ handle: 'term-1', isRunningAgent: true, status: 'working' as const })
          : boundaryStatus
      }),
      resolveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
      sendTerminal: vi.fn(async (_terminal, action, options) => {
        await options?.beforeWrite?.('pty-1')
        writes.push(action.text ?? '')
        return { handle: 'term-1', accepted: true, bytesWritten: action.text?.length ?? 0 }
      }),
      mobileTookFloor: vi.fn()
    })
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
    const responsePromise = dispatcher.dispatch(
      request('terminal.sendBound', {
        terminal: 'term-1',
        expectedRuntimeId: 'runtime-a',
        text: 'do not write',
        requireAgentStatus: 'sendable'
      })
    )
    await vi.waitFor(() => expect(statusCalls).toBe(2))
    runtimeId = 'runtime-b'
    finishBoundaryStatus({ handle: 'term-1', isRunningAgent: true, status: 'working' })
    noSideEffects(await responsePromise)
    expect(writes).toEqual([])
    expect(runtime.mobileTookFloor).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'no agent',
      status: { handle: 'term-1', isRunningAgent: false, status: null },
      reason: 'no-agent'
    },
    {
      label: 'permission prompt',
      status: { handle: 'term-1', isRunningAgent: true, status: 'permission' as const },
      reason: 'permission'
    }
  ])('does not submit a bound send when agent status is $label', async ({ status, reason }) => {
    const runtime = stubRuntime({
      getDriver: vi.fn().mockReturnValue({ kind: 'desktop' }),
      resolveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
      getTerminalAgentStatus: vi.fn().mockResolvedValue(status),
      sendTerminal: vi.fn(),
      mobileTookFloor: vi.fn()
    })
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
    const response = await dispatcher.dispatch(
      request('terminal.sendBound', {
        terminal: 'term-1',
        expectedRuntimeId: 'runtime-a',
        text: 'do not submit',
        requireAgentStatus: 'sendable'
      })
    )
    expect(response.ok).toBe(true)
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    expect(response.result).toEqual({
      send: {
        handle: 'term-1',
        accepted: false,
        bytesWritten: 0,
        refusedReason: reason
      }
    })
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
    expect(runtime.mobileTookFloor).not.toHaveBeenCalled()
  })

  it('checks the bound runtime again immediately before an Enter suffix write', async () => {
    let runtimeId = 'runtime-a'
    const writes: string[] = []
    const runtime = stubRuntime({
      getRuntimeId: () => runtimeId,
      getDriver: vi.fn().mockReturnValue({ kind: 'desktop' }),
      resolveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
      sendTerminal: vi.fn(async (_terminal, action, options) => {
        await options?.beforeWrite?.('pty-1')
        writes.push(action.text ?? '')
        runtimeId = 'runtime-b'
        await options?.beforeWrite?.('pty-1')
        writes.push('\r')
        return { handle: 'term-1', accepted: true, bytesWritten: action.text?.length ?? 0 }
      }),
      mobileTookFloor: vi.fn()
    })
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
    const response = await dispatcher.dispatch(
      request('terminal.sendBound', {
        terminal: 'term-1',
        expectedRuntimeId: 'runtime-a',
        text: 'draft',
        enter: true
      })
    )
    noSideEffects(response)
    expect(writes).toEqual(['draft'])
    expect(writes).not.toContain('\r')
    expect(runtime.mobileTookFloor).not.toHaveBeenCalled()
  })

  it('requires expectedRuntimeId and old hosts cannot silently fall back to terminal.send', async () => {
    const runtime = stubRuntime({ sendTerminal: vi.fn() })
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
    const missingBinding = await dispatcher.dispatch(
      request('terminal.sendBound', { terminal: 'term-1', text: 'x' })
    )
    expect(missingBinding).toMatchObject({ ok: false })

    const oldHost = new RpcDispatcher({
      runtime,
      methods: TERMINAL_METHODS.filter((method) => method.name !== 'terminal.sendBound')
    })
    const unknownBoundMethod = await oldHost.dispatch(
      request('terminal.sendBound', {
        terminal: 'term-1',
        expectedRuntimeId: 'runtime-a',
        text: 'x'
      })
    )
    expect(unknownBoundMethod).toMatchObject({ ok: false })
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
  })
})
