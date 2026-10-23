import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { ClaudeManagedAccount, CodexManagedAccount } from '../../shared/types'
import {
  consoleAccountEnvVar,
  isConsoleAccountAgent,
  isSafeConsoleAccountId,
  type ConsoleAccountAgent,
  type ConsoleAccountLaunch,
  type ConsoleAccountPrepareArgs
} from '../../shared/console-account'

const PROFILE_MARKER = '.dobius-console-profile'

// Why: only non-credential config is shared into a profile. Credentials,
// `.claude.json` (identity + per-project state), auth.json and session stores
// stay per-profile so each console keeps its own login and its own resume ids.
const SHARED_ENTRIES: Record<ConsoleAccountAgent, readonly string[]> = {
  claude: [
    'settings.json',
    'CLAUDE.md',
    'agents',
    'commands',
    'skills',
    'plugins',
    'output-styles',
    'keybindings.json'
  ],
  codex: ['config.toml', 'AGENTS.md', 'prompts', 'skills', 'rules']
}

export type ConsoleProfileDeps = {
  profilesRoot: string
  sharedConfigDir: (agent: ConsoleAccountAgent) => string
  getClaudeAccounts: () => ClaudeManagedAccount[]
  getCodexAccounts: () => CodexManagedAccount[]
  platform: NodeJS.Platform
  warn?: (message: string, error?: unknown) => void
}

type AccountRef = { id: string; email: string; runtime: 'host' | 'wsl' }

function findAccount(
  deps: ConsoleProfileDeps,
  agent: ConsoleAccountAgent,
  accountId: string
): AccountRef | null {
  if (agent === 'claude') {
    const account = deps.getClaudeAccounts().find((entry) => entry.id === accountId)
    return account
      ? { id: account.id, email: account.email, runtime: account.managedAuthRuntime ?? 'host' }
      : null
  }
  const account = deps.getCodexAccounts().find((entry) => entry.id === accountId)
  return account
    ? { id: account.id, email: account.email, runtime: account.managedHomeRuntime ?? 'host' }
    : null
}

export function getConsoleProfileDir(
  profilesRoot: string,
  agent: ConsoleAccountAgent,
  accountId: string
): string {
  if (!isSafeConsoleAccountId(accountId)) {
    throw new Error('Invalid account id.')
  }
  const root = resolve(profilesRoot, agent)
  const dir = resolve(root, accountId)
  if (!dir.startsWith(root + sep)) {
    throw new Error('Invalid account id.')
  }
  return dir
}

function pathExists(target: string): boolean {
  try {
    lstatSync(target)
    return true
  } catch {
    return false
  }
}

/** Creates the profile dir and links shared config. Never overwrites or deletes anything. */
export function ensureConsoleProfile(
  deps: ConsoleProfileDeps,
  agent: ConsoleAccountAgent,
  accountId: string
): string {
  const dir = getConsoleProfileDir(deps.profilesRoot, agent, accountId)
  if (pathExists(dir) && lstatSync(dir).isSymbolicLink()) {
    throw new Error('Console profile path is a symlink; refusing to use it.')
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const marker = join(dir, PROFILE_MARKER)
  if (!pathExists(marker)) {
    writeFileSync(marker, `${accountId}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
  }
  const sharedDir = deps.sharedConfigDir(agent)
  for (const entry of SHARED_ENTRIES[agent]) {
    const source = join(sharedDir, entry)
    const target = join(dir, entry)
    if (!existsSync(source) || pathExists(target)) {
      continue
    }
    try {
      symlinkSync(source, target)
    } catch (error) {
      deps.warn?.(`[console-profile] Could not link shared ${entry}`, error)
    }
  }
  return dir
}

/** Reads only the identity email Claude stores in `.claude.json`; never touches credentials. */
export function readClaudeProfileEmail(dir: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, '.claude.json'), 'utf-8'))
    const oauth =
      parsed && typeof parsed === 'object'
        ? (parsed as { oauthAccount?: unknown }).oauthAccount
        : null
    const email =
      oauth && typeof oauth === 'object' ? (oauth as { emailAddress?: unknown }).emailAddress : null
    return typeof email === 'string' && email.trim() ? email.trim() : null
  } catch {
    return null
  }
}

function readSignInState(
  agent: ConsoleAccountAgent,
  dir: string
): { signedIn: boolean; signedInEmail: string | null } {
  if (agent === 'claude') {
    const signedInEmail = readClaudeProfileEmail(dir)
    return { signedIn: signedInEmail !== null, signedInEmail }
  }
  // Why: auth.json holds tokens, so only its existence is checked.
  return { signedIn: pathExists(join(dir, 'auth.json')), signedInEmail: null }
}

export function prepareConsoleAccountLaunch(
  deps: ConsoleProfileDeps,
  args: ConsoleAccountPrepareArgs
): ConsoleAccountLaunch {
  if (!args || !isConsoleAccountAgent(args.agent)) {
    throw new Error('Per-console accounts are only available for Claude and Codex.')
  }
  if (!isSafeConsoleAccountId(args.accountId)) {
    throw new Error('Invalid account id.')
  }
  if (deps.platform === 'win32') {
    throw new Error('Per-console accounts are not available on Windows yet.')
  }
  const account = findAccount(deps, args.agent, args.accountId)
  if (!account) {
    throw new Error('That account no longer exists.')
  }
  if (account.runtime !== 'host') {
    throw new Error('Per-console accounts support host accounts only.')
  }
  const configDir = ensureConsoleProfile(deps, args.agent, account.id)
  return {
    agent: args.agent,
    accountId: account.id,
    accountEmail: account.email,
    envVar: consoleAccountEnvVar(args.agent),
    configDir,
    ...readSignInState(args.agent, configDir)
  }
}
