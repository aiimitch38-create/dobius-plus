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
  return import('./custom-harness-store')
}

beforeEach(() => {
  electronMock.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-custom-harness-'))
})

afterEach(() => {
  rmSync(electronMock.userDataDir, { recursive: true, force: true })
})

const sample = {
  id: 'goose',
  label: 'Goose',
  command: 'goose',
  args: ['acp'],
  env: { GOOSE_MODE: 'acp' },
  installInstructionsUrl: 'https://example.com',
  installHint: 'brew install goose'
}

describe('custom harness store', () => {
  it('saves and lists a harness definition', async () => {
    const store = await loadStore()
    store.saveCustomHarness(sample)
    expect(store.listCustomHarnesses()).toEqual([sample])
  })

  it('rejects a definition missing required fields', async () => {
    const store = await loadStore()
    expect(() => store.saveCustomHarness({ ...sample, command: '' })).toThrow()
  })

  it('renames a harness by moving its id when originalId differs', async () => {
    const store = await loadStore()
    store.saveCustomHarness(sample)
    store.saveCustomHarness({ ...sample, id: 'goose-v2' }, 'goose')
    expect(store.listCustomHarnesses().map((h) => h.id)).toEqual(['goose-v2'])
  })

  it('deletes a harness and is a no-op for an unknown id', async () => {
    const store = await loadStore()
    store.saveCustomHarness(sample)
    store.deleteCustomHarness('goose')
    expect(store.listCustomHarnesses()).toEqual([])
    expect(() => store.deleteCustomHarness('does-not-exist')).not.toThrow()
  })

  it('persists across a reload from disk', async () => {
    const store = await loadStore()
    store.saveCustomHarness(sample)
    const reloaded = await loadStore()
    expect(reloaded.listCustomHarnesses()).toEqual([sample])
  })
})
