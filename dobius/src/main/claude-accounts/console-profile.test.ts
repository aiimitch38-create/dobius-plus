import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ClaudeManagedAccount, CodexManagedAccount } from '../../shared/types'
import {
  ensureConsoleProfile,
  getConsoleProfileDir,
  prepareConsoleAccountLaunch,
  type ConsoleProfileDeps
} from './console-profile'

let root: string

function claudeAccount(overrides: Partial<ClaudeManagedAccount> = {}): ClaudeManagedAccount {
  return {
    id: 'acct-1',
    email: 'me@example.com',
    managedAuthPath: '/unused',
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...overrides
  }
}

function codexAccount(overrides: Partial<CodexManagedAccount> = {}): CodexManagedAccount {
  return {
    id: 'cx-1',
    email: 'cx@example.com',
    managedHomePath: '/unused',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...overrides
  }
}

function deps(overrides: Partial<ConsoleProfileDeps> = {}): ConsoleProfileDeps {
  return {
    profilesRoot: join(root, 'profiles'),
    sharedConfigDir: (agent) => join(root, agent === 'claude' ? 'dot-claude' : 'dot-codex'),
    getClaudeAccounts: () => [claudeAccount()],
    getCodexAccounts: () => [codexAccount()],
    platform: 'darwin',
    ...overrides
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'console-profile-test-'))
  mkdirSync(join(root, 'dot-claude', 'skills'), { recursive: true })
  writeFileSync(join(root, 'dot-claude', 'settings.json'), '{"hooks":{}}')
  writeFileSync(
    join(root, 'dot-claude', '.claude.json'),
    '{"oauthAccount":{"emailAddress":"global@x"}}'
  )
  mkdirSync(join(root, 'dot-codex'), { recursive: true })
  writeFileSync(join(root, 'dot-codex', 'config.toml'), 'model = "x"\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('getConsoleProfileDir', () => {
  it('keeps profiles under the root and rejects traversal', () => {
    expect(getConsoleProfileDir('/r', 'claude', 'abc')).toBe('/r/claude/abc')
    expect(() => getConsoleProfileDir('/r', 'claude', '..')).toThrow()
    expect(() => getConsoleProfileDir('/r', 'codex', 'a/../../x')).toThrow()
  })
})

describe('ensureConsoleProfile', () => {
  it('links only shared non-credential config', () => {
    const dir = ensureConsoleProfile(deps(), 'claude', 'acct-1')
    expect(readlinkSync(join(dir, 'settings.json'))).toBe(join(root, 'dot-claude', 'settings.json'))
    expect(lstatSync(join(dir, 'skills')).isSymbolicLink()).toBe(true)
    // Identity/credential files stay per-profile and are never linked.
    expect(existsSync(join(dir, '.claude.json'))).toBe(false)
    expect(existsSync(join(dir, '.credentials.json'))).toBe(false)
    expect(readFileSync(join(dir, '.dobius-console-profile'), 'utf-8')).toBe('acct-1\n')
  })

  it('never overwrites an existing entry and is idempotent', () => {
    const dir = getConsoleProfileDir(join(root, 'profiles'), 'claude', 'acct-1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), 'mine')
    ensureConsoleProfile(deps(), 'claude', 'acct-1')
    ensureConsoleProfile(deps(), 'claude', 'acct-1')
    expect(readFileSync(join(dir, 'settings.json'), 'utf-8')).toBe('mine')
  })

  it('refuses a profile path that is a symlink', () => {
    const target = join(root, 'elsewhere')
    mkdirSync(target)
    mkdirSync(join(root, 'profiles', 'claude'), { recursive: true })
    symlinkSync(target, join(root, 'profiles', 'claude', 'acct-1'))
    expect(() => ensureConsoleProfile(deps(), 'claude', 'acct-1')).toThrow(/symlink/)
  })
})

describe('prepareConsoleAccountLaunch', () => {
  it('returns a Claude profile that needs a first sign-in', () => {
    const launch = prepareConsoleAccountLaunch(deps(), { agent: 'claude', accountId: 'acct-1' })
    expect(launch).toMatchObject({
      agent: 'claude',
      accountId: 'acct-1',
      accountEmail: 'me@example.com',
      envVar: 'CLAUDE_CONFIG_DIR',
      configDir: join(root, 'profiles', 'claude', 'acct-1'),
      signedIn: false,
      signedInEmail: null
    })
  })

  it('reports the email Claude recorded in the profile', () => {
    const dir = ensureConsoleProfile(deps(), 'claude', 'acct-1')
    writeFileSync(join(dir, '.claude.json'), '{"oauthAccount":{"emailAddress":"me@example.com"}}')
    const launch = prepareConsoleAccountLaunch(deps(), { agent: 'claude', accountId: 'acct-1' })
    expect(launch.signedIn).toBe(true)
    expect(launch.signedInEmail).toBe('me@example.com')
  })

  it('detects Codex sign-in by existence only, without opening auth.json', () => {
    const dir = ensureConsoleProfile(deps(), 'codex', 'cx-1')
    const authPath = join(dir, 'auth.json')
    writeFileSync(authPath, 'placeholder')
    chmodSync(authPath, 0o000)
    const launch = prepareConsoleAccountLaunch(deps(), { agent: 'codex', accountId: 'cx-1' })
    chmodSync(authPath, 0o600)
    expect(launch).toMatchObject({ envVar: 'CODEX_HOME', signedIn: true, signedInEmail: null })
    expect(lstatSync(join(dir, 'config.toml')).isSymbolicLink()).toBe(true)
  })

  it('rejects unknown, WSL, wrong-agent, and Windows requests', () => {
    expect(() =>
      prepareConsoleAccountLaunch(deps(), { agent: 'claude', accountId: 'missing' })
    ).toThrow(/no longer exists/)
    expect(() =>
      prepareConsoleAccountLaunch(
        deps({ getClaudeAccounts: () => [claudeAccount({ managedAuthRuntime: 'wsl' })] }),
        { agent: 'claude', accountId: 'acct-1' }
      )
    ).toThrow(/host accounts/)
    expect(() =>
      prepareConsoleAccountLaunch(deps(), { agent: 'gemini' as 'claude', accountId: 'acct-1' })
    ).toThrow()
    expect(() =>
      prepareConsoleAccountLaunch(deps({ platform: 'win32' }), {
        agent: 'claude',
        accountId: 'acct-1'
      })
    ).toThrow(/Windows/)
    expect(existsSync(join(root, 'profiles'))).toBe(false)
  })
})
