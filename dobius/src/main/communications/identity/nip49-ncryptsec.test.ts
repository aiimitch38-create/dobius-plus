import { schnorr } from '@noble/curves/secp256k1'
import { describe, expect, it } from 'vitest'
import { encodeNpub } from './nip19-codec'
import { decryptNcryptsec, encryptToNcryptsec } from './nip49-ncryptsec'

// logN: 4 (N=16) everywhere here — the point of these tests is correctness,
// not scrypt's real-world cost factor, and the default 2^16 makes this file
// slow. See KEY_SAFETY in the build report: production callers always go
// through the default (2^16).
const FAST_OPTIONS = { logN: 4 }

describe('nip49-ncryptsec', () => {
  it('round-trips a private key through encrypt/decrypt with the correct password', async () => {
    const privateKeyHex = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')
    const ncryptsec = await encryptToNcryptsec(privateKeyHex, 'correct horse battery staple', FAST_OPTIONS)
    expect(ncryptsec.startsWith('ncryptsec1')).toBe(true)

    const decrypted = await decryptNcryptsec(ncryptsec, 'correct horse battery staple')
    expect(decrypted.privateKeyHex).toBe(privateKeyHex)
  })

  it('fails to decrypt with the wrong password', async () => {
    const privateKeyHex = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')
    const ncryptsec = await encryptToNcryptsec(privateKeyHex, 'right-password', FAST_OPTIONS)

    await expect(decryptNcryptsec(ncryptsec, 'wrong-password')).rejects.toThrow(
      /incorrect password or corrupted backup/
    )
  })

  it('never contains the plaintext private key hex in the encrypted backup string', async () => {
    const privateKeyHex = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')
    const ncryptsec = await encryptToNcryptsec(privateKeyHex, 'a-password', FAST_OPTIONS)
    expect(ncryptsec).not.toContain(privateKeyHex)
  })

  it('rejects a non-ncryptsec bech32 string', async () => {
    const pubkeyHex = Buffer.from(schnorr.getPublicKey(schnorr.utils.randomPrivateKey())).toString('hex')
    const npub = encodeNpub(pubkeyHex)
    await expect(decryptNcryptsec(npub, 'x')).rejects.toThrow(/not an ncryptsec-encoded backup/)
  })

  it('rejects a malformed private key before attempting to encrypt', async () => {
    await expect(encryptToNcryptsec('not-hex', 'password', FAST_OPTIONS)).rejects.toThrow(
      /64 lowercase hex characters/
    )
  })
})
