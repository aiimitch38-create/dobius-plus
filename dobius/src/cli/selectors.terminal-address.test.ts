import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from './runtime-client'
import { getTerminalHandle, resolveTerminalAddress } from './selectors'

const callMock = vi.fn()
const client = { call: callMock, isRemote: false } as unknown as RuntimeClient
const flagsOf = (entries: [string, string | boolean][] = []) =>
  new Map<string, string | boolean>(entries)

beforeEach(() => {
  callMock.mockReset().mockImplementation(async (method: string) => {
    if (method === 'worktree.list') {
      return { result: { worktrees: [{ id: 'wt-1', path: '/repo' }] } }
    }
    if (method === 'board.resolveConsole') {
      return { result: { handle: 'term_live' } }
    }
    if (method === 'terminal.resolveTab') {
      return { result: { handle: 'term_in_tab' } }
    }
    if (method === 'terminal.resolveActive') {
      return { result: { handle: 'term_active' } }
    }
    throw new Error(`unexpected ${method}`)
  })
})

describe('resolveTerminalAddress', () => {
  it('returns a plain handle untouched, without asking the runtime', async () => {
    expect(await resolveTerminalAddress('term_abc', flagsOf(), '/repo', client)).toBe('term_abc')
    expect(callMock).not.toHaveBeenCalled()
  })

  it('resolves card:<title> on the current worktree', async () => {
    expect(await resolveTerminalAddress('card:Builder 1', flagsOf(), '/repo/src', client)).toBe(
      'term_live'
    )
    expect(callMock).toHaveBeenCalledWith('board.resolveConsole', {
      worktree: 'id:wt-1',
      card: 'Builder 1'
    })
  })

  it('looks the card up on the Board named by --worktree', async () => {
    await resolveTerminalAddress(
      'card:card-9f2c',
      flagsOf([['worktree', 'id:wt-9']]),
      '/repo/src',
      client
    )
    expect(callMock).toHaveBeenCalledWith('board.resolveConsole', {
      worktree: 'id:wt-9',
      card: 'card-9f2c'
    })
  })

  it('rejects card: with no title', async () => {
    await expect(resolveTerminalAddress('card:  ', flagsOf(), '/repo', client)).rejects.toThrow(
      'Missing card name'
    )
    expect(callMock).not.toHaveBeenCalled()
  })

  it('passes the runtime error through and never asks for the active terminal', async () => {
    callMock.mockImplementation(async (method: string) => {
      if (method === 'worktree.list') {
        return { result: { worktrees: [{ id: 'wt-1', path: '/repo' }] } }
      }
      throw new Error('board_card_not_found: no console card named "Nope"')
    })
    await expect(resolveTerminalAddress('card:Nope', flagsOf(), '/repo', client)).rejects.toThrow(
      'board_card_not_found'
    )
    expect(callMock).not.toHaveBeenCalledWith('terminal.resolveActive', expect.anything())
  })
})

describe('resolveTerminalAddress tab:', () => {
  it('resolves tab:<tabId> to that tab\'s running terminal', async () => {
    expect(await resolveTerminalAddress('tab:term-tab-7', flagsOf(), '/repo', client)).toBe(
      'term_in_tab'
    )
    expect(callMock).toHaveBeenCalledWith('terminal.resolveTab', { tabId: 'term-tab-7' })
  })

  it('rejects tab: with no id', async () => {
    await expect(resolveTerminalAddress('tab: ', flagsOf(), '/repo', client)).rejects.toThrow(
      'Missing tab id'
    )
    expect(callMock).not.toHaveBeenCalled()
  })

  it('passes an unknown-tab error through and never asks for the active terminal', async () => {
    callMock.mockImplementation(async () => {
      throw new Error('terminal_tab_not_found: no terminal tab "gone" is open')
    })
    await expect(resolveTerminalAddress('tab:gone', flagsOf(), '/repo', client)).rejects.toThrow(
      'terminal_tab_not_found'
    )
    expect(callMock).not.toHaveBeenCalledWith('terminal.resolveActive', expect.anything())
  })

  it('works for --terminal tab:<tabId>', async () => {
    expect(await getTerminalHandle(flagsOf([['terminal', 'tab:t1']]), '/repo', client)).toBe(
      'term_in_tab'
    )
  })
})

describe('getTerminalHandle', () => {
  it('uses an explicit handle as given', async () => {
    expect(await getTerminalHandle(flagsOf([['terminal', 'term_abc']]), '/repo', client)).toBe(
      'term_abc'
    )
  })

  it('resolves --terminal card:<title>', async () => {
    expect(await getTerminalHandle(flagsOf([['terminal', 'card:Builder 1']]), '/repo', client)).toBe(
      'term_live'
    )
  })

  it('still uses the active terminal when --terminal is left out', async () => {
    expect(await getTerminalHandle(flagsOf(), '/repo', client)).toBe('term_active')
  })

  it.each([
    ['an empty string', ''],
    ['only spaces', '   '],
    ['no value (parsed as a bare flag)', true]
  ] as const)('errors when --terminal is %s instead of using the active terminal', async (_n, v) => {
    await expect(getTerminalHandle(flagsOf([['terminal', v]]), '/repo', client)).rejects.toThrow(
      '--terminal was given without a value'
    )
    expect(callMock).not.toHaveBeenCalled()
  })
})
