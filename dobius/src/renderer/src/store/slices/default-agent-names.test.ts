import { describe, expect, it } from 'vitest'
import type { TerminalTab } from '../../../../shared/types'
import type { BoardState } from './board-state'
import {
  defaultConsoleTitleRenames,
  isAutomaticConsoleTitle,
  nameDefaultTerminalTabs
} from './default-agent-names'

function tab(overrides: Partial<TerminalTab> & { id: string }): TerminalTab {
  return {
    ptyId: null,
    worktreeId: 'wt',
    title: 'Terminal 1',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  }
}

describe('automatic console titles', () => {
  it('matches only the spawn default for the card agent', () => {
    expect(isAutomaticConsoleTitle('Claude 5', 'claude')).toBe(true)
    expect(isAutomaticConsoleTitle('Codex 2', 'codex')).toBe(true)
    expect(isAutomaticConsoleTitle('Pi 1', 'pi')).toBe(true)
    expect(isAutomaticConsoleTitle('Terminal 4', 'claude')).toBe(true)
    expect(isAutomaticConsoleTitle('Codex 2', 'claude')).toBe(false)
    expect(isAutomaticConsoleTitle('Sprint 2', 'claude')).toBe(false)
    expect(isAutomaticConsoleTitle('Claude', 'claude')).toBe(false)
    expect(isAutomaticConsoleTitle('Juniper', 'claude')).toBe(false)
  })
})

describe('nameDefaultTerminalTabs', () => {
  it('names only automatic defaults and is deterministic', () => {
    const input = {
      wt: [
        tab({ id: 'a' }),
        tab({ id: 'b', defaultTitle: 'Terminal 2' }),
        tab({ id: 'c', customTitle: 'Mine' }),
        tab({ id: 'd', agentName: 'Juniper' }),
        tab({ id: 'e', defaultTitle: 'Cedar' })
      ]
    }
    const once = nameDefaultTerminalTabs(input, undefined)
    const twice = nameDefaultTerminalTabs(input, undefined)
    expect(once.wt.map((t) => t.agentName)).toEqual(twice.wt.map((t) => t.agentName))
    const [a, b, c, d, e] = once.wt
    expect(a.agentName).toBeTruthy()
    expect(b.agentName).toBeTruthy()
    expect(a.agentName).not.toBe(b.agentName)
    expect([a.agentName, b.agentName]).not.toContain('Juniper')
    expect([a.agentName, b.agentName]).not.toContain('Mine')
    expect(c.agentName).toBeUndefined()
    expect(d.agentName).toBe('Juniper')
    expect(e.agentName).toBeUndefined()
    expect(nameDefaultTerminalTabs(once, undefined)).toBe(once)
  })
})

describe('defaultConsoleTitleRenames', () => {
  it('renames default console titles to the tab name, never typed ones', () => {
    const boards = {
      wt: {
        cards: [
          { id: '1', kind: 'console', tabId: 'a', agentKind: 'claude', title: 'Claude 5' },
          { id: '2', kind: 'console', tabId: 'b', agentKind: 'claude', title: 'Payments' },
          { id: '3', kind: 'console', tabId: 'c', agentKind: 'codex', title: 'Codex 1' },
          { id: '4', kind: 'console', tabId: 'gone', agentKind: 'claude', title: 'Claude 2' }
        ]
      }
    } as unknown as Record<string, BoardState>
    const tabs = {
      wt: [
        tab({ id: 'a', agentName: 'Juniper' }),
        tab({ id: 'b', agentName: 'Falcon' }),
        tab({ id: 'c', agentName: 'Willow', customTitle: 'Deploy' })
      ]
    }
    expect(defaultConsoleTitleRenames(boards, tabs)).toEqual([
      { worktreeId: 'wt', cardId: '1', title: 'Juniper' },
      { worktreeId: 'wt', cardId: '3', title: 'Deploy' }
    ])
  })
})
