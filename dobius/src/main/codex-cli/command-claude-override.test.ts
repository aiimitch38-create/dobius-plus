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
