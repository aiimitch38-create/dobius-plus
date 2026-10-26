import { afterEach, describe, expect, it } from 'vitest'
import type { AutomationLoopTarget } from '../../shared/automations-types'
import type { RuntimeTerminalSummary } from '../../shared/runtime-types'
import {
  resolveBoardGroupInWorktree,
  resolveGroupAddress,
  setCustomGroupResolver
} from '../runtime/orchestration/groups'
import { boardGroupSlug, boardGroupTabIdsById, boardGroupTabIdsByName } from './board-group-members'

const boards = {
  wt1: {
    cards: [
      { id: 'c1', kind: 'console', tabId: 't1' },
      { id: 'c2', kind: 'console', tabId: 't2' },
      { id: 'c3', kind: 'console', tabId: 't3' },
      { id: 'n', kind: 'note' }
    ],
    groups: [
      { id: 'g1', name: 'Team A', cardIds: ['c1', 'c2', 'n'] },
      { id: 'g2', name: 'Reviewers', cardIds: ['c3'] }
    ]
  },
  // Same group name in another worktree: must never receive wt1's relays.
  wt2: {
    cards: [
      { id: 'x1', kind: 'console', tabId: 't9' },
      { id: 'x2', kind: 'console', tabId: 't8' }
    ],
    groups: [{ id: 'g9', name: 'Team A', cardIds: ['x1', 'x2'] }]
  },
  junk: 'not a board'
}

const term = (handle: string, tabId: string, worktreeId = 'wt1') =>
  ({ handle, tabId, worktreeId, title: 'zsh' }) as RuntimeTerminalSummary

describe('board group members', () => {
  afterEach(() => setCustomGroupResolver(null))

  it('slugs addresses consistently', () => {
    expect(boardGroupSlug('@Team A')).toBe('team-a')
    expect(boardGroupSlug('team_a')).toBe('team-a')
  })

  it('resolves by id and by name within one worktree only', () => {
    expect(boardGroupTabIdsById(boards, 'g1', 'wt1')).toEqual(['t1', 't2'])
    expect(boardGroupTabIdsById(boards, 'g1', 'wt2')).toEqual([])
    expect(boardGroupTabIdsByName(boards, '@team-a', 'wt1')).toEqual(['t1', 't2'])
    expect(boardGroupTabIdsByName(boards, '@team-a', 'wt2')).toEqual(['t9', 't8'])
    expect(boardGroupTabIdsByName(boards, 'nobody', 'wt1')).toBeNull()
    expect(boardGroupTabIdsByName(undefined, 'team-a', 'wt1')).toBeNull()
  })

  it('"@Team A" reaches only the sender worktree\'s group, never the sender, and built-ins still win', () => {
    setCustomGroupResolver((name, worktreeId) => boardGroupTabIdsByName(boards, name, worktreeId))
    const terminals = [
      term('h1', 't1'),
      term('h2', 't2'),
      term('h3', 't3'),
      term('h9', 't9', 'wt2'),
      term('h8', 't8', 'wt2')
    ]
    expect(resolveGroupAddress('@team-a', 'h1', terminals, () => null)).toEqual(['h2'])
    expect(resolveGroupAddress('@team-a', 'h3', terminals, () => null)).toEqual(['h1', 'h2'])
    expect(resolveGroupAddress('@Team A', 'h9', terminals, () => null)).toEqual(['h8'])
    expect(resolveGroupAddress('@reviewers', 'h1', terminals, () => null)).toEqual(['h3'])
    // An unknown sender has no worktree, so it reaches no Board group.
    expect(resolveGroupAddress('@team-a', 'cli', terminals, () => null)).toEqual([])
    expect(resolveGroupAddress('@all', 'h1', terminals, () => null)).toEqual([
      'h2',
      'h3',
      'h9',
      'h8'
    ])
    expect(resolveGroupAddress('@unknown', 'h1', terminals, () => null)).toEqual([])
  })

  it('conductor relays: "@Group" resolves in the given worktree even without a sender terminal', () => {
    setCustomGroupResolver((name, worktreeId) => boardGroupTabIdsByName(boards, name, worktreeId))
    const terminals = [
      term('h1', 't1'),
      term('h2', 't2'),
      term('h9', 't9', 'wt2'),
      term('h8', 't8', 'wt2')
    ]
    expect(resolveBoardGroupInWorktree('@Team A', 'wt1', terminals)).toEqual(['h1', 'h2'])
    expect(resolveBoardGroupInWorktree('@team-a', 'wt2', terminals)).toEqual(['h9', 'h8'])
    expect(resolveBoardGroupInWorktree('@nobody', 'wt1', terminals)).toBeNull()
    expect(resolveBoardGroupInWorktree('h1', 'wt1', terminals)).toBeNull()
  })
})

describe('boardConsoleTabIds', () => {
  it('returns every console tab on that worktree board only', async () => {
    const { boardConsoleTabIds } = await import('./board-group-members')
    const boards = {
      wt: {
        cards: [
          { kind: 'console', id: 'a', tabId: 't1' },
          { kind: 'note', id: 'n' },
          { kind: 'console', id: 'b', tabId: 't2' }
        ],
        groups: []
      },
      other: { cards: [{ kind: 'console', id: 'c', tabId: 't3' }], groups: [] }
    }
    expect(boardConsoleTabIds(boards, 'wt')).toEqual(['t1', 't2'])
    expect(boardConsoleTabIds(boards, 'missing')).toEqual([])
    expect(boardConsoleTabIds(null, 'wt')).toEqual([])
  })
})

describe('loop targets: orchestrator-wired consoles', () => {
  it('resolves the consoles wired to that orchestrator only', async () => {
    const { loopTargetTabIdsFromBoards } = await import('./board-group-members')
    const boards = {
      wt: {
        cards: [
          { kind: 'console', id: 'a', tabId: 't1' },
          { kind: 'console', id: 'b', tabId: 't2' },
          { kind: 'orchestrator', id: 'o', wiredCardIds: ['b', 'gone'] }
        ],
        groups: []
      }
    }
    expect(loopTargetTabIdsFromBoards(boards, { type: 'orchestrator', cardId: 'o' }, 'wt')).toEqual(
      ['t2']
    )
    expect(loopTargetTabIdsFromBoards(boards, { type: 'orchestrator', cardId: 'x' }, 'wt')).toEqual(
      []
    )
    expect(loopTargetTabIdsFromBoards(boards, { type: 'board' }, 'wt')).toEqual(['t1', 't2'])
  })

  it('picked tabs only reach consoles still on that worktree board', async () => {
    const { loopTargetTabIdsFromBoards } = await import('./board-group-members')
    const boards = {
      wt: { cards: [{ kind: 'console', id: 'a', tabId: 't1' }], groups: [] },
      other: { cards: [{ kind: 'console', id: 'b', tabId: 't2' }], groups: [] }
    }
    const picked: AutomationLoopTarget = { type: 'tabs', tabIds: ['t1', 't2', 'gone'] }
    expect(loopTargetTabIdsFromBoards(boards, picked, 'wt')).toEqual(['t1'])
    expect(loopTargetTabIdsFromBoards(boards, picked, 'missing')).toEqual([])
  })
})
