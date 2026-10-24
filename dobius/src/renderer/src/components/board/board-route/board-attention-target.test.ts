import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import {
  boardAttentionTarget,
  boardAttentionTargets,
  type BoardAttentionConsole
} from './board-attention-target'
import { nextNeedsYouCardId } from './use-board-attention-jump'

const STALE_AFTER_MS = 30 * 60 * 1000
const NOW = 1_000_000

function entry(overrides: Partial<AgentStatusEntry> & { paneKey: string }): AgentStatusEntry {
  return {
    state: 'waiting',
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW,
    stateHistory: [],
    ...overrides
  }
}

function console_(id: string, tabId: string): BoardAttentionConsole {
  return { id, tabId, x: 100, y: 200, w: 300, h: 180 }
}

describe('boardAttentionTarget', () => {
  it('returns null when there are no consoles', () => {
    expect(
      boardAttentionTarget([], {
        agentStatusByPaneKey: {},
        acknowledgedAgentsByPaneKey: {},
        now: NOW,
        staleAfterMs: STALE_AFTER_MS
      })
    ).toBeNull()
  })

  it('returns null when every pane is idle/working/done', () => {
    const consoles = [console_('c1', 't1')]
    const input = {
      agentStatusByPaneKey: {
        't1:leaf1': entry({ paneKey: 't1:leaf1', state: 'working' })
      },
      acknowledgedAgentsByPaneKey: {},
      now: NOW,
      staleAfterMs: STALE_AFTER_MS
    }
    expect(boardAttentionTarget(consoles, input)).toBeNull()
  })

  it('picks a waiting, unacknowledged console and centers it', () => {
    const consoles = [console_('c1', 't1')]
    const input = {
      agentStatusByPaneKey: {
        't1:leaf1': entry({ paneKey: 't1:leaf1', state: 'waiting', stateStartedAt: NOW })
      },
      acknowledgedAgentsByPaneKey: {},
      now: NOW,
      staleAfterMs: STALE_AFTER_MS
    }
    expect(boardAttentionTarget(consoles, input)).toEqual({
      cardId: 'c1',
      center: { x: 250, y: 290 }
    })
  })

  it('treats blocked the same as waiting', () => {
    const consoles = [console_('c1', 't1')]
    const input = {
      agentStatusByPaneKey: {
        't1:leaf1': entry({ paneKey: 't1:leaf1', state: 'blocked', stateStartedAt: NOW })
      },
      acknowledgedAgentsByPaneKey: {},
      now: NOW,
      staleAfterMs: STALE_AFTER_MS
    }
    expect(boardAttentionTarget(consoles, input)?.cardId).toBe('c1')
  })

  it('skips a pane already acknowledged at/after its state started', () => {
    const consoles = [console_('c1', 't1')]
    const input = {
      agentStatusByPaneKey: {
        't1:leaf1': entry({ paneKey: 't1:leaf1', state: 'waiting', stateStartedAt: NOW })
      },
      acknowledgedAgentsByPaneKey: { 't1:leaf1': NOW },
      now: NOW,
      staleAfterMs: STALE_AFTER_MS
    }
    expect(boardAttentionTarget(consoles, input)).toBeNull()
  })

  it('skips a stale pane past staleAfterMs', () => {
    const consoles = [console_('c1', 't1')]
    const input = {
      agentStatusByPaneKey: {
        't1:leaf1': entry({
          paneKey: 't1:leaf1',
          state: 'waiting',
          stateStartedAt: NOW - STALE_AFTER_MS * 2,
          updatedAt: NOW - STALE_AFTER_MS * 2
        })
      },
      acknowledgedAgentsByPaneKey: {},
      now: NOW,
      staleAfterMs: STALE_AFTER_MS
    }
    expect(boardAttentionTarget(consoles, input)).toBeNull()
  })

  it('prefers the console that has been waiting longest (smallest stateStartedAt)', () => {
    const consoles = [console_('recent', 't1'), console_('oldest', 't2'), console_('mid', 't3')]
    const input = {
      agentStatusByPaneKey: {
        't1:leaf': entry({ paneKey: 't1:leaf', state: 'waiting', stateStartedAt: NOW - 1_000 }),
        't2:leaf': entry({ paneKey: 't2:leaf', state: 'blocked', stateStartedAt: NOW - 50_000 }),
        't3:leaf': entry({ paneKey: 't3:leaf', state: 'waiting', stateStartedAt: NOW - 10_000 })
      },
      acknowledgedAgentsByPaneKey: {},
      now: NOW,
      staleAfterMs: STALE_AFTER_MS
    }
    expect(boardAttentionTarget(consoles, input)?.cardId).toBe('oldest')
  })

  it('considers multiple panes within the same tab and takes the earliest unacked one', () => {
    const consoles = [console_('c1', 't1')]
    const input = {
      agentStatusByPaneKey: {
        't1:leafA': entry({
          paneKey: 't1:leafA',
          state: 'waiting',
          stateStartedAt: NOW - 5_000
        }),
        't1:leafB': entry({
          paneKey: 't1:leafB',
          state: 'waiting',
          stateStartedAt: NOW - 20_000
        })
      },
      acknowledgedAgentsByPaneKey: {},
      now: NOW,
      staleAfterMs: STALE_AFTER_MS
    }
    expect(boardAttentionTarget(consoles, input)).toEqual({
      cardId: 'c1',
      center: { x: 250, y: 290 }
    })
  })
})

describe('needs-you cycling', () => {
  const consoles = [console_('c1', 't1'), console_('c2', 't2'), console_('c3', 't3')]
  const input = {
    agentStatusByPaneKey: {
      't1:a': entry({ paneKey: 't1:a', stateStartedAt: NOW - 100 }),
      't2:a': entry({ paneKey: 't2:a', state: 'working' }),
      't3:a': entry({ paneKey: 't3:a', state: 'blocked', stateStartedAt: NOW - 500 })
    },
    acknowledgedAgentsByPaneKey: {},
    now: NOW,
    staleAfterMs: STALE_AFTER_MS
  }

  it('lists every waiting console, longest-waiting first', () => {
    expect(boardAttentionTargets(consoles, input).map((t) => t.cardId)).toEqual(['c3', 'c1'])
  })

  it('N starts at the oldest, then moves to the next and wraps', () => {
    const ids = boardAttentionTargets(consoles, input).map((t) => t.cardId)
    expect(nextNeedsYouCardId(ids, null)).toBe('c3')
    expect(nextNeedsYouCardId(ids, 'c3')).toBe('c1')
    expect(nextNeedsYouCardId(ids, 'c1')).toBe('c3')
    // Focused on a console that no longer waits: back to the oldest waiting one.
    expect(nextNeedsYouCardId(ids, 'c2')).toBe('c3')
    expect(nextNeedsYouCardId([], null)).toBeNull()
  })
})
