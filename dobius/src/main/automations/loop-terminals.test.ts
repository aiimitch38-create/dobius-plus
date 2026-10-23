import { describe, expect, it, vi } from 'vitest'
import { createRuntimeLoopTerminals, sanitizeLoopPasteText } from './loop-terminals'

const PASTE_START = '\u001b[200~'
const PASTE_END = '\u001b[201~'

function fakeRuntime(opts: { agent: () => boolean; permission?: boolean }) {
  const writes: { text?: string; enter?: boolean }[] = []
  const runtime = {
    listTerminals: async () => ({ terminals: [{ handle: 'h1', tabId: 'tab-a' }] }) as never,
    readTerminal: vi.fn(),
    getTerminalAgentStatus: async () => ({
      handle: 'h1',
      isRunningAgent: opts.agent(),
      status: opts.permission ? ('permission' as const) : ('idle' as const)
    }),
    sendTerminal: async (
      _handle: string,
      action: { text?: string; enter?: boolean },
      options?: { beforeWrite?: (ptyId: string) => void | Promise<void> }
    ) => {
      await options?.beforeWrite?.('pty-1')
      writes.push(action)
      return {}
    }
  }
  return { runtime, writes }
}

const noWait = async (): Promise<void> => undefined

describe('loop delivery', () => {
  it('refuses when no agent is running: nothing reaches the shell', async () => {
    const { runtime, writes } = fakeRuntime({ agent: () => false })
    const terminals = createRuntimeLoopTerminals(() => runtime, noWait)
    expect(await terminals.deliver('tab-a', 'ls')).toBe('no-agent')
    expect(writes).toEqual([])
  })

  it('refuses while the agent waits for permission', async () => {
    const { runtime, writes } = fakeRuntime({ agent: () => true, permission: true })
    expect(await createRuntimeLoopTerminals(() => runtime, noWait).deliver('tab-a', 'x')).toBe(
      'permission'
    )
    expect(writes).toEqual([])
  })

  it('sends a sanitized bracketed paste, then a separate Enter', async () => {
    const { runtime, writes } = fakeRuntime({ agent: () => true })
    const status = await createRuntimeLoopTerminals(() => runtime, noWait).deliver(
      'tab-a',
      `fix it\r\nnow\u001b[201~; rm -rf ~\u0003`
    )
    expect(status).toBe('sent')
    expect(writes).toHaveLength(2)
    const text = writes[0].text!
    expect(text.startsWith(PASTE_START) && text.endsWith(PASTE_END)).toBe(true)
    const body = text.slice(PASTE_START.length, -PASTE_END.length)
    expect(['\r', '\u001b', '\u0003'].some((c) => body.includes(c))).toBe(false)
    expect(writes[0].enter).toBeUndefined()
    expect(writes[1]).toEqual({ enter: true })
  })

  it('if the agent exits between paste and Enter, Enter is never written', async () => {
    let checks = 0
    // Alive for the pre-check and the paste's beforeWrite; dead at submit.
    const { runtime, writes } = fakeRuntime({ agent: () => ++checks <= 2 })
    expect(await createRuntimeLoopTerminals(() => runtime, noWait).deliver('tab-a', 'x')).toBe(
      'no-agent'
    )
    expect(writes).toHaveLength(1)
    expect(writes.some((w) => w.enter)).toBe(false)
  })

  it('reports a closed console without touching any terminal', async () => {
    const { runtime, writes } = fakeRuntime({ agent: () => true })
    expect(await createRuntimeLoopTerminals(() => runtime, noWait).deliver('tab-x', 'x')).toBe(
      'no-terminal'
    )
    expect(writes).toEqual([])
  })
})

describe('sanitizeLoopPasteText', () => {
  it('keeps tabs and newlines, drops every other control character', () => {
    expect(sanitizeLoopPasteText('a\tb\nc\r\u001b[201~\u007f')).toBe('a\tb\nc[201~')
  })
})

describe('terminal listing', () => {
  it('lists terminals once per tick, not once per call', async () => {
    const { runtime } = fakeRuntime({ agent: () => true })
    const list = vi.spyOn(runtime, 'listTerminals')
    const terminals = createRuntimeLoopTerminals(() => runtime, noWait)
    await terminals.deliver('tab-a', 'one')
    await terminals.deliver('tab-a', 'two')
    await terminals.deliver('tab-x', 'three')
    expect(list).toHaveBeenCalledTimes(1)
  })
})
