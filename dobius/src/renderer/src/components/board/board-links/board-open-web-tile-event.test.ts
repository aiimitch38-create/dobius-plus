import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeBoardOpenWebTileEvent } from '../../../../../shared/runtime-client-events'

const WT = 'wt-1'
type Card = Record<string, unknown> & { kind: string }
const state = {
  boardsByWorktree: {} as Record<string, { cards: Card[]; viewport: { x: number; y: number; zoom: number } }>,
  addCard: vi.fn((worktreeId: string, card: Card) => {
    const board = state.boardsByWorktree[worktreeId]
    const id = `card-${board.cards.length + 1}`
    board.cards.push({ ...card, id })
    return id
  })
}
vi.mock('@/store', () => ({
  useAppStore: { getState: () => state, subscribe: vi.fn(() => () => undefined) }
}))
Object.assign(globalThis, { window: { innerWidth: 1440, innerHeight: 900 } })

const { handleBoardOpenWebTileEvent, resetBoardOpenWebTileHandlerForTest, BOARD_WEB_TILE_SIZE } =
  await import('./board-open-web-tile-event')

function event(over: Partial<RuntimeBoardOpenWebTileEvent> = {}): RuntimeBoardOpenWebTileEvent {
  return {
    type: 'boardOpenWebTile',
    requestId: 'req-1',
    worktreeId: WT,
    url: 'https://example.com/docs',
    agentId: 'adam',
    ...over
  }
}

describe('handleBoardOpenWebTileEvent', () => {
  beforeEach(() => {
    resetBoardOpenWebTileHandlerForTest()
    state.addCard.mockClear()
    state.boardsByWorktree = { [WT]: { cards: [], viewport: { x: 0, y: 0, zoom: 1 } } }
  })

  it('adds one private web tile card and returns its id', () => {
    expect(handleBoardOpenWebTileEvent(event({ title: 'Docs' }))).toEqual({
      outcome: 'opened',
      cardId: 'card-1'
    })
    expect(state.addCard).toHaveBeenCalledTimes(1)
    const [card] = state.boardsByWorktree[WT].cards
    expect(card).toMatchObject({ kind: 'web', title: 'Docs', url: 'https://example.com/docs', ...BOARD_WEB_TILE_SIZE })
    expect(card).not.toHaveProperty('session')
  })

  it('defaults the title to the hostname', () => {
    handleBoardOpenWebTileEvent(event())
    expect(state.boardsByWorktree[WT].cards[0].title).toBe('example.com')
  })

  it('handles each requestId once and re-answers with the same card id', () => {
    expect(handleBoardOpenWebTileEvent(event())).toEqual({ outcome: 'opened', cardId: 'card-1' })
    expect(handleBoardOpenWebTileEvent(event())).toEqual({ outcome: 'duplicate', cardId: 'card-1' })
    expect(handleBoardOpenWebTileEvent(event({ requestId: 'req-2' }))).toEqual({
      outcome: 'opened',
      cardId: 'card-2'
    })
    expect(state.addCard).toHaveBeenCalledTimes(2)
  })

  it('refuses a non-http(s) url without adding a card', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(handleBoardOpenWebTileEvent(event({ url: 'javascript:alert(1)' }))).toEqual({
      outcome: 'refused',
      cardId: null
    })
    expect(state.addCard).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
