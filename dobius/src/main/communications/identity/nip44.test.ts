import { schnorr } from '@noble/curves/secp256k1'
import { secp256k1 } from '@noble/curves/secp256k1'
import { chacha20 } from '@noble/ciphers/chacha'
import { hkdf } from '@noble/hashes/hkdf'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToUtf8, concatBytes, utf8ToBytes } from '@noble/hashes/utils'
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

let tempHome = ''

async function loadModules() {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  const store = await import('../participant-identity-store')
  const nip44 = await import('./nip44')
  return { store, nip44 }
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-nip44-'))
})

// Independent NIP-44 v2 decrypt, reimplemented directly against @noble
// primitives (not importing anything from nip44.ts), so decrypting on
// "the peer's side" here is real proof the module's ECDH is genuinely
// symmetric/peer-general — not just self-encryption in disguise.
function independentDecrypt(peerPrivateKeyBytes: Uint8Array, ourPubkeyHex: string, payloadBase64: string): string {
  const shared = secp256k1.getSharedSecret(peerPrivateKeyBytes, `02${ourPubkeyHex}`, true)
  const conversationKey = hkdf(sha256, shared.subarray(1, 33), utf8ToBytes('nip44-v2'), undefined, 32)

  const raw = new Uint8Array(Buffer.from(payloadBase64, 'base64'))
  const nonce = raw.subarray(1, 33)
  const mac = raw.subarray(-32)
  const ciphertext = raw.subarray(33, -32)

  const expanded = hkdf(sha256, conversationKey, undefined, nonce, 76)
  const chachaKey = expanded.subarray(0, 32)
  const chachaNonce = expanded.subarray(32, 44)
  const hmacKey = expanded.subarray(44)

  const expectedMac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext))
  expect(Buffer.from(expectedMac).toString('hex')).toBe(Buffer.from(mac).toString('hex'))

  const padded = chacha20(chachaKey, chachaNonce, ciphertext, undefined, 0)
  const unpaddedLen = (padded[0] << 8) | padded[1]
  return bytesToUtf8(padded.subarray(2, 2 + unpaddedLen))
}

describe('nip44 (general peer entry point)', () => {
  it('round-trips to a real peer pubkey, verified by an independently reimplemented decrypt', async () => {
    const { store, nip44 } = await loadModules()
    store.ensureParticipantIdentity()

    const peerPrivateKey = schnorr.utils.randomPrivateKey()
    const peerPubkeyHex = Buffer.from(schnorr.getPublicKey(peerPrivateKey)).toString('hex')
    const ourPubkeyHex = store.getParticipantPublicIdentity().pubkey

    const payload = nip44.nip44EncryptToPeer(peerPubkeyHex, 'hello from the participant')
    expect(independentDecrypt(peerPrivateKey, ourPubkeyHex, payload)).toBe('hello from the participant')
  })

  it('round-trips via its own encrypt/decrypt for the self case (peer pubkey = own pubkey)', async () => {
    const { store, nip44 } = await loadModules()
    const self = store.ensureParticipantIdentity()

    const payload = nip44.nip44EncryptToPeer(self.pubkey, 'note to myself')
    expect(nip44.nip44DecryptFromPeer(self.pubkey, payload)).toBe('note to myself')
  })

  it('never leaks the private key or plaintext into the ciphertext payload', async () => {
    const { store, nip44 } = await loadModules()
    store.ensureParticipantIdentity()
    const { privateKeyHex } = store.unsafeGetParticipantPrivateKeyForCrypto()

    const peerPubkeyHex = Buffer.from(schnorr.getPublicKey(schnorr.utils.randomPrivateKey())).toString('hex')
    const payload = nip44.nip44EncryptToPeer(peerPubkeyHex, 'super-secret-marker')
    expect(payload).not.toContain('super-secret-marker')
    expect(payload).not.toContain(privateKeyHex)
  })

  it('rejects a malformed peer pubkey before touching the private key', async () => {
    const { store, nip44 } = await loadModules()
    store.ensureParticipantIdentity()

    expect(() => nip44.nip44EncryptToPeer('not-a-pubkey', 'hi')).toThrow(/64 lowercase hex/)
  })

  it('a payload encrypted for one peer fails MAC verification when decrypted as if from a different peer', async () => {
    const { store, nip44 } = await loadModules()
    store.ensureParticipantIdentity()

    const peerA = Buffer.from(schnorr.getPublicKey(schnorr.utils.randomPrivateKey())).toString('hex')
    const peerB = Buffer.from(schnorr.getPublicKey(schnorr.utils.randomPrivateKey())).toString('hex')

    const payload = nip44.nip44EncryptToPeer(peerA, 'only for A')
    expect(() => nip44.nip44DecryptFromPeer(peerB, payload)).toThrow(/MAC verification failed/)
  })
})
