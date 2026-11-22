import { describe, expect, it } from 'vitest'
import { CLAUDE_CHILD_SESSION_MARKERS, dropInheritedClaudeChildMarkers } from './claude-child-env'

// Adapted from Line A #26 (electron/__tests__/claude-child-env.test.mjs).
describe('dropInheritedClaudeChildMarkers', () => {
  it('drops only the child-session markers and keeps the account and persistence choices', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ATTENDED: '1',
      CLAUDE_CONFIG_DIR: '/p/a',
      CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
      CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
      PATH: '/bin'
    }
    expect(dropInheritedClaudeChildMarkers(env)).toEqual([
      'CLAUDECODE',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_SESSION_ATTENDED'
    ])
    expect(env).toEqual({
      CLAUDE_CONFIG_DIR: '/p/a',
      CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
      CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
      PATH: '/bin'
    })
    expect(dropInheritedClaudeChildMarkers(env)).toEqual([])
  })

  it('drops a marker that is present but empty', () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_CODE_CHILD_SESSION: '' }
    expect(dropInheritedClaudeChildMarkers(env)).toEqual(['CLAUDE_CODE_CHILD_SESSION'])
    expect('CLAUDE_CODE_CHILD_SESSION' in env).toBe(false)
  })

  it('never touches the account binding', () => {
    expect(CLAUDE_CHILD_SESSION_MARKERS).not.toContain('CLAUDE_CONFIG_DIR')
  })
})
