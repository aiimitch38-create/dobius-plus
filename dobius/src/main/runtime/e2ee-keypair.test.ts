import type * as FsModule from 'node:fs'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { E2EEKeypairUnreadableError, loadOrCreateE2EEKeypair } from './e2ee-keypair'
import { E2EE_KEYPAIR_FILENAME } from './mobile-pairing-files'

// Why: the keypair is hardened (chmod 600) before it is read, so a real
// chmod 000 cannot produce EACCES; inject the read failure instead.
const fsHooks = vi.hoisted(() => ({ failReadWith: null as string | null }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>()
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      if (fsHooks.failReadWith) {
        throw Object.assign(new Error(`${fsHooks.failReadWith}: injected`), {
          code: fsHooks.failReadWith
        })
      }
      return actual.readFileSync(...args)
    }) as typeof actual.readFileSync
  }
})

let dir = ''
let keypairPath = ''

function snapshot(): { bytes: string; mtimeMs: number; entries: string[] } {
  fsHooks.failReadWith = null
  return {
    bytes: readFileSync(keypairPath, 'utf-8'),
    mtimeMs: statSync(keypairPath).mtimeMs,
    entries: readdirSync(dir).sort()
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dobius-e2ee-keypair-'))
  keypairPath = join(dir, E2EE_KEYPAIR_FILENAME)
  fsHooks.failReadWith = null
})

afterEach(() => {
  fsHooks.failReadWith = null
  rmSync(dir, { recursive: true, force: true })
})

describe('loadOrCreateE2EEKeypair', () => {
  it('creates a keypair only when the file is missing, then reuses it', () => {
    const first = loadOrCreateE2EEKeypair(dir)
    const second = loadOrCreateE2EEKeypair(dir)

    expect(first.publicKey).toHaveLength(32)
    expect(second.publicKeyB64).toBe(first.publicKeyB64)
  })

  const valid = JSON.stringify({
    v: 1,
    publicKeyB64: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
    secretKeyB64: Buffer.from(new Uint8Array(32).fill(2)).toString('base64')
  })
  const cases: { name: string; bytes: string; failReadWith?: string }[] = [
    { name: 'corrupt JSON', bytes: '{"v":1,"publicKeyB64":' },
    { name: 'wrong version', bytes: valid.replace('"v":1', '"v":9') },
    {
      name: 'short key material',
      bytes: JSON.stringify({ v: 1, publicKeyB64: 'AAAA', secretKeyB64: 'AAAA' })
    },
    { name: 'oversized file', bytes: 'x'.repeat(9 * 1024) },
    { name: 'EACCES on read', bytes: valid, failReadWith: 'EACCES' }
  ]

  for (const testCase of cases) {
    it(`${testCase.name}: throws a recovery error and never writes a new key`, () => {
      writeFileSync(keypairPath, testCase.bytes, { mode: 0o600 })
      const before = snapshot()

      fsHooks.failReadWith = testCase.failReadWith ?? null
      expect(() => loadOrCreateE2EEKeypair(dir)).toThrow(E2EEKeypairUnreadableError)
      // Second attempt (e.g. listener restart) must not regenerate either.
      expect(() => loadOrCreateE2EEKeypair(dir)).toThrow(E2EEKeypairUnreadableError)

      expect(snapshot()).toEqual(before)
    })
  }

  it('recovery error names the file and errno but never the key material', () => {
    writeFileSync(keypairPath, valid, { mode: 0o600 })
    fsHooks.failReadWith = 'EACCES'

    let caught: unknown
    try {
      loadOrCreateE2EEKeypair(dir)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(E2EEKeypairUnreadableError)
    const message = (caught as Error).message
    expect(message).toContain(keypairPath)
    expect(message).toContain('EACCES')
    expect(message).not.toContain(JSON.parse(valid).secretKeyB64)
  })

  it('a repaired file loads its original identity', () => {
    writeFileSync(keypairPath, '{broken', { mode: 0o600 })
    expect(() => loadOrCreateE2EEKeypair(dir)).toThrow(E2EEKeypairUnreadableError)

    writeFileSync(keypairPath, valid, { mode: 0o600 })

    expect(loadOrCreateE2EEKeypair(dir).publicKeyB64).toBe(JSON.parse(valid).publicKeyB64)
  })
})
