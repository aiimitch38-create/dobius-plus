import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from './dispatcher'
import type { DobiusRuntimeService } from '../dobius-runtime'
import { TERMINAL_METHODS } from './methods/terminal'

function runtimeWithRead(): {
  runtime: DobiusRuntimeService
  readTerminal: ReturnType<typeof vi.fn>
} {
  const readTerminal = vi.fn(async (_handle: string, opts: { transcript?: boolean }) => ({
    handle: 't1',
    status: 'running',
    tail: [],
    truncated: false,
    nextCursor: '0',
    screen: { available: false, source: 'headless-emulator', reason: 'stub' },
    ...(opts.transcript
      ? { transcript: { available: true, source: 'transcript', messages: [] } }
      : {})
  }))
  return {
    runtime: {
      getRuntimeId: () => 'test-runtime',
      readTerminal
    } as unknown as DobiusRuntimeService,
    readTerminal
  }
}

const request = {
  id: 'req-1',
  authToken: 'tok',
  method: 'terminal.read',
  params: { terminal: 't1', screen: true, transcript: true }
}

describe('terminal.read transcript scope', () => {
  it('denies the transcript to the limited agent key but keeps the screen', async () => {
    const { runtime, readTerminal } = runtimeWithRead()
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
    const response = await dispatcher.dispatch(request, { agentKey: true })
    expect(response.ok).toBe(true)
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    expect(readTerminal).toHaveBeenCalledWith('t1', {
      screen: true,
      cursor: undefined,
      limit: undefined
    })
    expect(response.result).toMatchObject({
      terminal: {
        screen: { source: 'headless-emulator' },
        transcript: { available: false, source: 'transcript', reason: 'not-permitted' }
      }
    })
  })

  it('reads the transcript with the full key', async () => {
    const { runtime, readTerminal } = runtimeWithRead()
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
    const response = await dispatcher.dispatch(request)
    expect(response.ok).toBe(true)
    expect(readTerminal).toHaveBeenCalledWith('t1', expect.objectContaining({ transcript: true }))
    if (response.ok) {
      expect(response.result).toMatchObject({ terminal: { transcript: { available: true } } })
    }
  })
})
