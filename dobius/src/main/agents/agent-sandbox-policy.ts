import path from 'node:path'
import type { Options, SandboxSettings } from '@anthropic-ai/claude-agent-sdk'

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
  /** Claude config dir of the run's account; its settings and hooks are protected too. */
  claudeConfigDir?: string | null
  /** The run's working folder. */
  cwd: string
  /** The cwd repo's top level and git common dir (worktree commits write there). */
  gitDirs: readonly string[]
  /** Every entry of ~/.dobius/agents except the run's own agent (includes `_crew`). */
  otherAgentEntries: readonly string[]
  /** Every entry of ~/.dobius except the agents folder (hooks, tokens, stores). */
  dobiusEntries: readonly string[]
  /** Scratch roots Bash may write. */
  tempDirs: readonly string[]
  /** The Claude CLI install and the PATH folders: whatever lands there runs unsandboxed later. */
  executableDirs: readonly string[]
}

// Exactly the SDK query options this module owns.
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

// Package-manager and tool caches under home that installs and builds write.
const HOME_CACHE_DIRS = [
  '.npm',
  '.pnpm-store',
  'Library/pnpm',
  'Library/Caches',
  '.cache',
  '.bun',
  '.yarn'
]

// Files the shell, git, npm or ssh execute or obey on a later, unsandboxed run.
const HOME_STARTUP_FILES = [
  '.zshrc',
  '.zshenv',
  '.zprofile',
  '.zlogin',
  '.zlogout',
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.bash_logout',
  '.bash_aliases',
  '.profile',
  '.gitconfig',
  '.config/git',
  '.config/fish',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.ssh',
  '.local/bin',
  'Library/LaunchAgents',
  '.claude.json'
]

// Inside a Claude config dir: settings (hooks, sandbox allowRead), hook
// scripts, and everything loaded as instructions or tools. `projects/` (the
// CLI's own transcripts and memory) is left alone.
const CLAUDE_CONFIG_PROTECTED = [
  'settings.json',
  'settings.local.json',
  'CLAUDE.md',
  '.claude.json',
  'hooks',
  'skills',
  'skill-repos',
  'plugins',
  'agents',
  'commands',
  'output-styles'
]

// Permission rules take `~/path` under home and `//abs/path` elsewhere. Why:
// an absolute rule whose path has both a space and parentheses (a home under
// "Projects (Code)" holding "Application Support") silently never matches.
function ruleFor(homeDir: string) {
  return (tool: 'Read' | 'Edit', target: string): string => {
    const relative = path.relative(homeDir, target)
    const underHome = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
    return underHome ? `${tool}(~/${relative})` : `${tool}(/${target})`
  }
}

function hasGlob(target: string): boolean {
  return /[*?[]/.test(target)
}

export function buildAgentRunSandboxPolicy(context: AgentSandboxContext): AgentRunSandboxPolicy {
  if (!SAFE_AGENT_ID.test(context.agentId)) {
    throw new Error(`Agent sandbox: invalid agent id ${context.agentId}`)
  }
  const home = context.homeDir
  const absoluteRule = ruleFor(home)
  // A folder needs its own rule and a `/**` rule; a glob is already a pattern.
  const editRules = (target: string): string[] =>
    hasGlob(target)
      ? [absoluteRule('Edit', target)]
      : [absoluteRule('Edit', target), absoluteRule('Edit', path.join(target, '**'))]
  const dobiusDir = path.join(home, '.dobius')
  const agents = path.join(dobiusDir, 'agents')
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

  // Why: Bash writes are an allowlist. A home-wide grant let an agent plant
  // code that runs outside the sandbox later (Claude hook scripts, settings
  // `hooks`/`allowRead` in any project, shell rc files, git config, PATH).
  const writable = [
    context.cwd,
    ...context.gitDirs,
    ownAgentDir,
    ...context.tempDirs,
    ...HOME_CACHE_DIRS.map((dir) => path.join(home, dir))
  ]
  // Denied even where a grant above (or a cwd of home) would cover them, and
  // mirrored as Edit rules because Write/Edit are not sandboxed.
  const protectedWrites = [
    ...otherAgentDirs,
    ...context.dobiusEntries.map((entry) => path.join(dobiusDir, entry)),
    context.userDataDir,
    path.join(home, 'Library', 'Messages'),
    ...configDirs.flatMap((dir) => CLAUDE_CONFIG_PROTECTED.map((name) => path.join(dir, name))),
    path.join(home, '**', '.claude', 'settings*.json'),
    path.join(home, '**', '.mcp.json'),
    ...HOME_STARTUP_FILES.map((name) => path.join(home, name)),
    '/Applications',
    ...context.executableDirs
  ]

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
      // The whole agents folder (and its backups) is denied, agents created
      // mid-run included; allowRead re-opens only this run's own folder.
      denyRead: [
        agents,
        path.join(dobiusDir, 'agents-*'),
        ...credentialFiles,
        ...secretFileGlobs,
        ...secretDirs
      ],
      allowRead: [ownAgentDir],
      allowWrite: [...new Set(writable)],
      denyWrite: [...new Set(protectedWrites)]
    },
    network: {
      // '*' leaves egress unrestricted (proxied or direct): git remotes over
      // https and ssh, registries and curl keep working.
      allowedDomains: ['*'],
      // The dobius CLI, ssh-agent and docker talk over unix sockets; test
      // runners and dev servers bind localhost ports.
      allowAllUnixSockets: true,
      allowLocalBinding: true
    }
  }

  const disallowedTools = [
    ...otherAgentDirs.map((dir) => absoluteRule('Read', path.join(dir, '**'))),
    absoluteRule('Read', path.join(dobiusDir, 'agents-*', '**')),
    ...[...credentialFiles, ...secretFileGlobs].map((target) => absoluteRule('Read', target)),
    ...secretDirs.map((dir) => absoluteRule('Read', path.join(dir, '**'))),
    ...[...new Set(protectedWrites)].flatMap(editRules),
    // The run's project (and nested projects) settings files.
    'Edit(**/.claude/settings.json)',
    'Edit(**/.claude/settings.local.json)',
    'Edit(**/.mcp.json)',
    // Keychain secrets (the Claude OAuth token lives there on macOS).
    ...['find-generic-password', 'find-internet-password', 'dump-keychain', 'export'].map(
      (sub) => `Bash(security ${sub}:*)`
    )
  ]

  return { sandbox, disallowedTools }
}
