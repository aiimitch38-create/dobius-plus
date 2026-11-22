import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8')
  }
}))

vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

async function createStore() {
  vi.resetModules()
  const { Store, initDataPath } = await import('./persistence')
  initDataPath()
  return new Store()
}

function dataFile(): string {
  return join(testState.dir, 'dobius-data.json')
}

function readSaved(): { snoozedTabs?: unknown } {
  return JSON.parse(readFileSync(dataFile(), 'utf-8'))
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'dobius-snoozed-tabs-'))
})

afterEach(() => {
  rmSync(testState.dir, { recursive: true, force: true })
})

describe('Store snoozed tabs', () => {
  it('saves the list to disk and reads it back on the next launch', async () => {
    const store = await createStore()
    expect(store.getSnoozedTabs()).toEqual([])
    const entry = {
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      title: 'Fix login',
      snoozedAt: 1000,
      until: 5000,
      ready: false,
      pinned: true as const
    }
    store.setSnoozedTabs([entry])
    store.flush()
    expect(readSaved().snoozedTabs).toEqual([entry])

    const next = await createStore()
    expect(next.getSnoozedTabs()).toEqual([entry])
  })

  it('drops damaged rows from disk', async () => {
    mkdirSync(testState.dir, { recursive: true })
    writeFileSync(
      dataFile(),
      JSON.stringify({
        snoozedTabs: [{ tabId: 'no-worktree' }, 'junk', { worktreeId: 'wt-1', tabId: 'tab-1' }]
      }),
      'utf-8'
    )
    const store = await createStore()
    expect(store.getSnoozedTabs().map((entry) => entry.tabId)).toEqual(['tab-1'])
  })
})
