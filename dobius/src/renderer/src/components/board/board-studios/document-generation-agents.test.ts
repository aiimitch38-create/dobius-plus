import { describe, expect, it } from 'vitest'
import { consoleAgentChoices, pickAgentConsole } from './document-generation-agents'

const cards = [
  { kind: 'note', id: 'n1', z: 9, title: 'Note' },
  { kind: 'console', id: 'c1', z: 1, title: 'Claude 1', tabId: 't1', agentKind: 'claude' },
  { kind: 'console', id: 'c2', z: 5, title: 'Codex 1', tabId: 't2', agentKind: 'codex' },
  { kind: 'console', id: 'c3', z: 3, title: 'Claude 2', tabId: 't3', agentKind: 'claude' }
]

describe('consoleAgentChoices', () => {
  it('groups consoles by agent CLI, most recently used first', () => {
    expect(consoleAgentChoices(cards)).toEqual([
      { agent: 'codex', consoles: [{ cardId: 'c2', tabId: 't2', title: 'Codex 1' }] },
      {
        agent: 'claude',
        consoles: [
          { cardId: 'c3', tabId: 't3', title: 'Claude 2' },
          { cardId: 'c1', tabId: 't1', title: 'Claude 1' }
        ]
      }
    ])
    expect(consoleAgentChoices([])).toEqual([])
  })
})

describe('pickAgentConsole', () => {
  const choices = consoleAgentChoices(cards)
  it('defaults to the current (top-most) agent and its latest console', () => {
    expect(pickAgentConsole(choices, null, null)).toMatchObject({
      agent: 'codex',
      target: { tabId: 't2' }
    })
  })
  it('honors a chosen agent and console, falling back to that agent’s latest console', () => {
    expect(pickAgentConsole(choices, 'claude', 't1')?.target.tabId).toBe('t1')
    expect(pickAgentConsole(choices, 'claude', 't2')?.target.tabId).toBe('t3')
    expect(pickAgentConsole(choices, 'gemini', null)?.agent).toBe('codex')
    expect(pickAgentConsole([], null, null)).toBeNull()
  })
})
