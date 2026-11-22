import { CLAUDE_AUTH_ENV_VARS } from '../claude-accounts/environment'

// The check runs outside the agent's sandbox and may execute files the agent
// just edited (a test script), so it never inherits sign-in tokens or
// credential variables.
const CREDENTIAL_ENV_NAME =
  /TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|API_?KEY|ACCESS_KEY|PRIVATE_KEY|SESSION_KEY|COOKIE|(?:^|_)AUTH(?:_|$)/i

const NAMED_CREDENTIAL_ENV = new Set<string>([
  ...CLAUDE_AUTH_ENV_VARS,
  'ANTHROPIC_CUSTOM_HEADERS',
  // The SSH agent socket lets a command sign in to remote hosts as the user.
  'SSH_AUTH_SOCK'
])

export function isCredentialEnvName(name: string): boolean {
  return NAMED_CREDENTIAL_ENV.has(name) || CREDENTIAL_ENV_NAME.test(name)
}

export function buildPostcheckEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !isCredentialEnvName(name)) {
      cleaned[name] = value
    }
  }
  return cleaned
}
