import { readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Options, SandboxSettings } from '@anthropic-ai/claude-agent-sdk'
import { getUserDataRoot } from '../storage/user-data-root'

/**
 * Process-boundary confinement for Claude agent runs (root fix for Codex F6).
 *
 * The text rails in agent-hard-rails.ts inspect a command string, so shell
 * globs over the agents folder, whole-home walkers (`find ~ | xargs cat`),
 * interpreter file APIs and multi-call attacks get past them. The SDK sandbox
 * enforces the same limits in the kernel (Seatbelt / bubblewrap) for every
 * Bash command; the permission deny rules below enforce them for the built-in
 * file tools (Read/Grep/Glob via Read rules, Write/Edit via Edit rules), which
 * the sandbox does not wrap. The rails stay as defense in depth.
 */

export type AgentSandboxContext = {
  agentId: string
  homeDir: string
  userDataDir: string
  /** Claude config dir of the run's account; its settings files are protected too. */
  claudeConfigDir?: string | null
  /** Every entry of ~/.dobius/agents except the run's own agent (includes `_crew`). */
  otherAgentEntries: readonly string[]
  /** Scratch roots Bash may write besides the home folder. */
  tempDirs: readonly string[]
}

// Exactly the two SDK query options this module owns.
export type AgentRunSandboxPolicy = Required<Pick<Options, 'sandbox' | 'disallowedTools'>>

// Same rule as agent-identity-files: an id is one plain path segment.
const SAFE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

// userData folders that hold credentials, auth snapshots, the pty daemon token
// or browser cookies. Nothing an agent does needs to read them.
const USER_DATA_SECRET_DIRS = [
  'claude-accounts',
  'claude-runtime-auth',
  'codex-accounts',
  'codex-runtime-home',
  'daemon',
  'Partitions',
  'Cookies',
  'Network',
  'cookie-import-staging'
]

const CLAUDE_SETTINGS_FILES = ['settings.json', 'settings.local.json']

function agentsRoot(homeDir: string): string {
  return path.join(homeDir, '.dobius', 'agents')
}

// Permission rules take an absolute path as `//abs/path`.
function absoluteRule(tool: 'Read' | 'Edit', target: string): string {
  return `${tool}(/${target})`
}

export function buildAgentRunSandboxPolicy(context: AgentSandboxContext): AgentRunSandboxPolicy {
  if (!SAFE_AGENT_ID.test(context.agentId)) {
    throw new Error(`Agent sandbox: invalid agent id ${context.agentId}`)
  }
  const home = context.homeDir
  const dobiusDir = path.join(home, '.dobius')
  const agents = agentsRoot(home)
  const ownAgentDir = path.join(agents, context.agentId)
  const otherAgentDirs = context.otherAgentEntries
    .filter((entry) => entry !== context.agentId)
    .map((entry) => path.join(agents, entry))
  const configDirs = [...new Set([path.join(home, '.claude'), context.claudeConfigDir ?? ''])]
    .filter((dir) => path.isAbsolute(dir))
  const credentialFiles = configDirs.map((dir) => path.join(dir, '.credentials*'))
  const secretFileGlobs = [
    path.join(dobiusDir, '*.enc'),
    path.join(dobiusDir, '**', '*.enc'),
    path.join(dobiusDir, '*token*'),
    path.join(dobiusDir, '*token*', '**')
  ]
  const secretDirs = [
    path.join(home, 'Library', 'Messages'),
    ...USER_DATA_SECRET_DIRS.map((dir) => path.join(context.userDataDir, dir))
  ]
  // Why: a settings file the agent can write re-opens any denied region on the
  // next load (a `sandbox.filesystem.allowRead` entry merges in from every
  // settings source), and settings hooks run outside the sandbox.
  const settingsFiles = [
    ...configDirs.flatMap((dir) =>
      [...CLAUDE_SETTINGS_FILES, '.claude.json'].map((name) => path.join(dir, name))
    ),
    path.join(home, '.claude.json')
  ]
  const dobiusLaunchers = path.join(home, '.local', 'bin', 'dobius-*')
  const applications = '/Applications'

  const sandbox: SandboxSettings = {
    enabled: true,
    // Fail closed: a platform that cannot sandbox ends the run instead of
    // running its commands unconfined.
    failIfUnavailable: true,
    // Keep the existing permission flow; sandboxing is not an approval.
    autoAllowBashIfSandboxed: false,
    // No `dangerouslyDisableSandbox` escape hatch, even in bypass mode.
    allowUnsandboxedCommands: false,
    filesystem: {
      // The whole agents folder is denied (agents created mid-run included);
      // allowRead re-opens only this run's own folder.
      denyRead: [agents, ...credentialFiles, ...secretFileGlobs, ...secretDirs],
      allowRead: [ownAgentDir],
      // Why: without this, Bash may only write the cwd — npm/pnpm caches,
      // sibling git worktrees and the agent's own folder would all break.
      allowWrite: [home, ...context.tempDirs],
      denyWrite: [
        ...otherAgentDirs,
        dobiusLaunchers,
        applications,
        ...settingsFiles,
        ...secretDirs
      ]
    },
    network: {
      // Egress goes through the sandbox proxy; '*' keeps every public host
      // (git remotes, registries, curl) reachable as before.
      allowedDomains: ['*'],
      // The dobius CLI, ssh-agent and docker talk over unix sockets; test
      // runners and dev servers bind localhost ports.
      allowAllUnixSockets: true,
      allowLocalBinding: true
    }
  }

  const disallowedTools = [
    ...otherAgentDirs.flatMap((dir) => [
      absoluteRule('Read', path.join(dir, '**')),
      absoluteRule('Edit', path.join(dir, '**'))
    ]),
    ...[...credentialFiles, ...secretFileGlobs].map((target) => absoluteRule('Read', target)),
    ...secretDirs.map((dir) => absoluteRule('Read', path.join(dir, '**'))),
    absoluteRule('Edit', dobiusLaunchers),
    absoluteRule('Edit', path.join(applications, '**')),
    ...settingsFiles.map((file) => absoluteRule('Edit', file)),
    // The run's project (and nested projects) settings files.
    ...CLAUDE_SETTINGS_FILES.map((name) => `Edit(**/.claude/${name})`)
  ]

  return { sandbox, disallowedTools }
}

function listAgentsRoot(homeDir: string): string[] {
  try {
    return readdirSync(agentsRoot(homeDir))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    // Fail closed: an unreadable agents folder must not start an unconfined run.
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Agent sandbox: cannot list the agents folder (${detail})`)
  }
}

function scratchDirs(): string[] {
  const dirs = [os.tmpdir()]
  if (process.platform !== 'win32') {
    dirs.push('/tmp', '/private/tmp')
  }
  return [...new Set(dirs)]
}

export function resolveAgentRunSandboxPolicy(
  agentId: string,
  claudeConfigDir?: string | null
): AgentRunSandboxPolicy {
  const homeDir = os.homedir()
  return buildAgentRunSandboxPolicy({
    agentId,
    homeDir,
    userDataDir: getUserDataRoot(),
    claudeConfigDir,
    otherAgentEntries: listAgentsRoot(homeDir).filter((entry) => entry !== agentId),
    tempDirs: scratchDirs()
  })
}
