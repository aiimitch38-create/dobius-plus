import { describe, expect, it } from 'vitest'
import { bech32Decode, bech32Encode, convertBits } from './bech32'

describe('bech32', () => {
  it('round-trips arbitrary byte payloads through encode/decode', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 7) % 256)
    const encoded = bech32Encode('nsec', bytes)
    const decoded = bech32Decode(encoded)
    expect(decoded.hrp).toBe('nsec')
    expect(Array.from(decoded.bytes)).toEqual(Array.from(bytes))
  })

  it('round-trips a long payload past the BIP-173 90-char limit (ncryptsec-sized)', () => {
    const bytes = Uint8Array.from({ length: 91 }, (_, i) => i % 256)
    const encoded = bech32Encode('ncryptsec', bytes)
    expect(encoded.length).toBeGreaterThan(90)
    const decoded = bech32Decode(encoded)
    expect(decoded.hrp).toBe('ncryptsec')
    expect(Array.from(decoded.bytes)).toEqual(Array.from(bytes))
  })

  it('rejects a corrupted checksum', () => {
    const encoded = bech32Encode('npub', new Uint8Array(32).fill(1))
    const corrupted = `${encoded.slice(0, -1)}${encoded.at(-1) === 'q' ? 'p' : 'q'}`
    expect(() => bech32Decode(corrupted)).toThrow(/checksum/)
  })

  it('rejects mixed-case input', () => {
    const encoded = bech32Encode('npub', new Uint8Array(32).fill(2))
    const mixed = `${encoded.slice(0, 5).toUpperCase()}${encoded.slice(5)}`
    expect(() => bech32Decode(mixed)).toThrow(/mixed-case/)
  })

  it('convertBits regroups 8-bit bytes into 5-bit words and back losslessly', () => {
    const bytes = [0, 1, 255, 128, 42]
    const fiveBit = convertBits(bytes, 8, 5, true)
    expect(fiveBit).not.toBeNull()
    const back = convertBits(fiveBit as number[], 5, 8, false)
    expect(back).toEqual(bytes)
  })
})
