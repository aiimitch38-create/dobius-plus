import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveCurrentWorktreeSelectorMock = vi.hoisted(() => vi.fn())
const printResultMock = vi.hoisted(() => vi.fn())

vi.mock('../format', () => ({ printResult: printResultMock }))
vi.mock('../selectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../selectors')>()),
  resolveCurrentWorktreeSelector: resolveCurrentWorktreeSelectorMock
}))

import { BOARD_HANDLERS, formatConsoles } from './board'

describe('board consoles text output', () => {
  it('shows the live handle, agent, role and title for a running console', () => {
    expect(
      formatConsoles([
        {
          tabId: 'tab-1',
          title: 'Builder 1',
          role: 'worker:lead-acme',
          agent: 'codex',
          handle: 'term_a',
          running: true
        }
      ])
    ).toBe('tab-1  term_a  codex  worker:lead-acme  Builder 1')
  })

  it('says "not running" when the card has no live terminal', () => {
    expect(
      formatConsoles([
        { tabId: 'tab-2', title: 'Idle', role: null, agent: 'claude', handle: null, running: false },
        { tabId: 'tab-3', title: 'Exited', role: null, agent: null, handle: 'term_x', running: false }
      ])
    ).toBe('tab-2  not running  claude  -  Idle\ntab-3  not running  -  -  Exited')
  })

  it('says "pane unclear" when several panes are live and none is focused', () => {
    expect(
      formatConsoles([
        {
          tabId: 'tab-5',
          title: 'Split',
          role: null,
          agent: 'codex',
          handle: null,
          running: true,
          paneUnclear: true
        }
      ])
    ).toBe('tab-5  pane unclear  codex  -  Split')
  })

  it('still prints rows from an older runtime that has no live fields', () => {
    expect(formatConsoles([{ tabId: 'tab-4', title: 'Old', role: null }])).toBe(
      'tab-4  unknown  -  -  Old'
    )
  })
})

describe('board send', () => {
  const callMock = vi.fn()

  beforeEach(() => {
    printResultMock.mockReset()
    resolveCurrentWorktreeSelectorMock.mockReset().mockResolvedValue('id:wt-1')
    callMock.mockReset().mockImplementation(async (method: string) => {
      if (method === 'board.resolveConsole') {
        return { result: { handle: 'term_live', title: 'Builder 1' } }
      }
      return { result: { send: { handle: 'term_live', accepted: true, bytesWritten: 5 } } }
    })
  })

  const send = (flags: [string, string | boolean][]) =>
    BOARD_HANDLERS['board send']({
      flags: new Map<string, string | boolean>(flags),
      client: { call: callMock, isRemote: false },
      cwd: '/repo',
      json: false
    } as never)

  it('looks the card up by title, then writes to its live handle', async () => {
    await send([
      ['card', 'Builder 1'],
      ['text', 'hello'],
      ['enter', true]
    ])
    expect(callMock.mock.calls).toEqual([
      ['board.resolveConsole', { worktree: 'id:wt-1', card: 'Builder 1' }],
      [
        'terminal.send',
        {
          terminal: 'term_live',
          text: 'hello',
          enter: true,
          client: { id: 'dobius-cli', type: 'desktop' }
        }
      ]
    ])
    const formatter = printResultMock.mock.calls[0][2] as (value: unknown) => string
    expect(formatter({ send: { handle: 'term_live', bytesWritten: 5 } })).toBe(
      'Sent 5 bytes to card "Builder 1" (term_live).'
    )
  })

  it('accepts the card:<title> spelling and an explicit --worktree', async () => {
    await send([
      ['card', 'card:Builder 1'],
      ['text', 'hello'],
      ['worktree', 'id:wt-9']
    ])
    expect(callMock).toHaveBeenCalledWith('board.resolveConsole', {
      worktree: 'id:wt-9',
      card: 'Builder 1'
    })
    expect(callMock).toHaveBeenCalledWith(
      'terminal.send',
      expect.objectContaining({ terminal: 'term_live', enter: false })
    )
  })

  it('passes a card id through unchanged (the runtime matches ids before titles)', async () => {
    await send([
      ['card', 'card-9f2c'],
      ['text', 'hello']
    ])
    expect(callMock).toHaveBeenCalledWith('board.resolveConsole', {
      worktree: 'id:wt-1',
      card: 'card-9f2c'
    })
  })

  it('writes to no terminal when the card cannot be resolved', async () => {
    callMock.mockRejectedValue(new Error('board_card_not_running: console card "Builder 1"'))
    await expect(
      send([
        ['card', 'Builder 1'],
        ['text', 'hello']
      ])
    ).rejects.toThrow('board_card_not_running')
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).not.toHaveBeenCalledWith('terminal.send', expect.anything())
    expect(callMock).not.toHaveBeenCalledWith('terminal.resolveActive', expect.anything())
  })

  it('requires --card and --text', async () => {
    await expect(send([['text', 'hello']])).rejects.toThrow('Missing required --card')
    await expect(send([['card', 'Builder 1']])).rejects.toThrow('Missing required --text')
    expect(callMock).not.toHaveBeenCalled()
  })

  it('fails when the terminal refuses the text', async () => {
    callMock.mockImplementation(async (method: string) =>
      method === 'board.resolveConsole'
        ? { result: { handle: 'term_live', title: 'Builder 1' } }
        : { result: { send: { handle: 'term_live', accepted: false, bytesWritten: 0 } } }
    )
    await expect(
      send([
        ['card', 'Builder 1'],
        ['text', 'hello']
      ])
    ).rejects.toThrow('did not accept the text')
  })
})
