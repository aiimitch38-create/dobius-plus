import { create } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goalCables } from '@/components/board/board-links/board-link-geometry'
import { boardInsertCard } from '@/components/board/board-route/board-insert-cards'
import type { AppState } from '../types'
import {
  DEFAULT_GOAL_REMINDERS,
  createBoardSlice,
  getBoard,
  resetBoardPersistenceForTest,
  sanitizeBoardsByWorktree,
  type BoardCardOf
} from './board'

const mockApi = { ui: { set: vi.fn(() => Promise.resolve()) } }
// @ts-expect-error -- test shim
globalThis.window = { api: mockApi }

const rect = { x: 0, y: 0, w: 300, h: 400, z: 1 }
const raw = (over: Record<string, unknown> = {}) => ({
  ...rect,
  id: 'g',
  title: 'Goal',
  kind: 'goal',
  goal: 'Ship it',
  criteria: [
    { id: 'c1', text: 'Tests pass', done: true, evidence: 'CI run 42' },
    { id: 'c2', text: 'Docs', done: 'yes' },
    { id: 3, text: 'bad id' }
  ],
  dont: [{ id: 'd1', text: 'No refactors' }, { text: 'no id' }],
  reminders: { afterCompaction: false, everyTurns: 3, onNewTask: true },
  driftCheck: true,
  wiredCardIds: ['a', 'grp'],
  ...over
})
const goalOf = (value: unknown): BoardCardOf<'goal'> | undefined =>
  sanitizeBoardsByWorktree({ wt: { cards: [value] } }).wt.cards[0] as
    | BoardCardOf<'goal'>
    | undefined

describe('goal card model', () => {
  it('keeps a valid goal card and repairs malformed items', () => {
    expect(goalOf(raw())).toEqual({
      ...rect,
      id: 'g',
      title: 'Goal',
      kind: 'goal',
      goal: 'Ship it',
      criteria: [
        { id: 'c1', text: 'Tests pass', done: true, evidence: 'CI run 42' },
        { id: 'c2', text: 'Docs', done: false }
      ],
      dont: [{ id: 'd1', text: 'No refactors' }],
      reminders: { afterCompaction: false, everyTurns: 3, onNewTask: true },
      driftCheck: true,
      wiredCardIds: ['a', 'grp']
    })
  })

  it('fills missing reminder settings from the defaults and clamps the turn cadence', () => {
    const card = goalOf(raw({ reminders: { everyTurns: 9999 }, driftCheck: undefined }))
    expect(card?.reminders).toEqual({ ...DEFAULT_GOAL_REMINDERS, everyTurns: 100 })
    expect(card?.driftCheck).toBe(false)
    expect(goalOf(raw({ reminders: 'nope' }))?.reminders).toEqual(DEFAULT_GOAL_REMINDERS)
  })

  it('drops a goal card without goal text or wiring list', () => {
    expect(goalOf(raw({ goal: 7 }))).toBeUndefined()
    expect(goalOf(raw({ wiredCardIds: 'a' }))).toBeUndefined()
  })

  it('inserts with defaults: drift check off, every 5 turns, nothing wired', () => {
    const card = boardInsertCard('goal', { x: 0, y: 0 })
    expect(card).toMatchObject({
      kind: 'goal',
      goal: '',
      criteria: [],
      dont: [],
      reminders: DEFAULT_GOAL_REMINDERS,
      driftCheck: false,
      wiredCardIds: []
    })
  })
})

describe('goal card on the board', () => {
  const WT = 'wt-1'
  const store = create<AppState>()((...a) => ({ ...createBoardSlice(...a) }) as AppState)
  const board = () => getBoard(store.getState(), WT)

  beforeEach(() => {
    vi.useFakeTimers()
    resetBoardPersistenceForTest()
    store.getState().hydrateBoards({})
  })
  afterEach(() => vi.useRealTimers())

  it('unwires a deleted console and survives a save/load round trip', () => {
    const s = store.getState()
    const consoleId = s.addCard(WT, {
      ...rect,
      kind: 'console',
      title: 'Claude 1',
      tabId: 'tab-1',
      agentKind: 'claude'
    })
    const goalId = s.addCard(WT, {
      ...(boardInsertCard('goal', { x: 0, y: 0 }) as Omit<BoardCardOf<'goal'>, 'id' | 'z'>),
      goal: 'Ship it',
      wiredCardIds: [consoleId, 'grp']
    })
    s.removeCards(WT, [consoleId])
    const goal = board().cards.find((c) => c.id === goalId)
    expect(goal?.kind === 'goal' && goal.wiredCardIds).toEqual(['grp'])
    const reloaded = sanitizeBoardsByWorktree(JSON.parse(JSON.stringify({ [WT]: board() })))
    expect(reloaded[WT].cards).toEqual(board().cards)
  })
})

describe('goalCables', () => {
  it('draws to consoles, orchestrators and group frames, never to other kinds', () => {
    const card = (id: string, kind: string, extra: object = {}) => ({
      ...rect,
      id,
      title: id,
      kind,
      ...extra
    })
    const cables = goalCables({
      cards: [
        card('a', 'console', { tabId: 'tab-a', agentKind: 'claude' }),
        card('b', 'console', { tabId: 'tab-b', agentKind: 'claude' }),
        card('o', 'orchestrator', { name: 'o', wiredCardIds: [] }),
        card('n', 'note', { text: '', color: 'yellow' }),
        card('g', 'goal', {
          goal: 'x',
          criteria: [],
          dont: [],
          reminders: DEFAULT_GOAL_REMINDERS,
          driftCheck: false,
          wiredCardIds: ['a', 'o', 'n', 'grp', 'gone']
        })
      ] as never,
      groups: [{ id: 'grp', name: 'T', color: 'blue', cardIds: ['b'] }]
    })
    expect(cables.map((c) => [c.id, c.targetTabIds])).toEqual([
      ['g->a', ['tab-a']],
      ['g->o', []],
      ['g->group:grp', ['tab-b']]
    ])
    expect(cables.every((c) => c.orchestratorId === 'g')).toBe(true)
  })
})
