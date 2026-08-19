import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronMock.userDataDir) }
}))

async function loadStore() {
  vi.resetModules()
  return import('./global-agent-config-store')
}

beforeEach(() => {
  electronMock.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-global-agent-config-'))
})

afterEach(() => {
  rmSync(electronMock.userDataDir, { recursive: true, force: true })
})

describe('global agent config store', () => {
  it('returns empty defaults before anything is saved', async () => {
    const store = await loadStore()
    expect(store.getGlobalAgentConfig()).toEqual({
      env_vars: {},
      provider: null,
      model: null,
      preferred_runtime: null
    })
    expect(store.getAgentManagedProfiles()).toBe(false)
  })

  it('saves and strips empty env values on write', async () => {
    const store = await loadStore()
    const saved = store.setGlobalAgentConfig({
      env_vars: { FOO: 'bar', EMPTY: '' },
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      preferred_runtime: 'claude'
    })
    expect(saved.env_vars).toEqual({ FOO: 'bar' })
    expect(store.getGlobalAgentConfig().provider).toBe('anthropic')
  })

  it('rejects a reserved env var key', async () => {
    const store = await loadStore()
    expect(() =>
      store.setGlobalAgentConfig({
        env_vars: { PATH: '/usr/bin' },
        provider: null,
        model: null,
        preferred_runtime: null
      })
    ).toThrow(/reserved/)
  })

  it('persists the managed-profiles flag independently of the config', async () => {
    const store = await loadStore()
    expect(store.setAgentManagedProfiles(true)).toBe(true)
    const reloaded = await loadStore()
    expect(reloaded.getAgentManagedProfiles()).toBe(true)
    expect(reloaded.getGlobalAgentConfig().provider).toBeNull()
  })
})
