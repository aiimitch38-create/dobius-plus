// Generic Bech32 codec (BIP-173 reference algorithm), self-written because
// no @scure/base (or other bech32 package) is present in node_modules and
// adding a new dependency is out of scope for this slice. nsec/npub/ncryptsec
// all ride on this — see nip19-codec.ts and nip49-ncryptsec.ts.
//
// Deliberately does NOT enforce BIP-173's 90-character total-length cap:
// ncryptsec payloads (91 raw bytes -> ~150 bech32 chars) routinely exceed it,
// which is why every real nostr client's bech32 encoder for NIP-19/NIP-49
// disables that check rather than following BIP-173 to the letter.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
const BECH32_CONST = 1

function polymod(values: number[]): number {
  let chk = 1
  for (const v of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i += 1) {
      if ((top >>> i) & 1) {
        chk ^= GENERATOR[i]
      }
    }
  }
  return chk >>> 0
}

function hrpExpand(hrp: string): number[] {
  const high: number[] = []
  const low: number[] = []
  for (let i = 0; i < hrp.length; i += 1) {
    const code = hrp.charCodeAt(i)
    high.push(code >>> 5)
    low.push(code & 31)
  }
  return [...high, 0, ...low]
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]
  const mod = polymod(values) ^ BECH32_CONST
  const checksum: number[] = []
  for (let i = 0; i < 6; i += 1) {
    checksum.push((mod >>> (5 * (5 - i))) & 31)
  }
  return checksum
}

/** Regroups a byte array between bit widths (8<->5 for bech32 data parts). */
export function convertBits(
  data: Uint8Array | number[],
  fromBits: number,
  toBits: number,
  pad: boolean
): number[] | null {
  let acc = 0
  let bits = 0
  const result: number[] = []
  const maxOut = (1 << toBits) - 1
  for (const value of data) {
    if (value < 0 || value >>> fromBits !== 0) {
      return null
    }
    acc = (acc << fromBits) | value
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      result.push((acc >>> bits) & maxOut)
    }
  }
  if (pad) {
    if (bits > 0) {
      result.push((acc << (toBits - bits)) & maxOut)
    }
  } else if (bits >= fromBits || (acc << (toBits - bits)) & maxOut) {
    return null
  }
  return result
}

/** Encodes raw bytes as `<hrp>1<data><checksum>`. No length cap (see file header). */
export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const data = convertBits(bytes, 8, 5, true)
  if (!data) {
    throw new Error('bech32: failed to regroup bytes into 5-bit words')
  }
  const checksum = createChecksum(hrp, data)
  const combined = [...data, ...checksum]
  return `${hrp}1${combined.map((d) => CHARSET[d]).join('')}`
}

export type Bech32Decoded = { hrp: string; bytes: Uint8Array }

/** Decodes a bech32 string back to its human-readable part and raw byte payload. */
export function bech32Decode(value: string): Bech32Decoded {
  const lowered = value.toLowerCase()
  if (lowered !== value && value.toUpperCase() !== value) {
    throw new Error('bech32: mixed-case strings are invalid')
  }
  const sepIndex = lowered.lastIndexOf('1')
  if (sepIndex < 1 || sepIndex + 7 > lowered.length) {
    throw new Error('bech32: missing or misplaced separator')
  }
  const hrp = lowered.slice(0, sepIndex)
  const dataPart = lowered.slice(sepIndex + 1)
  const data: number[] = []
  for (const char of dataPart) {
    const index = CHARSET.indexOf(char)
    if (index === -1) {
      throw new Error('bech32: invalid data character')
    }
    data.push(index)
  }
  const values = [...hrpExpand(hrp), ...data]
  if (polymod(values) !== BECH32_CONST) {
    throw new Error('bech32: checksum verification failed')
  }
  const payload = data.slice(0, -6)
  const bytes = convertBits(payload, 5, 8, false)
  if (!bytes) {
    throw new Error('bech32: failed to regroup 5-bit words into bytes')
  }
  return { hrp, bytes: Uint8Array.from(bytes) }
}
