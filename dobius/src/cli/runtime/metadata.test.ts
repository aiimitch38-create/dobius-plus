import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDefaultUserDataPath, readMetadata, tryReadMetadata } from './metadata'

// Why: the CLI must resolve the same userData directory Electron writes to —
// derived from package.json "name" ("dobius-plus"), captured before
// app.setName('Dobius+') runs (see persistence.ts's initDataPath()). A
// mismatch here silently breaks every CLI command that needs the runtime
// metadata file.
describe('getDefaultUserDataPath', () => {
  const homeDir = '/Users/example'

  it('resolves the package-name folder on macOS', () => {
    const originalDobius = process.env.DOBIUS_USER_DATA_PATH
    delete process.env.DOBIUS_USER_DATA_PATH
    try {
      expect(getDefaultUserDataPath('darwin', homeDir)).toBe(
        '/Users/example/Library/Application Support/dobius-plus'
      )
    } finally {
      if (originalDobius === undefined) {
        delete process.env.DOBIUS_USER_DATA_PATH
      } else {
        process.env.DOBIUS_USER_DATA_PATH = originalDobius
      }
    }
  })

  it('resolves the package-name folder on Linux, respecting XDG_CONFIG_HOME', () => {
    const originalXdg = process.env.XDG_CONFIG_HOME
    const originalDobius = process.env.DOBIUS_USER_DATA_PATH
    delete process.env.XDG_CONFIG_HOME
    delete process.env.DOBIUS_USER_DATA_PATH
    try {
      expect(getDefaultUserDataPath('linux', homeDir)).toBe('/Users/example/.config/dobius-plus')
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = originalXdg
      }
      if (originalDobius === undefined) {
        delete process.env.DOBIUS_USER_DATA_PATH
      } else {
        process.env.DOBIUS_USER_DATA_PATH = originalDobius
      }
    }
  })

  it('resolves the package-name folder on Windows under APPDATA', () => {
    const originalAppData = process.env.APPDATA
    const originalDobius = process.env.DOBIUS_USER_DATA_PATH
    process.env.APPDATA = 'C:\\Users\\example\\AppData\\Roaming'
    delete process.env.DOBIUS_USER_DATA_PATH
    try {
      expect(getDefaultUserDataPath('win32', homeDir)).toBe(
        'C:\\Users\\example\\AppData\\Roaming/dobius-plus'
      )
    } finally {
      if (originalAppData === undefined) {
        delete process.env.APPDATA
      } else {
        process.env.APPDATA = originalAppData
      }
      if (originalDobius === undefined) {
        delete process.env.DOBIUS_USER_DATA_PATH
      } else {
        process.env.DOBIUS_USER_DATA_PATH = originalDobius
      }
    }
  })
})

describe('runtime metadata key selection', () => {
  const write = (dir: string, name: string, runtimeId: string, authToken: string) =>
    writeFileSync(
      join(dir, name),
      JSON.stringify({
        runtimeId,
        pid: 1,
        transports: [{ kind: 'unix', endpoint: '/tmp/x.sock' }],
        authToken,
        startedAt: 1
      })
    )
  const withScope = <T>(scope: string | undefined, run: () => T): T => {
    const original = process.env.DOBIUS_RUNTIME_SCOPE
    if (scope === undefined) {
      delete process.env.DOBIUS_RUNTIME_SCOPE
    } else {
      process.env.DOBIUS_RUNTIME_SCOPE = scope
    }
    try {
      return run()
    } finally {
      if (original === undefined) {
        delete process.env.DOBIUS_RUNTIME_SCOPE
      } else {
        process.env.DOBIUS_RUNTIME_SCOPE = original
      }
    }
  }

  it('uses the full key outside Dobius terminals and agent runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dobius-cli-meta-'))
    write(dir, 'dobius-runtime.json', 'rt-1', 'full-key')
    write(dir, 'dobius-runtime-agent.json', 'rt-1', 'agent-key')
    expect(withScope(undefined, () => readMetadata(dir).authToken)).toBe('full-key')
  })

  it('uses the agent key when the agent scope is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dobius-cli-meta-'))
    write(dir, 'dobius-runtime.json', 'rt-1', 'full-key')
    write(dir, 'dobius-runtime-agent.json', 'rt-1', 'agent-key')
    expect(withScope('agent', () => readMetadata(dir).authToken)).toBe('agent-key')
    expect(withScope('agent', () => tryReadMetadata(dir)?.authToken)).toBe('agent-key')
  })

  it('uses the agent key when the full file cannot be read (agent sandbox)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dobius-cli-meta-'))
    write(dir, 'dobius-runtime-agent.json', 'rt-1', 'agent-key')
    expect(withScope('agent', () => readMetadata(dir).authToken)).toBe('agent-key')
  })

  it('still works against an older app that wrote only the full file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dobius-cli-meta-'))
    write(dir, 'dobius-runtime.json', 'rt-old', 'full-key')
    expect(withScope('agent', () => readMetadata(dir).authToken)).toBe('full-key')
  })

  it('ignores an agent file left behind by a different runtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dobius-cli-meta-'))
    write(dir, 'dobius-runtime.json', 'rt-live', 'full-key')
    write(dir, 'dobius-runtime-agent.json', 'rt-crashed', 'stale-agent-key')
    expect(withScope('agent', () => readMetadata(dir).authToken)).toBe('full-key')
  })
})
