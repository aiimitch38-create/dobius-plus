import { describe, expect, it } from 'vitest'
import type { BoardSlice } from '@/store/slices/board'
import {
  BOARD_CARD_TITLE_ENV_MAX_CHARS,
  boardConsoleIdentityEnv
} from './board-console-identity-env'

type Boards = Pick<BoardSlice, 'boardsByWorktree'>

function stateWith(cards: unknown[]): Boards {
  return { boardsByWorktree: { 'wt-1': { cards } } } as unknown as Boards
}

describe('boardConsoleIdentityEnv', () => {
  it('names the console card that owns the tab', () => {
    const state = stateWith([
      { id: 'card-a', kind: 'console', tabId: 'tab-a', title: 'Plan 2' },
      { id: 'card-b', kind: 'console', tabId: 'tab-b', title: 'Build 1' }
    ])
    expect(boardConsoleIdentityEnv(state, 'wt-1', 'tab-b')).toEqual({
      DOBIUS_BOARD_ID: 'wt-1',
      DOBIUS_BOARD_CARD_ID: 'card-b',
      DOBIUS_BOARD_CARD_TITLE: 'Build 1'
    })
  })

  it('returns nothing for a tab with no console card', () => {
    const state = stateWith([
      { id: 'card-a', kind: 'console', tabId: 'tab-a', title: 'Plan 2' },
      { id: 'note-1', kind: 'note', tabId: 'tab-z', title: 'Not a console' }
    ])
    expect(boardConsoleIdentityEnv(state, 'wt-1', 'tab-z')).toEqual({})
    expect(boardConsoleIdentityEnv(state, 'wt-1', 'tab-missing')).toEqual({})
    expect(boardConsoleIdentityEnv(state, 'wt-other', 'tab-a')).toEqual({})
  })

  it('keeps the title on one line and caps its length', () => {
    const state = stateWith([
      { id: 'card-a', kind: 'console', tabId: 'tab-a', title: ` Plan\n2\t${'x'.repeat(400)}` }
    ])
    const title = boardConsoleIdentityEnv(state, 'wt-1', 'tab-a').DOBIUS_BOARD_CARD_TITLE
    expect(title.startsWith('Plan 2 x')).toBe(true)
    expect(title).toHaveLength(BOARD_CARD_TITLE_ENV_MAX_CHARS)
  })

  it('omits the title when the card has none', () => {
    const state = stateWith([{ id: 'card-a', kind: 'console', tabId: 'tab-a', title: '  ' }])
    expect(boardConsoleIdentityEnv(state, 'wt-1', 'tab-a')).toEqual({
      DOBIUS_BOARD_ID: 'wt-1',
      DOBIUS_BOARD_CARD_ID: 'card-a'
    })
  })
})
