import { describe, expect, it } from 'vitest'
import { buildBoardConductorTranscript } from './board-conductor-context'

describe('buildBoardConductorTranscript', () => {
  it('summarizes consoles and groups ahead of the user text', () => {
    const text = buildBoardConductorTranscript(
      {
        workspace: 'main',
        consoles: [
          { name: 'Claude 1', agent: 'claude', status: 'working' },
          { name: 'Codex 1', agent: 'codex', status: 'idle' }
        ],
        groups: [{ name: 'Reviewers', members: ['Claude 1'] }]
      },
      'pause everyone'
    )
    expect(text).toBe(
      [
        '[Dobius Board] Workspace: main',
        'Consoles (2):',
        '- Claude 1 (claude, working)',
        '- Codex 1 (codex, idle)',
        'Groups:',
        '- Reviewers: Claude 1',
        '',
        'User: pause everyone'
      ].join('\n')
    )
  })

  it('caps long console lists', () => {
    const consoles = Array.from({ length: 30 }, (_, i) => ({
      name: `C${i}`,
      agent: 'claude',
      status: 'idle'
    }))
    const text = buildBoardConductorTranscript({ workspace: 'w', consoles, groups: [] }, 'hi')
    expect(text).toContain('- …and 6 more')
    expect(text).not.toContain('- C24 ')
    expect(
      buildBoardConductorTranscript({ workspace: 'w', consoles: [], groups: [] }, 'hi')
    ).toContain('Consoles: none')
  })
})
