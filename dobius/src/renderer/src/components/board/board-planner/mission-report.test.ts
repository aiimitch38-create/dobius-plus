import { describe, expect, it } from 'vitest'
import { missionReport } from './mission-report'

describe('missionReport', () => {
  it('maps a finished mission to a report row with the console agent', () => {
    expect(
      missionReport(
        { tabId: 't1', name: 'Claude 1', reply: 'All  tests\npass.', finishedAt: 42 },
        [{ tabId: 't1', agentKind: 'claude' }],
        99
      )
    ).toEqual({
      agent: 'claude',
      consoleTitle: 'Claude 1',
      excerpt: 'All tests pass.',
      full: 'All  tests\npass.',
      at: 42
    })
  })

  it('falls back to the lane name and now when the card or finish time is missing', () => {
    const r = missionReport({ tabId: 'tX', name: 'Codex 2', reply: null, finishedAt: null }, [], 7)
    expect(r).toEqual({ agent: 'Codex 2', consoleTitle: 'Codex 2', excerpt: '', full: '', at: 7 })
  })
})
