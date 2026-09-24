import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronMock.userDataDir) }
}))

async function loadStore() {
  vi.resetModules()
  return import('./agents-config-store')
}

function configPath(): string {
  return path.join(electronMock.userDataDir, 'agents-config.json')
}

beforeEach(() => {
  electronMock.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-agents-config-'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(electronMock.userDataDir, { recursive: true, force: true })
})

describe('agents config store: crew control state', () => {
  it('treats a missing file as unpaused and does not create one', async () => {
    const store = await loadStore()
    expect(store.getAgentsControlState()).toMatchObject({ status: 'missing', paused: false })
    expect(existsSync(configPath())).toBe(false)
  })

  it('fails closed on malformed JSON and never overwrites the file', async () => {
    writeFileSync(configPath(), '{')
    const store = await loadStore()

    expect(store.getAgentsPaused()).toBe(true)
    expect(store.getAgentsControlState()).toMatchObject({
      status: 'unreadable',
      detail: 'invalid JSON',
      filePath: configPath()
    })
    expect(store.consumePingBudget()).toBe(false)
    expect(store.setAgentsPaused(true)).toBe(true)
    expect(readFileSync(configPath(), 'utf-8')).toBe('{')
  })

  it('does not persist a stale-day rollover while unreadable', async () => {
    writeFileSync(configPath(), '{"agentsPaused":"yes","pingDate":"2000-01-01"}')
    const store = await loadStore()

    expect(store.getAgentsControlState()).toMatchObject({ status: 'unreadable', paused: true })
    expect(readFileSync(configPath(), 'utf-8')).toBe(
      '{"agentsPaused":"yes","pingDate":"2000-01-01"}'
    )
  })

  it('treats a wrongly typed pause flag as unreadable', async () => {
    writeFileSync(configPath(), '{"agentsPaused":"yes"}')
    const store = await loadStore()
    expect(store.getAgentsControlState()).toMatchObject({ status: 'unreadable', paused: true })
  })

  it('refuses to resume while unreadable', async () => {
    writeFileSync(configPath(), '[]')
    const store = await loadStore()
    expect(() => store.setAgentsPaused(false)).toThrow(/could not be read/)
    expect(readFileSync(configPath(), 'utf-8')).toBe('[]')
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails closed when the file cannot be read (EACCES)',
    async () => {
      writeFileSync(configPath(), '{"agentsPaused":false}')
      chmodSync(configPath(), 0o000)
      const store = await loadStore()
      expect(store.getAgentsControlState()).toMatchObject({
        status: 'unreadable',
        paused: true,
        detail: 'EACCES'
      })
      chmodSync(configPath(), 0o600)
    }
  )

  it('recovers without a restart once the file is repaired', async () => {
    writeFileSync(configPath(), '{')
    const store = await loadStore()
    expect(store.getAgentsPaused()).toBe(true)

    writeFileSync(configPath(), '{"agentsPaused":false}')
    expect(store.getAgentsControlState()).toMatchObject({ status: 'ok', paused: false })
  })

  it('still persists a rollover and pause changes for a valid file', async () => {
    writeFileSync(
      configPath(),
      '{"agentsPaused":false,"maxPingsPerDay":4,"pingDate":"2000-01-01","pingsUsed":3}'
    )
    const store = await loadStore()

    expect(store.getPingStatus()).toMatchObject({ used: 0 })
    expect(JSON.parse(readFileSync(configPath(), 'utf-8'))).toMatchObject({ pingsUsed: 0 })
    expect(store.setAgentsPaused(true)).toBe(true)
    expect(JSON.parse(readFileSync(configPath(), 'utf-8'))).toMatchObject({ agentsPaused: true })
  })
})
