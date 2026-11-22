import { describe, expect, it } from 'vitest'
import { formatConsoles } from './board'

describe('board consoles text output', () => {
  it('shows the live handle, agent, role and title for a running console', () => {
    expect(
      formatConsoles([
        {
          tabId: 'tab-1',
          title: 'Builder 1',
          role: 'worker:lead-acme',
          agent: 'codex',
          handle: 'term_a',
          running: true
        }
      ])
    ).toBe('tab-1  term_a  codex  worker:lead-acme  Builder 1')
  })

  it('says "not running" when the card has no live terminal', () => {
    expect(
      formatConsoles([
        { tabId: 'tab-2', title: 'Idle', role: null, agent: 'claude', handle: null, running: false },
        { tabId: 'tab-3', title: 'Exited', role: null, agent: null, handle: 'term_x', running: false }
      ])
    ).toBe('tab-2  not running  claude  -  Idle\ntab-3  not running  -  -  Exited')
  })

  it('still prints rows from an older runtime that has no live fields', () => {
    expect(formatConsoles([{ tabId: 'tab-4', title: 'Old', role: null }])).toBe(
      'tab-4  unknown  -  -  Old'
    )
  })
})
