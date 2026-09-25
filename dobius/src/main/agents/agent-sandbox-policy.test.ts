import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ userDataRoot: '' }))
vi.mock('../storage/user-data-root', () => ({ getUserDataRoot: () => mocks.userDataRoot }))

import {
  buildAgentRunSandboxPolicy,
  resolveAgentRunSandboxPolicy,
  type AgentSandboxContext
} from './agent-sandbox-policy'

const HOME = '/home/carson'
const USER_DATA = '/home/carson/Library/Application Support/dobius-plus'
const AGENTS = `${HOME}/.dobius/agents`

function context(overrides: Partial<AgentSandboxContext> = {}): AgentSandboxContext {
  return {
    agentId: 'atlas',
    homeDir: HOME,
    userDataDir: USER_DATA,
    claudeConfigDir: null,
    otherAgentEntries: ['nova', '_crew'],
    tempDirs: ['/tmp'],
    ...overrides
  }
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
      expect(disallowedTools).toContain(`Read(/${AGENTS}/${other}/**)`)
      expect(disallowedTools).toContain(`Edit(/${AGENTS}/${other}/**)`)
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
      expect(disallowedTools).toContain(`Read(/${file})`)
    }
  })

  it('denies Messages, Dobius token files and the userData secret folders', () => {
    const { sandbox, disallowedTools } = buildAgentRunSandboxPolicy(context())
    const denyRead = sandbox.filesystem?.denyRead ?? []
    expect(denyRead).toEqual(
      expect.arrayContaining([
        `${HOME}/Library/Messages`,
        `${HOME}/.dobius/*.enc`,
        `${HOME}/.dobius/**/*.enc`,
        `${HOME}/.dobius/*token*`,
        `${USER_DATA}/claude-accounts`,
        `${USER_DATA}/codex-accounts`,
        `${USER_DATA}/daemon`,
        `${USER_DATA}/Partitions`
      ])
    )
    expect(disallowedTools).toContain(`Read(/${HOME}/Library/Messages/**)`)
    expect(disallowedTools).toContain(`Read(/${USER_DATA}/claude-accounts/**)`)
    // The runtime file the dobius CLI needs stays readable.
    expect(denyRead.some((entry) => isWithin(`${USER_DATA}/dobius-runtime.json`, entry))).toBe(
      false
    )
  })

  it('keeps the working folder, caches and temp writable', () => {
    const { sandbox } = buildAgentRunSandboxPolicy(context())
    const allowWrite = sandbox.filesystem?.allowWrite ?? []
    const denyWrite = sandbox.filesystem?.denyWrite ?? []
    for (const target of [
      `${HOME}/code/repo`,
      `${HOME}/code/repo-worktrees/feature`,
      `${HOME}/.npm/_cacache`,
      `${HOME}/Library/Caches/pnpm`,
      `${AGENTS}/atlas/MEMORY.md`,
      '/tmp/build'
    ]) {
      expect(allowWrite.some((root) => isWithin(target, root))).toBe(true)
      expect(denyWrite.some((root) => isWithin(target, root))).toBe(false)
    }
  })

  it('denies writes to dobius launchers, /Applications and Claude settings files', () => {
    const { sandbox, disallowedTools } = buildAgentRunSandboxPolicy(context())
    expect(sandbox.filesystem?.denyWrite).toEqual(
      expect.arrayContaining([
        `${HOME}/.local/bin/dobius-*`,
        '/Applications',
        `${HOME}/.claude/settings.json`,
        `${HOME}/.claude/settings.local.json`,
        `${HOME}/.claude.json`
      ])
    )
    expect(disallowedTools).toEqual(
      expect.arrayContaining([
        `Edit(/${HOME}/.local/bin/dobius-*)`,
        'Edit(//Applications/**)',
        `Edit(/${HOME}/.claude/settings.json)`,
        'Edit(**/.claude/settings.json)',
        'Edit(**/.claude/settings.local.json)'
      ])
    )
  })

  it('keeps every public host reachable and unix sockets / local ports usable', () => {
    const { sandbox } = buildAgentRunSandboxPolicy(context())
    expect(sandbox.network).toEqual({
      allowedDomains: ['*'],
      allowAllUnixSockets: true,
      allowLocalBinding: true
    })
  })

  it('rejects an agent id that is not a single safe path segment', () => {
    expect(() => buildAgentRunSandboxPolicy(context({ agentId: '../nova' }))).toThrow(
      /invalid agent id/
    )
  })
})

describe('resolveAgentRunSandboxPolicy', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'dobius-sbx-'))
    vi.spyOn(os, 'homedir').mockReturnValue(home)
    mocks.userDataRoot = path.join(home, 'user-data')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(home, { recursive: true, force: true })
  })

  it('lists the other agents from the agents folder on disk', () => {
    for (const id of ['atlas', 'nova', '_crew']) {
      mkdirSync(path.join(home, '.dobius', 'agents', id), { recursive: true })
    }
    const { sandbox } = resolveAgentRunSandboxPolicy('atlas')
    const agents = path.join(home, '.dobius', 'agents')
    expect(sandbox.filesystem?.denyWrite).toEqual(
      expect.arrayContaining([path.join(agents, 'nova'), path.join(agents, '_crew')])
    )
    expect(sandbox.filesystem?.denyWrite).not.toContain(path.join(agents, 'atlas'))
    expect(sandbox.filesystem?.denyRead).toContain(
      path.join(mocks.userDataRoot, 'claude-accounts')
    )
    expect(sandbox.filesystem?.allowWrite).toContain(os.tmpdir())
  })

  it('treats a missing agents folder as no other agents', () => {
    const { sandbox } = resolveAgentRunSandboxPolicy('atlas')
    expect(sandbox.filesystem?.denyRead).toContain(path.join(home, '.dobius', 'agents'))
  })

  it('fails closed when the agents folder cannot be listed', () => {
    mkdirSync(path.join(home, '.dobius'), { recursive: true })
    writeFileSync(path.join(home, '.dobius', 'agents'), 'not a folder')
    expect(() => resolveAgentRunSandboxPolicy('atlas')).toThrow(/cannot list the agents folder/)
  })
})
