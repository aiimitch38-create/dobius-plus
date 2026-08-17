import { schnorr } from '@noble/curves/secp256k1'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  isEncryptionAvailable: vi.fn(() => true)
}))

let tempHome = ''

async function loadStoreModule() {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  return import('./agent-participant-identity-store')
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-agent-identity-'))
  safeStorageMock.decryptString.mockClear()
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.isEncryptionAvailable.mockClear()
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
})

describe('agent participant identity store', () => {
  it('creates no file until an agent identity is requested', async () => {
    await loadStoreModule()
    expect(existsSync(join(tempHome, '.dobius'))).toBe(false)
  })

  it('generates a stable pubkey per agent id, distinct across agents', async () => {
    const store = await loadStoreModule()
    const a1 = store.ensureAgentIdentity('agent-1')
    const a1Again = store.ensureAgentIdentity('agent-1')
    const a2 = store.ensureAgentIdentity('agent-2')

    expect(a1.pubkey).toMatch(/^[a-f0-9]{64}$/)
    expect(a1Again.pubkey).toBe(a1.pubkey)
    expect(a2.pubkey).not.toBe(a1.pubkey)
  })

  it('persists identities to disk encrypted, and reloads them in a fresh module instance', async () => {
    const store = await loadStoreModule()
    const created = store.ensureAgentIdentity('agent-1')
    expect(safeStorageMock.encryptString).toHaveBeenCalled()

    const reloaded = await loadStoreModule()
    const reread = reloaded.ensureAgentIdentity('agent-1')
    expect(reread.pubkey).toBe(created.pubkey)
  })

  it('signs an event whose id and signature verify against the agent pubkey', async () => {
    const store = await loadStoreModule()
    const { pubkey } = store.ensureAgentIdentity('agent-1')

    const signed = store.signAsAgent('agent-1', {
      kind: 9,
      content: 'hello from the agent',
      tags: [['h', 'channel-1']]
    })

    expect(signed.pubkey).toBe(pubkey)
    const idBytes = Buffer.from(
      require('@noble/hashes/sha256').sha256(
        new TextEncoder().encode(
          JSON.stringify([0, signed.pubkey, signed.created_at, signed.kind, signed.tags, signed.content])
        )
      )
    )
    expect(signed.id).toBe(idBytes.toString('hex'))
    expect(
      schnorr.verify(signed.sig, Buffer.from(signed.id, 'hex'), Buffer.from(signed.pubkey, 'hex'))
    ).toBe(true)
  })

  it('throws when signing for an agent with no identity yet', async () => {
    const store = await loadStoreModule()
    expect(() => store.signAsAgent('unknown-agent', { kind: 9, content: 'x', tags: [] })).toThrow(
      /No Communications identity/
    )
  })

  it('clearAgentIdentityRegistry removes the on-disk file and cache', async () => {
    const store = await loadStoreModule()
    store.ensureAgentIdentity('agent-1')
    store.clearAgentIdentityRegistry()
    expect(existsSync(join(tempHome, '.dobius', 'communications-agent-identities.enc'))).toBe(false)
  })
})
