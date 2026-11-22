// The check runs outside the agent's sandbox and may execute files the agent
// just edited (a test script), so it gets a short ALLOW list of variables and
// nothing else: no sign-in tokens, API keys, SSH agent socket or app settings.
const POSTCHECK_ENV_NAMES: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'LANG',
  'TMPDIR',
  'NODE_ENV',
  'CI',
  'TERM'
])

export function isPostcheckEnvName(name: string): boolean {
  return POSTCHECK_ENV_NAMES.has(name) || /^LC_[A-Z]+$/.test(name)
}

export function buildPostcheckEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && isPostcheckEnvName(name)) {
      allowed[name] = value
    }
  }
  return allowed
}
