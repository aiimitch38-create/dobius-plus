import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  isEncryptionAvailable: vi.fn(() => true)
}))

const relayClientMock = vi.hoisted(() => ({
  queryRelayEvents: vi.fn(),
  submitRelayEvent: vi.fn()
}))

let tempHome = ''

type RawSignedEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

function signRawEvent(
  privateKeyBytes: Uint8Array,
  kind: number,
  tags: string[][],
  content: string,
  createdAt = 1_700_000_000
): RawSignedEvent {
  const pubkeyHex = Buffer.from(schnorr.getPublicKey(privateKeyBytes)).toString('hex')
  const serialized = JSON.stringify([0, pubkeyHex, createdAt, kind, tags, content])
  const idBytes = sha256(new TextEncoder().encode(serialized))
  const sigBytes = schnorr.sign(idBytes, privateKeyBytes)
  return {
    id: Buffer.from(idBytes).toString('hex'),
    pubkey: pubkeyHex,
    created_at: createdAt,
    kind,
    tags,
    content,
    sig: Buffer.from(sigBytes).toString('hex')
  }
}

async function loadModules() {
  vi.resetModules()
  relayClientMock.queryRelayEvents.mockReset()
  relayClientMock.submitRelayEvent.mockReset().mockResolvedValue(undefined)

  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  vi.doMock('./relay-http-client', () => relayClientMock)

  const store = await import('../participant-identity-store')
  const archival = await import('./identity-archival-relay')
  return { store, archival }
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-identity-archival-relay-'))
})

describe('identity-archival-relay', () => {
  it('resolveOaOwner reads the auth tag off a verified kind:0 profile event', async () => {
    const { store, archival } = await loadModules()
    const self = store.ensureParticipantIdentity()

    const targetKey = schnorr.utils.randomPrivateKey()
    const targetPubkey = Buffer.from(schnorr.getPublicKey(targetKey)).toString('hex')
    const profileEvent = signRawEvent(targetKey, 0, [['auth', self.pubkey]], '{}')
    relayClientMock.queryRelayEvents.mockResolvedValue([profileEvent])

    const result = await archival.resolveOaOwner(targetPubkey)

    expect(result).toEqual({ owner: self.pubkey, isMe: true })
  })

  it('resolveOaOwner returns null when the profile event has no auth tag', async () => {
    const { archival } = await loadModules()
    const targetKey = schnorr.utils.randomPrivateKey()
    const targetPubkey = Buffer.from(schnorr.getPublicKey(targetKey)).toString('hex')
    relayClientMock.queryRelayEvents.mockResolvedValue([signRawEvent(targetKey, 0, [], '{}')])

    expect(await archival.resolveOaOwner(targetPubkey)).toBeNull()
  })

  it('resolveOaOwner returns null when the profile event fails signature verification', async () => {
    const { archival } = await loadModules()
    const targetKey = schnorr.utils.randomPrivateKey()
    const targetPubkey = Buffer.from(schnorr.getPublicKey(targetKey)).toString('hex')
    const forged = signRawEvent(targetKey, 0, [['auth', 'f'.repeat(64)]], '{}')
    forged.sig = 'a'.repeat(128) // corrupt the signature
    relayClientMock.queryRelayEvents.mockResolvedValue([forged])

    expect(await archival.resolveOaOwner(targetPubkey)).toBeNull()
  })

  it('archiveIdentity submits a signed kind:9035 event tagging the target', async () => {
    const { store, archival } = await loadModules()
    const self = store.ensureParticipantIdentity()
    relayClientMock.queryRelayEvents.mockResolvedValue([]) // resolveOaOwner finds nothing -> no auth tag

    await archival.archiveIdentity({ targetPubkey: 'd'.repeat(64), reason: 'compromised' })

    expect(relayClientMock.submitRelayEvent).toHaveBeenCalledTimes(1)
    const submitted = relayClientMock.submitRelayEvent.mock.calls[0][0] as RawSignedEvent
    expect(submitted.kind).toBe(9035)
    expect(submitted.pubkey).toBe(self.pubkey)
    expect(submitted.tags).toContainEqual(['p', 'd'.repeat(64)])
    expect(submitted.tags).toContainEqual(['reason', 'compromised'])
    expect(schnorr.verify(submitted.sig, submitted.id, submitted.pubkey)).toBe(true)
  })

  it('unarchiveIdentity submits a signed kind:9036 event tagging the target', async () => {
    const { store, archival } = await loadModules()
    const self = store.ensureParticipantIdentity()
    relayClientMock.queryRelayEvents.mockResolvedValue([])

    await archival.unarchiveIdentity({ targetPubkey: 'e'.repeat(64) })

    const submitted = relayClientMock.submitRelayEvent.mock.calls[0][0] as RawSignedEvent
    expect(submitted.kind).toBe(9036)
    expect(submitted.pubkey).toBe(self.pubkey)
    expect(submitted.tags).toContainEqual(['p', 'e'.repeat(64)])
  })

  it('listArchivedIdentities collects p-tags off the latest verified kind:13535 snapshot', async () => {
    const { archival } = await loadModules()
    const snapshotKey = schnorr.utils.randomPrivateKey()
    const archivedPubkeys = ['1'.repeat(64), '2'.repeat(64)]
    const snapshotEvent = signRawEvent(
      snapshotKey,
      13535,
      archivedPubkeys.map((p) => ['p', p]),
      ''
    )
    relayClientMock.queryRelayEvents.mockResolvedValue([snapshotEvent])

    expect(await archival.listArchivedIdentities()).toEqual({ archived: archivedPubkeys })
  })

  it('listArchivedIdentities returns an empty list when the relay has no snapshot yet', async () => {
    const { archival } = await loadModules()
    relayClientMock.queryRelayEvents.mockResolvedValue([])

    expect(await archival.listArchivedIdentities()).toEqual({ archived: [] })
  })
})
