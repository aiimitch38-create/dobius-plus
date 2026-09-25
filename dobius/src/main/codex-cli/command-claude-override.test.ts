// X9: the Settings > Agents > Claude "Command" override is an explicit user
// choice and must beat the DOBIUS_CLAUDE_CLI_PATH env var for headless Claude
// spawns. Precedence: caller override > Settings override > env var > scan.

import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveClaudeCommand, setClaudeSettingsOverrideReader } from './command'

function makeExecutable(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
  chmodSync(path, 0o755)
}

function emptyHome(): string {
  return mkdtempSync(join(tmpdir(), 'dobius-claude-override-'))
}

describe('resolveClaudeCommand — Settings override vs DOBIUS_CLAUDE_CLI_PATH', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    setClaudeSettingsOverrideReader(null)
    vi.unstubAllEnvs()
    warnSpy.mockRestore()
  })

  it('uses the Settings override over the env var, and says so', () => {
    vi.stubEnv('DOBIUS_CLAUDE_CLI_PATH', '/env/claude')
    setClaudeSettingsOverrideReader(() => '/settings/claude')

    expect(resolveClaudeCommand({ platform: 'darwin', pathEnv: '', homePath: emptyHome() })).toBe(
      '/settings/claude'
    )
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('DOBIUS_CLAUDE_CLI_PATH is ignored')
  })

  it('reads the setting live, so a later edit applies without restart', () => {
    let current: string | undefined = '/first/claude'
    setClaudeSettingsOverrideReader(() => current)
    const opts = { platform: 'darwin' as const, pathEnv: '', homePath: emptyHome() }

    expect(resolveClaudeCommand(opts)).toBe('/first/claude')
    current = '/second/claude'
    expect(resolveClaudeCommand(opts)).toBe('/second/claude')
  })

  it('still uses the env var when no Settings override is set', () => {
    vi.stubEnv('DOBIUS_CLAUDE_CLI_PATH', '/env/claude')
    setClaudeSettingsOverrideReader(() => undefined)

    expect(resolveClaudeCommand({ platform: 'darwin', pathEnv: '', homePath: emptyHome() })).toBe(
      '/env/claude'
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('unwraps a quoted path with spaces', () => {
    setClaudeSettingsOverrideReader(() => '"/Users/me/My Tools/claude"')

    expect(resolveClaudeCommand({ platform: 'darwin', pathEnv: '', homePath: emptyHome() })).toBe(
      '/Users/me/My Tools/claude'
    )
  })

  it('resolves a bare command name through the PATH scan', () => {
    const home = emptyHome()
    const pathDir = join(home, 'bin')
    makeExecutable(join(pathDir, 'claude-beta'))
    setClaudeSettingsOverrideReader(() => 'claude-beta')

    expect(resolveClaudeCommand({ platform: 'darwin', pathEnv: pathDir, homePath: home })).toBe(
      join(pathDir, 'claude-beta')
    )
  })

  it('falls back (visibly) when the override carries launch arguments', () => {
    vi.stubEnv('DOBIUS_CLAUDE_CLI_PATH', '/env/claude')
    setClaudeSettingsOverrideReader(() => 'claude --model opus')

    expect(resolveClaudeCommand({ platform: 'darwin', pathEnv: '', homePath: emptyHome() })).toBe(
      '/env/claude'
    )
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('includes arguments')
  })

  it('expands a leading ~/ under the home directory', () => {
    const home = emptyHome()
    setClaudeSettingsOverrideReader(() => '~/.claude/local/claude')

    expect(resolveClaudeCommand({ platform: 'darwin', pathEnv: '', homePath: home })).toBe(
      join(home, '.claude', 'local', 'claude')
    )
  })

  it.each([
    ['$HOME/bin/claude'],
    ['`which claude`'],
    ['~other/bin/claude'],
    ['/opt/claude*'],
    ['/opt/claude;rm'],
    ['/opt/claude|tee'],
    ['/opt/claude&'],
    ['"$HOME/bin/claude"']
  ])('falls back (visibly) on shell syntax: %s', (override) => {
    vi.stubEnv('DOBIUS_CLAUDE_CLI_PATH', '/env/claude')
    setClaudeSettingsOverrideReader(() => override)

    expect(resolveClaudeCommand({ platform: 'darwin', pathEnv: '', homePath: emptyHome() })).toBe(
      '/env/claude'
    )
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('shell syntax')
  })

  it('does not merge two quoted words into one bogus path', () => {
    vi.stubEnv('DOBIUS_CLAUDE_CLI_PATH', '/env/claude')
    setClaudeSettingsOverrideReader(() => '"/opt/claude" "--verbose"')

    expect(resolveClaudeCommand({ platform: 'darwin', pathEnv: '', homePath: emptyHome() })).toBe(
      '/env/claude'
    )
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('includes arguments')
  })

  it('keeps Windows backslash paths as-is', () => {
    setClaudeSettingsOverrideReader(() => 'C:\\Users\\me\\claude.exe')

    expect(resolveClaudeCommand({ platform: 'win32', pathEnv: '', homePath: emptyHome() })).toBe(
      'C:\\Users\\me\\claude.exe'
    )
  })

  it('keeps an explicit caller overridePath above everything', () => {
    vi.stubEnv('DOBIUS_CLAUDE_CLI_PATH', '/env/claude')
    setClaudeSettingsOverrideReader(() => '/settings/claude')

    expect(
      resolveClaudeCommand({
        platform: 'darwin',
        pathEnv: '',
        homePath: emptyHome(),
        overridePath: '/caller/claude'
      })
    ).toBe('/caller/claude')
  })
})
