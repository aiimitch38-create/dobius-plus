import { describe, expect, it } from 'vitest'
import type { TerminalTab } from '../../../shared/types'
import { agentNameEnv } from './agent-name-env'

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

describe('agentNameEnv', () => {
  it('exports the tab name as DOBIUS_AGENT_NAME', () => {
    const state = { tabsByWorktree: { wt: [tab({ agentName: 'Juniper' })] } }
    expect(agentNameEnv(state, 'wt', 'tab-1')).toEqual({
      DOBIUS_AGENT_NAME: 'Juniper'
    })
  })

  it('gives unnamed or unknown tabs nothing', () => {
    const state = { tabsByWorktree: { wt: [tab({})] } }
    expect(agentNameEnv(state, 'wt', 'tab-1')).toEqual({})
    expect(agentNameEnv(state, 'wt', 'missing')).toEqual({})
  })

  it('keeps the value on one line', () => {
    const state = { tabsByWorktree: { wt: [tab({ agentName: 'Juni\nper' })] } }
    expect(agentNameEnv(state, 'wt', 'tab-1')).toEqual({
      DOBIUS_AGENT_NAME: 'Juni per'
    })
  })
})
