import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveCurrentWorktreeSelectorMock = vi.hoisted(() => vi.fn())
const printResultMock = vi.hoisted(() => vi.fn())

vi.mock('../format', () => ({ printResult: printResultMock }))
vi.mock('../selectors', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCurrentWorktreeSelector: resolveCurrentWorktreeSelectorMock
}))

import { BOARD_CARD_HANDLERS, formatBoardCards } from './board-cards'

const callMock = vi.fn()
const run = (command: string, flags: Record<string, string | boolean>) =>
  BOARD_CARD_HANDLERS[command]({
    flags: new Map(Object.entries(flags)),
    client: { call: callMock, isRemote: false } as never,
    cwd: '/repo/wt-1',
    json: true
  })

describe('board card commands', () => {
  beforeEach(() => {
    printResultMock.mockReset()
    resolveCurrentWorktreeSelectorMock.mockReset().mockResolvedValue('id:wt-1')
    callMock.mockReset().mockResolvedValue({ result: { message: 'ok' } })
  })

  it('board list reads the active worktree board', async () => {
    await run('board list', {})
    expect(callMock).toHaveBeenCalledWith('board.listCards', { worktree: 'id:wt-1' })
  })

  it('board restart sends the card (card: prefix stripped) and --force', async () => {
    await run('board restart', { card: 'card:Builder 1', force: true })
    expect(callMock).toHaveBeenCalledWith('board.cardAction', {
      worktree: 'id:wt-1',
      action: 'restart',
      card: 'Builder 1',
      force: true
    })
  })

  it('board close without --force does not send force', async () => {
    await run('board close', { card: 'c1' })
    expect(callMock.mock.calls[0][1]).toEqual({ worktree: 'id:wt-1', action: 'close', card: 'c1' })
  })

  it('board rename needs --title and board note needs --text', async () => {
    await expect(run('board rename', { card: 'c1' })).rejects.toThrow(/title/)
    await expect(run('board note', {})).rejects.toThrow(/text/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('board note may name an anchor card', async () => {
    await run('board note', { text: 'hi', card: 'c1' })
    expect(callMock.mock.calls[0][1]).toEqual({ worktree: 'id:wt-1', action: 'note', text: 'hi', card: 'c1' })
  })

  it('formats rows and strips terminal escapes from titles', () => {
    expect(
      formatBoardCards({
        worktreeId: 'wt-1',
        totalCount: 3,
        truncated: true,
        cards: [
          { id: 'c1', kind: 'console', title: 'Builder\u001b[2J 1', status: 'running', handle: 'term_a' },
          { id: 'n1', kind: 'note', title: '', preview: 'Remember', status: null, handle: null }
        ]
      })
    ).toBe('c1  console  running  term_a  Builder 1\nn1  note  -  -  Remember\n(showing 2 of 3 cards)')
  })
})
