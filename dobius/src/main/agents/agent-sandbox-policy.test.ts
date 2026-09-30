import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAgentRunSandboxPolicy, type AgentSandboxContext } from './agent-sandbox-policy'

const HOME = '/home/carson'
const USER_DATA = '/home/carson/Library/Application Support/dobius-plus'
const AGENTS = `${HOME}/.dobius/agents`

function context(overrides: Partial<AgentSandboxContext> = {}): AgentSandboxContext {
  return {
    agentId: 'atlas',
    homeDir: HOME,
    userDataDir: USER_DATA,
    claudeConfigDir: null,
    cwd: `${HOME}/code/repo-worktrees/feature`,
    gitDirs: [`${HOME}/code/repo-worktrees/feature`, `${HOME}/code/repo/.git`],
    otherAgentEntries: ['nova', '_crew'],
    dobiusEntries: ['agent-hooks', 'asana-token.enc', 'agents-config.json'],
    tempDirs: ['/tmp', '/private/var/folders'],
    executableDirs: [
      `${HOME}/.local/bin`,
      `${HOME}/.hermes/node/lib/node_modules/@anthropic-ai/claude-code`
    ],
    ...overrides
  }
}

// Expected permission-rule spelling: `~/rel` under home, `//abs` elsewhere.
function rule(tool: 'Read' | 'Edit', target: string): string {
  return target.startsWith(`${HOME}/`)
    ? `${tool}(~/${target.slice(HOME.length + 1)})`
    : `${tool}(/${target})`
}

function isWithin(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

describe('buildAgentRunSandboxPolicy', () => {
  it('turns the sandbox on with no way around it', () => {
    const { sandbox } = buildAgentRunSandboxPolicy(context())
    expect(sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false
    })
  })

  it("denies the agents folder and re-opens only the run's own agent folder", () => {
    const { sandbox, disallowedTools } = buildAgentRunSandboxPolicy(context())
    expect(sandbox.filesystem?.denyRead).toContain(AGENTS)
    expect(sandbox.filesystem?.allowRead).toEqual([`${AGENTS}/atlas`])
    expect(sandbox.filesystem?.denyWrite).not.toContain(`${AGENTS}/atlas`)
    expect(disallowedTools.some((rule) => rule.includes(`${AGENTS}/atlas`))).toBe(false)
  })

  it("denies reading and writing every other agent's folder, including the shared crew folder", () => {
    const { sandbox, disallowedTools } = buildAgentRunSandboxPolicy(context())
    for (const other of ['nova', '_crew']) {
      expect(sandbox.filesystem?.denyWrite).toContain(`${AGENTS}/${other}`)
      expect(disallowedTools).toContain(rule('Read', `${AGENTS}/${other}/**`))
      expect(disallowedTools).toContain(rule('Edit', `${AGENTS}/${other}/**`))
    }
  })

  it('never lists the own agent as "other", even if the caller passes it', () => {
    const { sandbox } = buildAgentRunSandboxPolicy(
      context({ otherAgentEntries: ['atlas', 'nova'] })
    )
    expect(sandbox.filesystem?.denyWrite).not.toContain(`${AGENTS}/atlas`)
    expect(sandbox.filesystem?.denyWrite).toContain(`${AGENTS}/nova`)
  })

  it('denies Claude credentials in the home config and in the account config dir', () => {
    const { sandbox, disallowedTools } = buildAgentRunSandboxPolicy(
      context({ claudeConfigDir: '/accounts/work/.claude' })
    )
    for (const file of [`${HOME}/.claude/.credentials*`, '/accounts/work/.claude/.credentials*']) {
      expect(sandbox.filesystem?.denyRead).toContain(file)
      expect(disallowedTools).toContain(rule('Read', file))
    }
  })

  it('denies Messages, Dobius tokens, runtime credentials and userData secret folders', () => {
    const { sandbox, disallowedTools } = buildAgentRunSandboxPolicy(context())
    const denyRead = sandbox.filesystem?.denyRead ?? []
    expect(denyRead).toEqual(
      expect.arrayContaining([
        `${HOME}/Library/Messages`,
        `${HOME}/.dobius/*.enc`,
        `${HOME}/.dobius/**/*.enc`,
        `${HOME}/.dobius/*token*`,
        `${USER_DATA}/dobius-runtime.json*`,
        `${USER_DATA}/dobius-devices.json*`,
        `${USER_DATA}/dobius-e2ee-keypair.json*`,
        `${USER_DATA}/dobius-cli-token*`,
        `${USER_DATA}/voice-conductor-cli-token*`,
        `${USER_DATA}/claude-accounts`,
        `${USER_DATA}/codex-accounts`,
        `${USER_DATA}/daemon`,
        `${USER_DATA}/Partitions`
      ])
    )
    expect(disallowedTools).toContain(rule('Read', `${HOME}/Library/Messages/**`))
    expect(disallowedTools).toContain(rule('Read', `${USER_DATA}/claude-accounts/**`))
    expect(disallowedTools).toContain(rule('Read', `${USER_DATA}/dobius-runtime.json*`))
  })

  it('lets only the conductor read its scoped broker token', () => {
    const conductor = buildAgentRunSandboxPolicy(context({ runProfile: 'voice-conductor' }))
    const regular = buildAgentRunSandboxPolicy(context())
    const token = `${USER_DATA}/voice-conductor-cli-token*`
    expect(conductor.sandbox.filesystem?.denyRead).not.toContain(token)
    expect(conductor.disallowedTools).not.toContain(rule('Read', token))
    expect(regular.sandbox.filesystem?.denyRead).toContain(token)
    expect(regular.disallowedTools).toContain(rule('Read', token))
  })

  it('lets Bash write only the cwd, the repo git dirs, the own agent folder, temp and caches', () => {
    const { sandbox } = buildAgentRunSandboxPolicy(context())
    const allowWrite = sandbox.filesystem?.allowWrite ?? []
    const denyWrite = sandbox.filesystem?.denyWrite ?? []
    const writable = (target: string) =>
      allowWrite.some((root) => isWithin(target, root)) &&
      !denyWrite.some((root) => isWithin(target, root))
    expect(allowWrite).not.toContain(HOME)
    for (const target of [
      `${HOME}/code/repo-worktrees/feature/src/a.ts`,
      `${HOME}/code/repo/.git/objects/ab`,
      `${HOME}/.npm/_cacache`,
      `${HOME}/.pnpm-store/v3`,
      `${HOME}/Library/pnpm/store`,
      `${HOME}/Library/Caches/node-gyp`,
      `${HOME}/.cache/corepack`,
      `${AGENTS}/atlas/MEMORY.md`,
      '/tmp/build',
      '/private/var/folders/xy/T/vitest'
    ]) {
      expect(writable(target)).toBe(true)
    }
    for (const target of [
      `${HOME}/otherproj/src/a.ts`,
      `${HOME}/.zshrc`,
      `${HOME}/.dobius/agent-hooks/claude-hook.sh`,
      `${HOME}/Library/LaunchAgents/x.plist`
    ]) {
      expect(writable(target)).toBe(false)
    }
  })

  it('protects everything that later runs outside the sandbox, for Bash and for Write/Edit', () => {
    const { sandbox, disallowedTools } = buildAgentRunSandboxPolicy(
      context({ claudeConfigDir: '/accounts/work/.claude' })
    )
    const protectedTargets = [
      `${HOME}/.dobius/agent-hooks`,
      `${HOME}/.dobius/agents-config.json`,
      USER_DATA,
      `${HOME}/.claude/settings.json`,
      `${HOME}/.claude/hooks`,
      `${HOME}/.claude/skills`,
      `${HOME}/.claude/CLAUDE.md`,
      '/accounts/work/.claude/settings.json',
      '/accounts/work/.claude/hooks',
      `${HOME}/.claude.json`,
      `${HOME}/.zshrc`,
      `${HOME}/.bash_profile`,
      `${HOME}/.profile`,
      `${HOME}/.gitconfig`,
      `${HOME}/.config/git`,
      `${HOME}/.ssh`,
      `${HOME}/.npmrc`,
      `${HOME}/.local/bin`,
      `${HOME}/Library/LaunchAgents`,
      `${HOME}/.hermes/node/lib/node_modules/@anthropic-ai/claude-code`,
      '/Applications'
    ]
    for (const target of protectedTargets) {
      expect(sandbox.filesystem?.denyWrite).toContain(target)
      expect(disallowedTools).toContain(rule('Edit', target))
      expect(disallowedTools).toContain(rule('Edit', `${target}/**`))
    }
    for (const glob of [`${HOME}/**/.claude/settings*.json`, `${HOME}/**/.mcp.json`]) {
      expect(sandbox.filesystem?.denyWrite).toContain(glob)
      expect(disallowedTools).toContain(rule('Edit', glob))
    }
    expect(disallowedTools).toEqual(
      expect.arrayContaining([
        'Edit(**/.claude/settings.json)',
        'Edit(**/.claude/settings.local.json)',
        'Edit(**/.mcp.json)'
      ])
    )
    // The CLI's own transcripts and memory stay writable for the file tools.
    expect(disallowedTools.some((rule) => rule.includes('/.claude/projects'))).toBe(false)
  })

  it('refuses the keychain secret-printing security subcommands', () => {
    const { disallowedTools } = buildAgentRunSandboxPolicy(context())
    expect(disallowedTools).toEqual(
      expect.arrayContaining([
        'Bash(security find-generic-password:*)',
        'Bash(security find-internet-password:*)',
        'Bash(security dump-keychain:*)',
        'Bash(security export:*)'
      ])
    )
  })

  it('denies reading agent-folder backups', () => {
    const { sandbox, disallowedTools } = buildAgentRunSandboxPolicy(context())
    expect(sandbox.filesystem?.denyRead).toContain(`${HOME}/.dobius/agents-*`)
    expect(disallowedTools).toContain(rule('Read', `${HOME}/.dobius/agents-*/**`))
  })

  it('keeps every public host reachable and unix sockets / local ports usable', () => {
    const { sandbox } = buildAgentRunSandboxPolicy(context())
    expect(sandbox.network).toEqual({
      allowedDomains: ['*'],
      allowAllUnixSockets: true,
      allowLocalBinding: true
    })
  })

  it('spells rules under home as ~/ paths and others as //absolute paths', () => {
    const { disallowedTools } = buildAgentRunSandboxPolicy(
      context({ claudeConfigDir: '/accounts/work/.claude' })
    )
    expect(disallowedTools).toContain('Edit(~/Library/Application Support/dobius-plus/**)')
    expect(disallowedTools).toContain('Read(~/.dobius/agents/nova/**)')
    expect(disallowedTools).toContain('Edit(//accounts/work/.claude/hooks/**)')
    expect(disallowedTools).toContain('Edit(//Applications/**)')
    expect(disallowedTools.some((entry) => entry.includes(`(/${HOME}`))).toBe(false)
  })

  it('rejects an agent id that is not a single safe path segment', () => {
    expect(() => buildAgentRunSandboxPolicy(context({ agentId: '../nova' }))).toThrow(
      /invalid agent id/
    )
  })
})
