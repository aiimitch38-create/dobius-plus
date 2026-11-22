import { describe, expect, it } from 'vitest'
import { buildPostcheckEnv } from './agent-run-postcheck-env'

describe('buildPostcheckEnv', () => {
  it('drops sign-in tokens and credential variables, keeps the rest', () => {
    const env = buildPostcheckEnv({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      NODE_ENV: 'test',
      AUTHOR: 'me',
      ANTHROPIC_API_KEY: 'x',
      ANTHROPIC_AUTH_TOKEN: 'x',
      CLAUDE_CODE_OAUTH_TOKEN: 'x',
      AWS_BEARER_TOKEN_BEDROCK: 'x',
      ANTHROPIC_CUSTOM_HEADERS: 'authorization: x',
      GITHUB_TOKEN: 'x',
      GH_TOKEN: 'x',
      NPM_TOKEN: 'x',
      OPENAI_API_KEY: 'x',
      STRIPE_APIKEY: 'x',
      AWS_SECRET_ACCESS_KEY: 'x',
      AWS_ACCESS_KEY_ID: 'x',
      DB_PASSWORD: 'x',
      GOOGLE_APPLICATION_CREDENTIALS: '/path',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      npm_config__authToken: 'x',
      BASIC_AUTH: 'x',
      UNSET: undefined
    })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/me', NODE_ENV: 'test', AUTHOR: 'me' })
  })
})
