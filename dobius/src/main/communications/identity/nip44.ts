// The ONE NIP-44 v2 implementation in this codebase. Every slice that needs
// to encrypt/decrypt a Nostr NIP-44 payload — to self or to a peer — must
// call `nip44EncryptToPeer`/`nip44DecryptFromPeer` here rather than writing
// a second implementation. Two divergent NIP-44 implementations is exactly
// the kind of thing that silently rots: one gets a padding/HKDF fix the
// other doesn't, and messages between them stop decrypting.
//
// The private key is a hard boundary: this module reads it exactly once,
// internally, via `unsafeGetParticipantPrivateKeyForCrypto()` — the
// exported functions take a PEER PUBKEY and plaintext/ciphertext, never a
// private key, and no caller anywhere needs one. `nip44-self.ts`'s
// encrypt/decrypt-to-self is just the special case where the peer pubkey is
// the participant's own.
import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { hmac } from '@noble/hashes/hmac'
import { hkdf } from '@noble/hashes/hkdf'
import { chacha20 } from '@noble/ciphers/chacha'
import { concatBytes, randomBytes, utf8ToBytes, bytesToUtf8 } from '@noble/hashes/utils'
import { unsafeGetParticipantPrivateKeyForCrypto } from '../participant-identity-store'

const NIP44_VERSION = 2
const NONCE_LEN = 32
const CHACHA_KEY_LEN = 32
const CHACHA_NONCE_LEN = 12
const HMAC_KEY_LEN = 32
const MESSAGE_KEYS_LEN = CHACHA_KEY_LEN + CHACHA_NONCE_LEN + HMAC_KEY_LEN
const HEX_64 = /^[0-9a-f]{64}$/

function deriveConversationKey(privateKeyHex: string, peerPubkeyHex: string): Uint8Array {
  if (!HEX_64.test(peerPubkeyHex)) {
    throw new Error('nip44: peer pubkey must be 64 lowercase hex characters')
  }
  const privBytes = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'))
  // secp256k1 x-only pubkeys are the even-Y point by BIP-340 convention.
  const sharedPoint = secp256k1.getSharedSecret(privBytes, `02${peerPubkeyHex}`, true)
  const sharedX = sharedPoint.subarray(1, 33)
  return hkdf(sha256, sharedX, utf8ToBytes('nip44-v2'), undefined, 32)
}

function calcPaddedLen(unpaddedLen: number): number {
  if (unpaddedLen <= 32) {
    return 32
  }
  const nextPower = 1 << (Math.floor(Math.log2(unpaddedLen - 1)) + 1)
  const chunk = nextPower <= 256 ? 32 : nextPower / 8
  return chunk * (Math.floor((unpaddedLen - 1) / chunk) + 1)
}

function writeU16BE(value: number): Uint8Array {
  const out = new Uint8Array(2)
  out[0] = (value >>> 8) & 0xff
  out[1] = value & 0xff
  return out
}

function readU16BE(bytes: Uint8Array): number {
  return (bytes[0] << 8) | bytes[1]
}

function padPlaintext(plaintext: string): Uint8Array {
  const unpadded = utf8ToBytes(plaintext)
  const unpaddedLen = unpadded.length
  if (unpaddedLen < 1 || unpaddedLen > 65535) {
    throw new Error('nip44: plaintext length must be between 1 and 65535 bytes')
  }
  const suffix = new Uint8Array(calcPaddedLen(unpaddedLen) - unpaddedLen)
  return concatBytes(writeU16BE(unpaddedLen), unpadded, suffix)
}

function unpadPlaintext(padded: Uint8Array): string {
  if (padded.length < 2) {
    throw new Error('nip44: padded plaintext too short')
  }
  const unpaddedLen = readU16BE(padded.subarray(0, 2))
  const rest = padded.subarray(2)
  if (unpaddedLen === 0 || unpaddedLen > rest.length) {
    throw new Error('nip44: invalid padding length prefix')
  }
  return bytesToUtf8(rest.subarray(0, unpaddedLen))
}

function messageKeys(conversationKey: Uint8Array, nonce: Uint8Array): {
  chachaKey: Uint8Array
  chachaNonce: Uint8Array
  hmacKey: Uint8Array
} {
  const expanded = hkdf(sha256, conversationKey, undefined, nonce, MESSAGE_KEYS_LEN)
  return {
    chachaKey: expanded.subarray(0, CHACHA_KEY_LEN),
    chachaNonce: expanded.subarray(CHACHA_KEY_LEN, CHACHA_KEY_LEN + CHACHA_NONCE_LEN),
    hmacKey: expanded.subarray(CHACHA_KEY_LEN + CHACHA_NONCE_LEN)
  }
}

function computeMac(hmacKey: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return hmac(sha256, hmacKey, concatBytes(aad, ciphertext))
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

/**
 * Encrypts `plaintext` for `peerPubkeyHex` using the participant's own
 * identity as the other half of the ECDH. Pass the participant's own pubkey
 * as `peerPubkeyHex` for "encrypt to self". Never takes a private key.
 */
export function nip44EncryptToPeer(peerPubkeyHex: string, plaintext: string): string {
  const { privateKeyHex } = unsafeGetParticipantPrivateKeyForCrypto()
  const conversationKey = deriveConversationKey(privateKeyHex, peerPubkeyHex)
  const nonce = randomBytes(NONCE_LEN)
  const { chachaKey, chachaNonce, hmacKey } = messageKeys(conversationKey, nonce)

  const padded = padPlaintext(plaintext)
  const ciphertext = chacha20(chachaKey, chachaNonce, padded, undefined, 0)
  const mac = computeMac(hmacKey, nonce, ciphertext)

  const payload = concatBytes(Uint8Array.of(NIP44_VERSION), nonce, ciphertext, mac)
  return Buffer.from(payload).toString('base64')
}

/**
 * Decrypts a payload produced by `nip44EncryptToPeer` (or by a peer client's
 * standard NIP-44 v2 encryption to the participant). Throws on a bad MAC or
 * malformed payload. Never returns or takes a private key.
 */
export function nip44DecryptFromPeer(peerPubkeyHex: string, payload: string): string {
  const { privateKeyHex } = unsafeGetParticipantPrivateKeyForCrypto()
  const conversationKey = deriveConversationKey(privateKeyHex, peerPubkeyHex)

  const raw = new Uint8Array(Buffer.from(payload, 'base64'))
  if (raw.length < 1 + NONCE_LEN + 32) {
    throw new Error('nip44: payload too short to be valid')
  }
  const version = raw[0]
  if (version !== NIP44_VERSION) {
    throw new Error(`nip44: unsupported version byte ${version}`)
  }
  const nonce = raw.subarray(1, 1 + NONCE_LEN)
  const mac = raw.subarray(-32)
  const ciphertext = raw.subarray(1 + NONCE_LEN, -32)

  const { chachaKey, chachaNonce, hmacKey } = messageKeys(conversationKey, nonce)
  const expectedMac = computeMac(hmacKey, nonce, ciphertext)
  if (!timingSafeEqual(expectedMac, mac)) {
    throw new Error('nip44: MAC verification failed (corrupted payload or wrong identity)')
  }

  const padded = chacha20(chachaKey, chachaNonce, ciphertext, undefined, 0)
  return unpadPlaintext(padded)
}
