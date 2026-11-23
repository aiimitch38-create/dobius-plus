import { describe, expect, it } from 'vitest'
import type { TerminalTab } from '../../../../../shared/types'
import { consoleTitleForTab } from './console-agent-title'

function tab(overrides: Partial<TerminalTab>): TerminalTab {
  return {
    id: 'tab-1',
    ptyId: null,
    worktreeId: 'wt',
    title: 'Juniper',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  }
}

describe('consoleTitleForTab', () => {
  it('titles a new console with its tab agent name', () => {
    const state = { tabsByWorktree: { wt: [tab({ agentName: 'Juniper' })] } }
    expect(consoleTitleForTab(state, 'tab-1', 'Claude 3')).toBe('Juniper')
  })

  it('prefers a manual tab name', () => {
    const state = {
      tabsByWorktree: {
        wt: [tab({ agentName: 'Juniper', customTitle: 'Deploy' })]
      }
    }
    expect(consoleTitleForTab(state, 'tab-1', 'Claude 3')).toBe('Deploy')
  })

  it('falls back when the tab is missing, unnamed or not created yet', () => {
    const state = { tabsByWorktree: { wt: [tab({})] } }
    expect(consoleTitleForTab(state, 'tab-1', 'Claude 3')).toBe('Claude 3')
    expect(consoleTitleForTab(state, 'other', 'Claude 3')).toBe('Claude 3')
    expect(consoleTitleForTab(state, undefined, 'Claude 3')).toBe('Claude 3')
  })
})
