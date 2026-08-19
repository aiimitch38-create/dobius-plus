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
  return import('./agent-local-overrides-store')
}

beforeEach(() => {
  electronMock.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-agent-overrides-'))
})

afterEach(() => {
  rmSync(electronMock.userDataDir, { recursive: true, force: true })
})

describe('agent local overrides store', () => {
  it('returns an empty override set for an unknown agent', async () => {
    const store = await loadStore()
    expect(store.getAgentLocalOverrides('missing-agent')).toEqual({})
  })

  it('persists a set field and merges it with prior fields', async () => {
    const store = await loadStore()
    store.setAgentLocalOverride('agent-1', 'active', false)
    store.setAgentLocalOverride('agent-1', 'autoRestartOnConfigChange', true)
    expect(store.getAgentLocalOverrides('agent-1')).toEqual({
      active: false,
      autoRestartOnConfigChange: true
    })
  })

  it('survives a reload from disk', async () => {
    const store = await loadStore()
    store.setAgentLocalOverride('agent-2', 'startOnAppLaunch', true)
    const reloaded = await loadStore()
    expect(reloaded.getAgentLocalOverrides('agent-2')).toEqual({ startOnAppLaunch: true })
  })

  it('ignores malformed on-disk data instead of throwing', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path.join(electronMock.userDataDir, 'communications-agent-overrides.json'), 'not json')
    const store = await loadStore()
    expect(store.getAgentLocalOverrides('agent-1')).toEqual({})
  })
})
