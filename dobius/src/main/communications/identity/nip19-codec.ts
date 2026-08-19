// NIP-19 bech32 encodings for the two identifiers this slice needs: `nsec`
// (a raw 32-byte private key) and `npub` (a raw 32-byte x-only pubkey).
// Deliberately does not implement the other NIP-19 TLV types (nprofile,
// nevent, etc.) — nothing in the 18-command scope needs them.
import { bech32Decode, bech32Encode } from './bech32'

const HEX_32_BYTES = /^[0-9a-f]{64}$/

function hexToBytes32(hex: string, label: string): Uint8Array {
  if (!HEX_32_BYTES.test(hex)) {
    throw new Error(`${label}: expected 64 lowercase hex characters`)
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

export function encodeNsec(privateKeyHex: string): string {
  return bech32Encode('nsec', hexToBytes32(privateKeyHex, 'nsec'))
}

/** Throws if `value` is not a well-formed `nsec1...` string. */
export function decodeNsec(value: string): string {
  const { hrp, bytes } = bech32Decode(value)
  if (hrp !== 'nsec' || bytes.length !== 32) {
    throw new Error('nsec: not a valid NIP-19 private key encoding')
  }
  return Buffer.from(bytes).toString('hex')
}

export function encodeNpub(pubkeyHex: string): string {
  return bech32Encode('npub', hexToBytes32(pubkeyHex, 'npub'))
}

/** Throws if `value` is not a well-formed `npub1...` string. */
export function decodeNpub(value: string): string {
  const { hrp, bytes } = bech32Decode(value)
  if (hrp !== 'npub' || bytes.length !== 32) {
    throw new Error('npub: not a valid NIP-19 public key encoding')
  }
  return Buffer.from(bytes).toString('hex')
}

/** True for a syntactically valid `nsec1...` string, without decoding it. */
export function looksLikeNsec(value: string): boolean {
  return /^nsec1[02-9ac-hj-np-z]+$/.test(value.trim().toLowerCase())
}
