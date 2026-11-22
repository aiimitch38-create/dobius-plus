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

function readSaved(): { whatsNew?: unknown } {
  return JSON.parse(readFileSync(dataFile(), 'utf-8'))
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'dobius-whats-new-'))
})

afterEach(() => {
  rmSync(testState.dir, { recursive: true, force: true })
})

describe('Store whatsNew record', () => {
  it('a fresh profile has no record and is not an existing profile', async () => {
    const store = await createStore()
    expect(store.hadProfileOnLoad()).toBe(false)
    expect(store.getWhatsNewSeen()).toBeNull()
  })

  it('saves the seen version to disk and reads it back on the next launch', async () => {
    const store = await createStore()
    store.markWhatsNewSeen('2.1.10')
    store.flush()
    expect(readSaved().whatsNew).toEqual({ seen: '2.1.10' })

    const next = await createStore()
    expect(next.hadProfileOnLoad()).toBe(true)
    expect(next.getWhatsNewSeen()).toBe('2.1.10')
  })

  it('never lowers the saved version and ignores a bad one', async () => {
    const store = await createStore()
    store.markWhatsNewSeen('2.1.10')
    store.markWhatsNewSeen('2.1.9')
    store.markWhatsNewSeen('not-a-version')
    expect(store.getWhatsNewSeen()).toBe('2.1.10')
    store.markWhatsNewSeen('2.1.11')
    expect(store.getWhatsNewSeen()).toBe('2.1.11')
  })

  it('drops a damaged record from disk', async () => {
    mkdirSync(testState.dir, { recursive: true })
    writeFileSync(dataFile(), JSON.stringify({ whatsNew: { seen: 'latest' } }), 'utf-8')
    const store = await createStore()
    expect(store.hadProfileOnLoad()).toBe(true)
    expect(store.getWhatsNewSeen()).toBeNull()
  })
})
