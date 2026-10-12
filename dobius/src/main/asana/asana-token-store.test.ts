import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^enc:/, '')),
  encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
  isEncryptionAvailable: vi.fn(() => true)
}))

let tempHome = ''
// Fake value only: these tests never touch a real credential.
const PAT = 'fake-asana-pat'

async function loadStoreModule() {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof Os>('node:os')
    return { ...actual, homedir: () => tempHome }
  })
  return import('./asana-token-store')
}

function tokenFile(): string {
  return join(tempHome, '.dobius', 'asana-token.enc')
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-asana-token-'))
  safeStorageMock.isEncryptionAvailable.mockReset().mockReturnValue(true)
  safeStorageMock.encryptString
    .mockReset()
    .mockImplementation((value: string) => Buffer.from(`enc:${value}`))
})

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true })
})

describe('Asana token store fails closed (#25)', () => {
  it('writes the token encrypted when safeStorage works', async () => {
    const store = await loadStoreModule()
    store.setAsanaToken(PAT)
    expect(readFileSync(tokenFile(), 'utf8')).toBe(`enc:${PAT}`)
  })

  it('writes nothing when encryption is unavailable and keeps the token for the session', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()

    store.setAsanaToken(PAT)

    expect(existsSync(tokenFile())).toBe(false)
    expect(store.hasAsanaToken()).toBe(true)
    expect(store.getAsanaToken()).toBe(PAT)
  })

  it('writes nothing when encryptString throws', async () => {
    safeStorageMock.encryptString.mockImplementation(() => {
      throw new Error('keychain locked')
    })
    const store = await loadStoreModule()

    store.setAsanaToken(PAT)

    expect(existsSync(tokenFile())).toBe(false)
    expect(store.getAsanaToken()).toBe(PAT)
  })

  it('leaves an existing encrypted file byte-identical when a new token cannot be encrypted', async () => {
    mkdirSync(join(tempHome, '.dobius'), { recursive: true })
    writeFileSync(tokenFile(), 'enc:older-pat')
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()

    store.setAsanaToken(PAT)

    expect(readFileSync(tokenFile(), 'utf8')).toBe('enc:older-pat')
  })

  it('clearing a session-only token reports no token', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()
    store.setAsanaToken(PAT)

    store.clearAsanaToken()

    expect(store.hasAsanaToken()).toBe(false)
  })
})
