/** Agents whose login lives in one config dir that an env var can redirect. */
export const CONSOLE_ACCOUNT_AGENTS = ['claude', 'codex'] as const
export type ConsoleAccountAgent = (typeof CONSOLE_ACCOUNT_AGENTS)[number]

export type ConsoleAccountEnvVar = 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME'

export type ConsoleAccountPrepareArgs = {
  agent: ConsoleAccountAgent
  accountId: string
}

/** Result of preparing a pinned console profile. Never carries credentials. */
export type ConsoleAccountLaunch = {
  agent: ConsoleAccountAgent
  accountId: string
  accountEmail: string
  envVar: ConsoleAccountEnvVar
  configDir: string
  /** False until the user has signed in once inside a console on this profile. */
  signedIn: boolean
  /** Email the CLI reports for the profile, when it exposes one without reading credentials. */
  signedInEmail: string | null
}

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function isConsoleAccountAgent(
  agent: string | null | undefined
): agent is ConsoleAccountAgent {
  return agent === 'claude' || agent === 'codex'
}

export function isSafeConsoleAccountId(accountId: unknown): accountId is string {
  return typeof accountId === 'string' && ACCOUNT_ID_PATTERN.test(accountId)
}

export function consoleAccountEnvVar(agent: ConsoleAccountAgent): ConsoleAccountEnvVar {
  return agent === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'
}

/** Pinning folds env into a POSIX shell command, so only POSIX hosts qualify. */
export function supportsConsoleAccountPin(platform: NodeJS.Platform, isRemote: boolean): boolean {
  return !isRemote && platform !== 'win32'
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Prefixes the agent's base command with an inline env assignment.
 * Why inline: pty/shell-ready env re-exports CODEX_HOME for every terminal, but an
 * inline assignment wins for that one process, and it lands in
 * launchConfig.agentCommand so resume after restart reuses the same profile.
 */
export function buildPinnedAgentCommand(
  baseCommand: string,
  envVar: ConsoleAccountEnvVar,
  configDir: string
): string {
  const base = stripPinnedAgentPrefix(baseCommand).trim()
  return `${envVar}=${quotePosix(configDir)} ${base}`
}

const PIN_PREFIX_PATTERN = /^(?:CLAUDE_CONFIG_DIR|CODEX_HOME)='(?:[^']|'\\'')*'\s+/

/** Removes a prefix this module added, so re-pinning never stacks assignments. */
export function stripPinnedAgentPrefix(command: string): string {
  return command.replace(PIN_PREFIX_PATTERN, '')
}

export function pinnedAccountMismatch(launch: ConsoleAccountLaunch): boolean {
  return (
    launch.signedInEmail !== null &&
    launch.signedInEmail.trim().toLowerCase() !== launch.accountEmail.trim().toLowerCase()
  )
}
