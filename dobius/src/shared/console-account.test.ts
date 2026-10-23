import { describe, expect, it } from 'vitest'
import {
  buildPinnedAgentCommand,
  consoleAccountEnvVar,
  isConsoleAccountAgent,
  isSafeConsoleAccountId,
  pinnedAccountMismatch,
  stripPinnedAgentPrefix,
  supportsConsoleAccountPin,
  type ConsoleAccountLaunch
} from './console-account'

describe('console account helpers', () => {
  it('maps each CLI to its config-dir env var', () => {
    expect(consoleAccountEnvVar('claude')).toBe('CLAUDE_CONFIG_DIR')
    expect(consoleAccountEnvVar('codex')).toBe('CODEX_HOME')
    expect(isConsoleAccountAgent('gemini')).toBe(false)
    expect(isConsoleAccountAgent(null)).toBe(false)
  })

  it('accepts uuid-like account ids and rejects path tricks', () => {
    expect(isSafeConsoleAccountId('3f2b9c1e-aaaa-4bbb-8ccc-123456789abc')).toBe(true)
    expect(isSafeConsoleAccountId('../etc')).toBe(false)
    expect(isSafeConsoleAccountId('a/b')).toBe(false)
    expect(isSafeConsoleAccountId('')).toBe(false)
    expect(isSafeConsoleAccountId(42)).toBe(false)
  })

  it('only offers pinning on local POSIX hosts', () => {
    expect(supportsConsoleAccountPin('darwin', false)).toBe(true)
    expect(supportsConsoleAccountPin('linux', false)).toBe(true)
    expect(supportsConsoleAccountPin('win32', false)).toBe(false)
    expect(supportsConsoleAccountPin('darwin', true)).toBe(false)
  })

  it('prefixes the base command with a quoted inline assignment', () => {
    expect(buildPinnedAgentCommand('claude', 'CLAUDE_CONFIG_DIR', '/Users/me/App Data/p')).toBe(
      "CLAUDE_CONFIG_DIR='/Users/me/App Data/p' claude"
    )
    expect(buildPinnedAgentCommand('codex --yolo', 'CODEX_HOME', "/tmp/it's")).toBe(
      "CODEX_HOME='/tmp/it'\\''s' codex --yolo"
    )
  })

  it('never stacks prefixes when re-pinning', () => {
    const once = buildPinnedAgentCommand('claude', 'CLAUDE_CONFIG_DIR', "/a/it's")
    const twice = buildPinnedAgentCommand(once, 'CLAUDE_CONFIG_DIR', '/b')
    expect(twice).toBe("CLAUDE_CONFIG_DIR='/b' claude")
    expect(stripPinnedAgentPrefix('FOO=1 claude')).toBe('FOO=1 claude')
  })

  it('flags a profile signed in as someone else', () => {
    const launch: ConsoleAccountLaunch = {
      agent: 'claude',
      accountId: 'a1',
      accountEmail: 'Me@Example.com',
      envVar: 'CLAUDE_CONFIG_DIR',
      configDir: '/p',
      signedIn: true,
      signedInEmail: 'me@example.com'
    }
    expect(pinnedAccountMismatch(launch)).toBe(false)
    expect(pinnedAccountMismatch({ ...launch, signedInEmail: 'other@example.com' })).toBe(true)
    expect(pinnedAccountMismatch({ ...launch, signedInEmail: null })).toBe(false)
  })
})
