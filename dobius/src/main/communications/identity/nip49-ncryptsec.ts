// NIP-49 "ncryptsec" — a password-encrypted, portable backup of a Nostr
// private key. Layout (91 bytes before bech32):
//   version(1) | log_n(1) | salt(16) | nonce(24) | key_security_byte(1) | ciphertext(48)
// ciphertext is XChaCha20-Poly1305(scrypt(password, salt), nonce, privkey)
// with the key_security_byte as AAD. This is the only place in the app a
// private key is allowed to leave main-process memory as a value — and even
// then only ever as this AEAD ciphertext, never in the clear.
import { scryptAsync } from '@noble/hashes/scrypt'
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { randomBytes } from '@noble/hashes/utils'
import { bech32Decode, bech32Encode } from './bech32'

const NCRYPTSEC_HRP = 'ncryptsec'
const VERSION = 0x02
const SALT_LEN = 16
const NONCE_LEN = 24
const KEY_LEN = 32

/**
 * Key-security byte per NIP-49 §Key security:
 * 0x00 = key has been known to be handled insecurely (exposed to a browser)
 * 0x01 = key has NOT been known to be exposed insecurely
 * 0x02 = the client does not track this
 * Every key this module ever encrypts lived only in main-process memory and
 * Electron safeStorage, so 0x01 is the honest, always-true value here.
 */
const KEY_SECURITY_NOT_KNOWN_EXPOSED = 0x01

/** scrypt N = 2^16. Costs ~150-300ms on typical hardware; NIP-49 recommends >= 2^16. */
const DEFAULT_LOG_N = 16

async function deriveScryptKey(password: string, salt: Uint8Array, logN: number): Promise<Uint8Array> {
  // NIP-49 requires NFKC normalization before the password is used as KDF input.
  const normalized = password.normalize('NFKC')
  return scryptAsync(new TextEncoder().encode(normalized), salt, {
    N: 2 ** logN,
    r: 8,
    p: 1,
    dkLen: KEY_LEN
  })
}

export type NcryptsecEncryptOptions = {
  /** scrypt cost exponent (N = 2^logN). Defaults to 16. */
  logN?: number
}

/** Encrypts a raw 32-byte hex private key into a bech32 `ncryptsec1...` backup string. */
export async function encryptToNcryptsec(
  privateKeyHex: string,
  password: string,
  options: NcryptsecEncryptOptions = {}
): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(privateKeyHex)) {
    throw new Error('encryptToNcryptsec: private key must be 64 lowercase hex characters')
  }
  const logN = options.logN ?? DEFAULT_LOG_N
  const salt = randomBytes(SALT_LEN)
  const nonce = randomBytes(NONCE_LEN)
  const key = await deriveScryptKey(password, salt, logN)
  const aad = Uint8Array.of(KEY_SECURITY_NOT_KNOWN_EXPOSED)
  const privateKeyBytes = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'))
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(privateKeyBytes)

  const packed = new Uint8Array(1 + 1 + SALT_LEN + NONCE_LEN + 1 + ciphertext.length)
  let offset = 0
  packed[offset] = VERSION
  offset += 1
  packed[offset] = logN
  offset += 1
  packed.set(salt, offset)
  offset += SALT_LEN
  packed.set(nonce, offset)
  offset += NONCE_LEN
  packed[offset] = KEY_SECURITY_NOT_KNOWN_EXPOSED
  offset += 1
  packed.set(ciphertext, offset)

  return bech32Encode(NCRYPTSEC_HRP, packed)
}

export type NcryptsecDecryptResult = {
  privateKeyHex: string
}

/**
 * Decrypts an `ncryptsec1...` backup string. Throws on a malformed blob or a
 * wrong password (AEAD authentication failure) — callers must not treat a
 * caught error as "wrong password" for any other reason without checking it.
 */
export async function decryptNcryptsec(
  ncryptsec: string,
  password: string
): Promise<NcryptsecDecryptResult> {
  const { hrp, bytes } = bech32Decode(ncryptsec)
  if (hrp !== NCRYPTSEC_HRP) {
    throw new Error('decryptNcryptsec: not an ncryptsec-encoded backup')
  }
  const expectedLen = 1 + 1 + SALT_LEN + NONCE_LEN + 1 + KEY_LEN + 16 // +16 = poly1305 tag
  if (bytes.length !== expectedLen) {
    throw new Error('decryptNcryptsec: unexpected backup length')
  }

  let offset = 0
  const version = bytes[offset]
  offset += 1
  if (version !== VERSION) {
    throw new Error(`decryptNcryptsec: unsupported version byte 0x${version.toString(16)}`)
  }
  const logN = bytes[offset]
  offset += 1
  const salt = bytes.subarray(offset, offset + SALT_LEN)
  offset += SALT_LEN
  const nonce = bytes.subarray(offset, offset + NONCE_LEN)
  offset += NONCE_LEN
  const keySecurityByte = bytes.subarray(offset, offset + 1)
  offset += 1
  const ciphertext = bytes.subarray(offset)

  const key = await deriveScryptKey(password, salt, logN)
  let plaintext: Uint8Array
  try {
    plaintext = xchacha20poly1305(key, nonce, keySecurityByte).decrypt(ciphertext)
  } catch {
    throw new Error('decryptNcryptsec: incorrect password or corrupted backup')
  }
  if (plaintext.length !== KEY_LEN) {
    throw new Error('decryptNcryptsec: decrypted payload has an unexpected length')
  }
  return { privateKeyHex: Buffer.from(plaintext).toString('hex') }
}
