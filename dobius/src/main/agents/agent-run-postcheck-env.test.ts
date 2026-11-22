import { describe, expect, it } from 'vitest'
import { buildPostcheckEnv } from './agent-run-postcheck-env'

describe('buildPostcheckEnv', () => {
  it('passes only the allow-listed variables', () => {
    const env = buildPostcheckEnv({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LC_CTYPE: 'UTF-8',
      TMPDIR: '/tmp',
      NODE_ENV: 'test',
      CI: '1',
      TERM: 'xterm',
      ANTHROPIC_API_KEY: 'x',
      CLAUDE_CODE_OAUTH_TOKEN: 'x',
      GITHUB_TOKEN: 'x',
      AWS_SECRET_ACCESS_KEY: 'x',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      // Not secrets by name, and still not passed: unknown means out.
      NODE_OPTIONS: '--require ./evil.js',
      GIT_SSH_COMMAND: 'evil',
      LD_PRELOAD: '/tmp/evil.so',
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      LC_evil: 'x',
      MY_SETTING: 'x',
      UNSET: undefined
    })
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LC_CTYPE: 'UTF-8',
      TMPDIR: '/tmp',
      NODE_ENV: 'test',
      CI: '1',
      TERM: 'xterm'
    })
  })
})
