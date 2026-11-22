import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()
const getTerminalHandleMock = vi.hoisted(() => vi.fn())
const resolveTerminalAddressMock = vi.hoisted(() => vi.fn())
const originalTerminalHandle = process.env.DOBIUS_TERMINAL_HANDLE
function lifecycleGroupRecipientError(type: 'worker_done' | 'heartbeat'): string {
  return `${type} messages must be sent to a concrete coordinator terminal handle, not a group address.`
}

// Why: isolate the handler's flag-to-param mapping; printResult only writes output.
vi.mock('../format', () => ({ printResult: vi.fn() }))
vi.mock('../selectors', () => ({
  getTerminalHandle: getTerminalHandleMock,
  resolveTerminalAddress: resolveTerminalAddressMock
}))

import { ORCHESTRATION_HANDLERS } from './orchestration'

// Why: by default an address passes through unchanged, as a plain handle does.
beforeEach(() => {
  resolveTerminalAddressMock.mockReset().mockImplementation(async (address: string) => address)
})

afterEach(() => {
  getTerminalHandleMock.mockReset()
  if (originalTerminalHandle === undefined) {
    delete process.env.DOBIUS_TERMINAL_HANDLE
  } else {
    process.env.DOBIUS_TERMINAL_HANDLE = originalTerminalHandle
  }
})

describe('orchestration reset CLI handler', () => {
  beforeEach(() => {
    callMock.mockReset().mockResolvedValue({ result: { reset: 'all' } })
  })

  const invoke = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration reset']({
      flags,
      client: { call: callMock },
      json: true
    } as never)

  it('sends all: true for a bare `reset` (no scope flag)', async () => {
    await invoke(new Map())
    expect(callMock).toHaveBeenCalledWith('orchestration.reset', {
      all: true,
      tasks: undefined,
      messages: undefined
    })
  })

  it('sends only the tasks scope for --tasks', async () => {
    await invoke(new Map([['tasks', true]]))
    expect(callMock).toHaveBeenCalledWith('orchestration.reset', {
      all: undefined,
      tasks: true,
      messages: undefined
    })
  })

  it('sends only the all scope for --all (no implicit extra scopes)', async () => {
    await invoke(new Map([['all', true]]))
    expect(callMock).toHaveBeenCalledWith('orchestration.reset', {
      all: true,
      tasks: undefined,
      messages: undefined
    })
  })
})

describe('orchestration send structured payload flags', () => {
  beforeEach(() => {
    callMock.mockReset().mockResolvedValue({ result: { message: { id: 'msg_1' } } })
    getTerminalHandleMock.mockReset()
    delete process.env.DOBIUS_TERMINAL_HANDLE
  })

  const invokeSend = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration send']({
      flags,
      client: { call: callMock },
      cwd: '/tmp/repo',
      json: true
    } as never)

  it('serializes common worker payload fields as JSON', async () => {
    await invokeSend(
      new Map<string, string | boolean>([
        ['from', 'term_worker'],
        ['to', 'term_coord'],
        ['subject', 'done'],
        ['type', 'worker_done'],
        ['task-id', 'task_1'],
        ['dispatch-id', 'ctx_1'],
        ['files-modified', 'src/a.ts, src/b.ts'],
        ['report-path', 'reports/done.md']
      ])
    )

    expect(callMock).toHaveBeenCalledWith('orchestration.send', {
      from: 'term_worker',
      to: 'term_coord',
      subject: 'done',
      body: undefined,
      type: 'worker_done',
      priority: undefined,
      threadId: undefined,
      payload: JSON.stringify({
        taskId: 'task_1',
        dispatchId: 'ctx_1',
        filesModified: ['src/a.ts', 'src/b.ts'],
        reportPath: 'reports/done.md'
      }),
      devMode: false
    })
  })

  it('rejects mixing raw payload with structured payload flags', async () => {
    await expect(
      invokeSend(
        new Map<string, string | boolean>([
          ['from', 'term_worker'],
          ['to', 'term_coord'],
          ['subject', 'done'],
          ['payload', '{"taskId":"task_1"}'],
          ['task-id', 'task_1']
        ])
      )
    ).rejects.toThrow(/structured payload/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('rejects worker_done group sends before resolving a sender handle', async () => {
    getTerminalHandleMock.mockRejectedValue(new Error('sender resolution should not run'))

    await expect(
      invokeSend(
        new Map<string, string | boolean>([
          ['to', '@all'],
          ['subject', 'done'],
          ['type', 'worker_done']
        ])
      )
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: lifecycleGroupRecipientError('worker_done')
    })

    expect(getTerminalHandleMock).not.toHaveBeenCalled()
    expect(callMock).not.toHaveBeenCalled()
  })

  it('rejects heartbeat group sends before resolving a sender handle', async () => {
    getTerminalHandleMock.mockRejectedValue(new Error('sender resolution should not run'))

    await expect(
      invokeSend(
        new Map<string, string | boolean>([
          ['to', '@idle'],
          ['subject', 'alive'],
          ['type', 'heartbeat']
        ])
      )
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: lifecycleGroupRecipientError('heartbeat')
    })

    expect(getTerminalHandleMock).not.toHaveBeenCalled()
    expect(callMock).not.toHaveBeenCalled()
  })

  it('continues to allow worker_done to a concrete terminal handle', async () => {
    await invokeSend(
      new Map<string, string | boolean>([
        ['from', 'term_worker'],
        ['to', 'term_coord'],
        ['subject', 'done'],
        ['type', 'worker_done']
      ])
    )

    expect(callMock).toHaveBeenCalledWith('orchestration.send', {
      from: 'term_worker',
      to: 'term_coord',
      subject: 'done',
      body: undefined,
      type: 'worker_done',
      priority: undefined,
      threadId: undefined,
      payload: undefined,
      devMode: false
    })
  })
})

describe('orchestration timeout flag validation', () => {
  const invalidTimeoutValues: [string, string | boolean][] = [
    ['missing', true],
    ['empty', ''],
    ['non-numeric', 'not-a-number'],
    ['zero', '0'],
    ['negative', '-1']
  ]

  beforeEach(() => {
    callMock.mockReset()
    delete process.env.DOBIUS_TERMINAL_HANDLE
  })

  const invokeCheck = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration check']({
      flags,
      client: { call: callMock },
      cwd: '/tmp/repo',
      json: true
    } as never)

  const invokeAsk = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration ask']({
      flags,
      client: { call: callMock },
      cwd: '/tmp/repo',
      json: true
    } as never)

  it.each(invalidTimeoutValues)('rejects invalid check --timeout-ms: %s', async (_label, value) => {
    const flags = new Map<string, string | boolean>([
      ['wait', true],
      ['timeout-ms', value]
    ])

    await expect(invokeCheck(flags)).rejects.toThrow(/--timeout-ms/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('passes a parsed check timeout into the RPC payload', async () => {
    process.env.DOBIUS_TERMINAL_HANDLE = 'term_worker'
    callMock.mockResolvedValue({ result: { messages: [], count: 0 } })

    await invokeCheck(
      new Map<string, string | boolean>([
        ['wait', true],
        ['timeout-ms', '250']
      ])
    )

    expect(callMock).toHaveBeenCalledWith('orchestration.check', {
      terminal: 'term_worker',
      unread: undefined,
      all: undefined,
      types: undefined,
      inject: undefined,
      wait: true,
      timeoutMs: 250
    })
  })

  it.each(invalidTimeoutValues)('rejects invalid ask --timeout-ms: %s', async (_label, value) => {
    const flags = new Map<string, string | boolean>([
      ['to', 'term_coord'],
      ['question', 'Proceed?'],
      ['timeout-ms', value]
    ])

    await expect(invokeAsk(flags)).rejects.toThrow(/--timeout-ms/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('uses the parsed ask timeout for both runtime wait and client timeout', async () => {
    process.env.DOBIUS_TERMINAL_HANDLE = 'term_worker'
    callMock.mockResolvedValue({
      result: {
        answer: 'yes',
        messageId: 'msg_1',
        threadId: 'thread_1',
        timedOut: false
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await invokeAsk(
      new Map<string, string | boolean>([
        ['to', 'term_coord'],
        ['question', 'Proceed?'],
        ['timeout-ms', '123']
      ])
    )

    expect(callMock).toHaveBeenCalledWith(
      'orchestration.ask',
      {
        to: 'term_coord',
        question: 'Proceed?',
        options: undefined,
        timeoutMs: 123,
        from: 'term_worker'
      },
      { timeoutMs: 5_123 }
    )
  })
})

describe('orchestration card:<title> recipients', () => {
  beforeEach(() => {
    callMock.mockReset().mockResolvedValue({ result: { message: { id: 'msg_1' } } })
    process.env.DOBIUS_TERMINAL_HANDLE = 'term_sender'
  })

  const run = (command: 'orchestration send' | 'orchestration dispatch', flags: [string, string][]) =>
    ORCHESTRATION_HANDLERS[command]({
      flags: new Map<string, string | boolean>(flags),
      client: { call: callMock },
      cwd: '/repo',
      json: true
    } as never)

  it('send resolves card:<title> to the live handle before sending', async () => {
    resolveTerminalAddressMock.mockResolvedValue('term_live')
    await run('orchestration send', [
      ['to', 'card:Builder 1'],
      ['subject', 'hi']
    ])
    expect(resolveTerminalAddressMock).toHaveBeenCalledWith(
      'card:Builder 1',
      expect.any(Map),
      '/repo',
      expect.anything()
    )
    expect(callMock).toHaveBeenCalledWith(
      'orchestration.send',
      expect.objectContaining({ to: 'term_live', from: 'term_sender' })
    )
  })

  it.each(['orchestration send', 'orchestration dispatch'] as const)(
    '%s uses --worktree for the card lookup only, not to pick the sender',
    async (command) => {
      delete process.env.DOBIUS_TERMINAL_HANDLE
      callMock.mockResolvedValue({
        result: { message: { id: 'msg_1' }, dispatch: { id: 'd1', task_id: 't1', status: 'dispatched' } }
      })
      getTerminalHandleMock.mockResolvedValue('term_sender')
      resolveTerminalAddressMock.mockResolvedValue('term_live')
      await run(command, [
        ['to', 'card:card-9f2c'],
        ['subject', 'hi'],
        ['task', 't1'],
        ['worktree', 'id:wt-9']
      ])
      const addressFlags = resolveTerminalAddressMock.mock.calls[0][1] as Map<string, unknown>
      expect(addressFlags.get('worktree')).toBe('id:wt-9')
      const senderFlagsSeen = getTerminalHandleMock.mock.calls[0][0] as Map<string, unknown>
      expect(senderFlagsSeen.has('worktree')).toBe(false)
    }
  )

  it('dispatch resolves card:<title> to the live handle before dispatching', async () => {
    callMock.mockResolvedValue({
      result: { dispatch: { id: 'd1', task_id: 't1', status: 'dispatched' } }
    })
    resolveTerminalAddressMock.mockResolvedValue('term_live')
    await run('orchestration dispatch', [
      ['to', 'card:Builder 1'],
      ['task', 't1']
    ])
    expect(callMock).toHaveBeenCalledWith(
      'orchestration.dispatch',
      expect.objectContaining({ to: 'term_live', task: 't1' })
    )
  })

  it.each(['orchestration send', 'orchestration dispatch'] as const)(
    '%s sends nothing when the card cannot be resolved',
    async (command) => {
      resolveTerminalAddressMock.mockRejectedValue(new Error('board_card_not_found: no console'))
      await expect(
        run(command, [
          ['to', 'card:Nope'],
          ['subject', 'hi'],
          ['task', 't1']
        ])
      ).rejects.toThrow('board_card_not_found')
      expect(callMock).not.toHaveBeenCalled()
    }
  )
})

describe('orchestration tab:<tabId> and card: addresses on every handle flag', () => {
  beforeEach(() => {
    callMock.mockReset().mockResolvedValue({
      result: { messages: [], count: 0, answer: null, messageId: null, threadId: 't', timedOut: true }
    })
    resolveTerminalAddressMock.mockImplementation(async (address: string) =>
      address.startsWith('tab:') ? 'term_from_tab' : address
    )
  })

  const run = (command: string, flags: [string, string | boolean][]) =>
    ORCHESTRATION_HANDLERS[command]({
      flags: new Map<string, string | boolean>(flags),
      client: { call: callMock },
      cwd: '/repo',
      json: true
    } as never)

  it('check --terminal tab:<tabId> reads that tab\'s inbox', async () => {
    await run('orchestration check', [['terminal', 'tab:t1']])
    expect(callMock).toHaveBeenCalledWith(
      'orchestration.check',
      expect.objectContaining({ terminal: 'term_from_tab' })
    )
  })

  it('inbox --terminal tab:<tabId> is resolved', async () => {
    await run('orchestration inbox', [['terminal', 'tab:t1']])
    expect(callMock).toHaveBeenCalledWith(
      'orchestration.inbox',
      expect.objectContaining({ terminal: 'term_from_tab' })
    )
  })

  it('send --from tab:<tabId> is resolved', async () => {
    await run('orchestration send', [
      ['to', 'term_x'],
      ['from', 'tab:t1'],
      ['subject', 'hi']
    ])
    expect(callMock).toHaveBeenCalledWith(
      'orchestration.send',
      expect.objectContaining({ from: 'term_from_tab', to: 'term_x' })
    )
  })

  it('ask --to tab:<tabId> is resolved', async () => {
    await run('orchestration ask', [
      ['to', 'tab:t1'],
      ['from', 'term_me'],
      ['question', 'ok?'],
      ['timeout-ms', '1000']
    ])
    expect(callMock).toHaveBeenCalledWith(
      'orchestration.ask',
      expect.objectContaining({ to: 'term_from_tab' }),
      expect.anything()
    )
  })
})

describe('orchestration send --to board:<orchestratorCardId>', () => {
  beforeEach(() => {
    callMock.mockReset().mockResolvedValue({ result: { messages: [{ id: 'm1' }], recipients: 1 } })
    delete process.env.DOBIUS_TERMINAL_HANDLE
    getTerminalHandleMock.mockRejectedValue(new Error('no_active_terminal'))
  })

  const run = (flags: [string, string][]) =>
    ORCHESTRATION_HANDLERS['orchestration send']({
      flags: new Map<string, string | boolean>(flags),
      client: { call: callMock },
      cwd: '/repo',
      json: true
    } as never)

  it('hands board: to the runtime relay as-is, with no sender terminal lookup', async () => {
    await run([
      ['to', 'board:orch-1'],
      ['subject', 'hi'],
      ['body', 'run the tests']
    ])
    expect(resolveTerminalAddressMock).not.toHaveBeenCalled()
    expect(getTerminalHandleMock).not.toHaveBeenCalled()
    expect(callMock).toHaveBeenCalledWith(
      'orchestration.send',
      expect.objectContaining({ to: 'board:orch-1', from: undefined, body: 'run the tests' })
    )
  })

  it.each(['worker_done', 'heartbeat'] as const)('rejects %s to a board orchestrator', async (type) => {
    await expect(
      run([
        ['to', 'board:orch-1'],
        ['subject', 'x'],
        ['type', type]
      ])
    ).rejects.toThrow('concrete coordinator terminal handle')
    expect(callMock).not.toHaveBeenCalled()
  })
})
