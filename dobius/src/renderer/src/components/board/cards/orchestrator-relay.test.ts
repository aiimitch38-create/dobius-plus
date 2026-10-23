import { describe, expect, it } from 'vitest'
import type { BoardState } from '@/store/slices/board'
import {
  inboxToThread,
  orchestratorHandle,
  relaySubject,
  wiredConsoleTabIds
} from './orchestrator-relay'

const board = {
  cards: [
    { id: 'c1', kind: 'console', tabId: 't1' },
    { id: 'c2', kind: 'console', tabId: 't2' },
    { id: 'n', kind: 'note' }
  ],
  groups: []
} as unknown as BoardState

describe('orchestrator relay', () => {
  it('relays only to wired consoles that still exist', () => {
    expect(wiredConsoleTabIds(board, ['c2', 'n', 'gone'])).toEqual(['t2'])
    expect(wiredConsoleTabIds(board, [])).toEqual([])
  })
  it('builds a stable mailbox handle and bounded subjects', () => {
    expect(orchestratorHandle('x')).toBe('board-orchestrator:x')
    expect(relaySubject('  fix tests\nthen lint')).toBe('fix tests')
    expect(relaySubject('a'.repeat(100))).toHaveLength(80)
  })
  it('labels replies by console title, falling back to the handle', () => {
    const rows = [
      { id: 'm1', from_handle: 'h1', body: 'done', subject: 's' },
      { id: 'm2', from_handle: 'h9', body: ' ', subject: 'fallback' }
    ]
    expect(inboxToThread(rows, new Map([['h1', 'Claude 1']]))).toEqual([
      { id: 'm1', role: 'orchestrator', author: 'Claude 1', text: 'done' },
      { id: 'm2', role: 'orchestrator', author: 'h9', text: 'fallback' }
    ])
  })
})
