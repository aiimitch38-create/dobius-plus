import { describe, expect, it } from 'vitest'
import {
  appendPreviewChunk,
  createPreviewAssembly,
  decodeCompletePreviewAssembly,
  disposePreviewAssembly,
  validateCompletePreviewAssembly,
  DATA_CATALOG_PREVIEW_MAX_BYTES,
  DATA_CATALOG_PREVIEW_MAX_CHUNK_BYTES,
  PreviewAssemblyError,
  type PreviewChunkFrame
} from './data-catalog-preview-assembly'

const SESSION = 'session-1'
const VERSION = 'a'.repeat(64)

function frame(
  bytes: Uint8Array,
  offset: number,
  totalBytes: number,
  options: Partial<PreviewChunkFrame> = {}
): PreviewChunkFrame {
  return {
    state: 'chunk',
    previewSessionId: SESSION,
    fileVersion: VERSION,
    totalBytes: String(totalBytes),
    offset,
    nextOffset: offset + bytes.length,
    final: offset + bytes.length === totalBytes,
    dataBase64: Buffer.from(bytes).toString('base64'),
    ...options,
    rootId: options.rootId ?? 'root-catalog-0001',
    generation: options.generation ?? '11111111-1111-4111-8111-111111111111'
  }
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

describe('catalog preview byte assembly', () => {
  it('keeps split UTF-8 bytes private until the exact final chunk and decodes once', () => {
    const encoded = bytes('First line\n😀 last line')
    const split = encoded.findIndex((byte, index) => index > 0 && byte >= 0x80) + 1
    const assembly = createPreviewAssembly(SESSION, VERSION, String(encoded.length))
    appendPreviewChunk(assembly, frame(encoded.slice(0, split), 0, encoded.length))
    expect(assembly.complete).toBe(false)
    expect(() => decodeCompletePreviewAssembly(assembly)).toThrow(PreviewAssemblyError)
    expect(assembly.chunks).toHaveLength(1)

    appendPreviewChunk(assembly, frame(encoded.slice(split), split, encoded.length))
    validateCompletePreviewAssembly(assembly)
    expect(assembly.complete).toBe(true)
    expect(assembly.chunks.some((chunk) => chunk.some((byte) => byte !== 0))).toBe(true)
    expect(decodeCompletePreviewAssembly(assembly)).toBe('First line\n😀 last line')
    expect(assembly.chunks).toHaveLength(0)
  })

  it('accepts the empty file and clears its byte assembly after decoding', () => {
    const assembly = createPreviewAssembly(SESSION, VERSION, '0')
    appendPreviewChunk(assembly, frame(new Uint8Array(), 0, 0))
    expect(decodeCompletePreviewAssembly(assembly)).toBe('')
    expect(assembly.complete).toBe(false)
    expect(assembly.chunks).toEqual([])
  })

  it('accepts the exact file cap and refuses a larger file before allocating a buffer', () => {
    const assembly = createPreviewAssembly(SESSION, VERSION, String(DATA_CATALOG_PREVIEW_MAX_BYTES))
    const chunk = new Uint8Array(DATA_CATALOG_PREVIEW_MAX_CHUNK_BYTES).fill(0x61)
    for (let offset = 0; offset < DATA_CATALOG_PREVIEW_MAX_BYTES; offset += chunk.length) {
      appendPreviewChunk(assembly, frame(chunk, offset, DATA_CATALOG_PREVIEW_MAX_BYTES))
    }
    expect(decodeCompletePreviewAssembly(assembly)).toHaveLength(DATA_CATALOG_PREVIEW_MAX_BYTES)
    expect(() =>
      createPreviewAssembly(SESSION, VERSION, String(DATA_CATALOG_PREVIEW_MAX_BYTES + 1))
    ).toThrow(PreviewAssemblyError)
  })

  it.each([
    ['gap', { offset: 1 }],
    ['duplicate session', { previewSessionId: 'other-session' }],
    ['mixed version', { fileVersion: 'b'.repeat(64) }],
    ['wrong total', { totalBytes: '3' }],
    ['wrong next offset', { nextOffset: 4 }],
    ['premature final', { final: true, nextOffset: 1, payload: 'o' }],
    ['missing final', { final: false }]
  ])('rejects a %s without advancing the assembly', (_name, override) => {
    const assembly = createPreviewAssembly(SESSION, VERSION, '2')
    const payload = 'payload' in override ? String(override.payload) : 'ok'
    expect(() => appendPreviewChunk(assembly, frame(bytes(payload), 0, 2, override))).toThrow(
      PreviewAssemblyError
    )
    expect(assembly.nextOffset).toBe(0)
    expect(assembly.chunks).toHaveLength(0)
  })

  it.each(['Zh==', 'Zg=', 'Zg===', '////!!!!', 'A'.repeat(21_852)])(
    'rejects malformed or noncanonical base64 %s',
    (dataBase64) => {
      const assembly = createPreviewAssembly(SESSION, VERSION, '1')
      expect(() =>
        appendPreviewChunk(assembly, {
          ...frame(bytes('f'), 0, 1),
          dataBase64,
          nextOffset: 1,
          final: true
        })
      ).toThrow(PreviewAssemblyError)
      expect(assembly.chunks).toHaveLength(0)
    }
  )

  it.each([
    new Uint8Array([0xc0, 0xaf]),
    new Uint8Array([0xe2, 0x28, 0xa1]),
    new Uint8Array([0xed, 0xa0, 0x80]),
    new Uint8Array([0xf4, 0x90, 0x80, 0x80]),
    new Uint8Array([0xe2, 0x82])
  ])('refuses invalid UTF-8 without retaining raw buffers', (invalidBytes) => {
    const assembly = createPreviewAssembly(SESSION, VERSION, String(invalidBytes.length))
    appendPreviewChunk(assembly, frame(invalidBytes, 0, invalidBytes.length))
    const stored = assembly.chunks[0]
    expect(() => decodeCompletePreviewAssembly(assembly)).toThrow(
      new PreviewAssemblyError('invalid_utf8')
    )
    expect(stored?.every((byte) => byte === 0)).toBe(true)
    expect(assembly.chunks).toHaveLength(0)
  })

  it.each([0x00, 0x01, 0x08, 0x0b, 0x0c, 0x1f])(
    'refuses non-text C0 control byte 0x%s and zeroes the buffered bytes',
    (control) => {
      const invalidBytes = new Uint8Array([0x61, control, 0x62])
      const assembly = createPreviewAssembly(SESSION, VERSION, String(invalidBytes.length))
      appendPreviewChunk(assembly, frame(invalidBytes, 0, invalidBytes.length))
      const stored = assembly.chunks[0]

      expect(() => decodeCompletePreviewAssembly(assembly)).toThrow(
        new PreviewAssemblyError('non_text')
      )
      expect(stored?.every((byte) => byte === 0)).toBe(true)
      expect(assembly.chunks).toHaveLength(0)
    }
  )

  it('allows tab, line breaks, Unicode and Markdown as literal plain text', () => {
    const text = '# **Literal Markdown**\t☁️\nsecond line\r\n'
    const encoded = bytes(text)
    const assembly = createPreviewAssembly(SESSION, VERSION, String(encoded.length))
    appendPreviewChunk(assembly, frame(encoded, 0, encoded.length))

    expect(decodeCompletePreviewAssembly(assembly)).toBe(text)
  })

  it('zeroes buffered bytes when an in-flight preview is cancelled', () => {
    const assembly = createPreviewAssembly(SESSION, VERSION, '2')
    appendPreviewChunk(assembly, frame(bytes('ok'), 0, 2))
    const stored = assembly.chunks[0]
    disposePreviewAssembly(assembly)
    expect(stored?.every((byte) => byte === 0)).toBe(true)
    expect(assembly.nextOffset).toBe(0)
    expect(assembly.chunks).toHaveLength(0)
  })
})
