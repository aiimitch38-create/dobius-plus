import { describe, expect, it } from 'vitest'
import {
  MAX_SNAPSHOT_BYTES,
  decodeEnvelopeBytes,
  encodeEnvelope,
  parsePngDataUrl,
  readBoundedString,
  readBoundedStringArray
} from './snapshot-codec'
import { encodeSnapshotPng } from './snapshot-png'

describe('snapshot-codec', () => {
  it('round-trips a JSON-format envelope', () => {
    const envelope = { magic: 'test-magic', version: 1 as const, foo: 'bar' }
    const bytes = encodeEnvelope(envelope, 'json')
    const decoded = decodeEnvelopeBytes(bytes, 'test-magic')
    expect(decoded).toEqual({ ok: true, value: envelope })
  })

  it('round-trips a PNG-format envelope', () => {
    const envelope = { magic: 'test-magic', version: 1 as const, foo: 'bar' }
    const bytes = encodeEnvelope(envelope, 'png')
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47') // PNG signature prefix
    const decoded = decodeEnvelopeBytes(bytes, 'test-magic')
    expect(decoded).toEqual({ ok: true, value: envelope })
  })

  it('rejects empty bytes', () => {
    expect(decodeEnvelopeBytes(new Uint8Array(), 'x')).toEqual({ ok: false, reason: 'Snapshot file is empty' })
  })

  it('rejects bytes over the size cap', () => {
    const huge = new Uint8Array(MAX_SNAPSHOT_BYTES + 1)
    const decoded = decodeEnvelopeBytes(huge, 'x')
    expect(decoded.ok).toBe(false)
  })

  it('rejects malformed JSON', () => {
    const decoded = decodeEnvelopeBytes(Buffer.from('{not json'), 'x')
    expect(decoded).toEqual({ ok: false, reason: 'Snapshot payload is not valid JSON' })
  })

  it('rejects JSON that is not an object (array/scalar/null)', () => {
    expect(decodeEnvelopeBytes(Buffer.from('[1,2,3]'), 'x').ok).toBe(false)
    expect(decodeEnvelopeBytes(Buffer.from('"a string"'), 'x').ok).toBe(false)
    expect(decodeEnvelopeBytes(Buffer.from('null'), 'x').ok).toBe(false)
  })

  it('rejects a mismatched magic string', () => {
    const bytes = encodeEnvelope({ magic: 'actual', version: 1 }, 'json')
    const decoded = decodeEnvelopeBytes(bytes, 'expected')
    expect(decoded).toEqual({ ok: false, reason: 'Unrecognized snapshot type (expected "expected")' })
  })

  it('rejects an unsupported version', () => {
    const bytes = encodeEnvelope({ magic: 'x', version: 2 }, 'json')
    const decoded = decodeEnvelopeBytes(bytes, 'x')
    expect(decoded).toEqual({ ok: false, reason: 'Unsupported snapshot version: 2' })
  })

  it('rejects a PNG whose embedded chunk decodes to invalid JSON', () => {
    // A real PNG (so it sniffs as PNG) but the payload chunk isn't JSON.
    const bytes = encodeSnapshotPng(Buffer.from('not json')).bytes
    const decoded = decodeEnvelopeBytes(bytes, 'x')
    expect(decoded).toEqual({ ok: false, reason: 'Snapshot payload is not valid JSON' })
  })

  describe('readBoundedString / readBoundedStringArray', () => {
    it('returns null for non-strings, truncates over-length strings', () => {
      expect(readBoundedString(42)).toBeNull()
      expect(readBoundedString(null)).toBeNull()
      expect(readBoundedString('short')).toBe('short')
      expect(readBoundedString('a'.repeat(10), 5)).toBe('aaaaa')
    })

    it('filters non-strings out of arrays and caps length/item size', () => {
      expect(readBoundedStringArray(['a', 1, null, 'b'])).toEqual(['a', 'b'])
      expect(readBoundedStringArray('not-an-array')).toEqual([])
      expect(readBoundedStringArray(['x', 'y', 'z'], 2)).toEqual(['x', 'y'])
    })
  })

  describe('parsePngDataUrl', () => {
    it('decodes a valid PNG data URL', () => {
      const b64 = Buffer.from('fake-png-bytes').toString('base64')
      expect(parsePngDataUrl(`data:image/png;base64,${b64}`)).toEqual(Buffer.from('fake-png-bytes'))
    })

    it('returns null for missing, wrong-mime, or malformed input', () => {
      expect(parsePngDataUrl(null)).toBeNull()
      expect(parsePngDataUrl(undefined)).toBeNull()
      expect(parsePngDataUrl('data:image/jpeg;base64,abcd')).toBeNull()
      expect(parsePngDataUrl('not a data url at all')).toBeNull()
    })
  })
})
