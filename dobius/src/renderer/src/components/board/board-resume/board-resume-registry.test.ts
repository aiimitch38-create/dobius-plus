import { describe, expect, it, vi } from 'vitest'
import {
  boardResumeModeOf,
  createBoardResumeRegistry,
  resumableBoardEntries,
  type DeferredBoardResume
} from './board-resume-registry'

const entry = (tabId: string, worktreeId = 'wt', id = `s-${tabId}`): DeferredBoardResume => ({
  worktreeId,
  tabId,
  agent: 'claude',
  providerSession: { key: 'session_id', id }
})
const ASK_CONSOLE = { ask: true, isBoardConsole: true }

describe('boardResumeModeOf', () => {
  it('defaults to automatic resume unless Ask first is chosen', () => {
    expect(boardResumeModeOf(undefined)).toBe('auto')
    expect(boardResumeModeOf(null)).toBe('auto')
    expect(boardResumeModeOf({})).toBe('auto')
    expect(boardResumeModeOf({ boardResumeMode: 'auto' })).toBe('auto')
    expect(boardResumeModeOf({ boardResumeMode: 'ask' })).toBe('ask')
  })
})

describe('createBoardResumeRegistry', () => {
  it('never defers under automatic resume or for non-board panes', () => {
    const registry = createBoardResumeRegistry()
    expect(registry.decide(entry('t1'), { ask: false, isBoardConsole: true })).toBe(false)
    expect(registry.decide(entry('t2'), { ask: true, isBoardConsole: false })).toBe(false)
    expect(registry.pending('wt')).toEqual([])
    expect(registry.knows('t1')).toBe(false)
  })

  it('parks a board console once and keeps it parked until answered', () => {
    const registry = createBoardResumeRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)
    expect(registry.decide(entry('t1'), ASK_CONSOLE)).toBe(true)
    // A second restore attempt for the same tab stays fresh, even if the setting flipped.
    expect(registry.decide(entry('t1', 'wt', 'other'), { ask: false, isBoardConsole: true })).toBe(
      true
    )
    expect(registry.pending('wt')).toEqual([entry('t1')])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(registry.version()).toBe(1)
  })

  it('take() answers only that worktree and later restores resume normally', () => {
    const registry = createBoardResumeRegistry()
    registry.decide(entry('t1'), ASK_CONSOLE)
    registry.decide(entry('t2', 'other'), ASK_CONSOLE)
    expect(registry.take('wt')).toEqual([entry('t1')])
    expect(registry.pending('wt')).toEqual([])
    expect(registry.pending('other')).toHaveLength(1)
    expect(registry.knows('t1')).toBe(true)
    expect(registry.decide(entry('t1'), ASK_CONSOLE)).toBe(false)
    expect(registry.take('wt')).toEqual([])
  })

  it('unsubscribes listeners', () => {
    const registry = createBoardResumeRegistry()
    const listener = vi.fn()
    const off = registry.subscribe(listener)
    off()
    registry.decide(entry('t1'), ASK_CONSOLE)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('resumableBoardEntries', () => {
  it('keeps consoles still on the board whose pane is not already running that session', () => {
    const entries = [entry('a'), entry('b'), entry('c'), entry('d')]
    const result = resumableBoardEntries(entries, new Set(['a', 'b', 'c']), [
      { tabId: 'b', state: 'working', providerSession: { id: 's-b' } },
      { tabId: 'c', state: 'done', providerSession: { id: 's-c' } },
      { tabId: 'a', state: 'idle', providerSession: { id: 'fresh-session' } }
    ])
    expect(result.map((e) => e.tabId)).toEqual(['a', 'c'])
  })
})
