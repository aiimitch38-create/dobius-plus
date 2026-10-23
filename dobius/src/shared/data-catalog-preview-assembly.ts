import type { DataCatalogPreviewChunkResult } from './data-catalog-preview-schema'

export const DATA_CATALOG_PREVIEW_MAX_BYTES = 256 * 1024
export const DATA_CATALOG_PREVIEW_MAX_CHUNK_BYTES = 16 * 1024

export type PreviewChunkFrame = Extract<DataCatalogPreviewChunkResult, { state: 'chunk' }>

export type PreviewAssembly = {
  readonly previewSessionId: string
  readonly fileVersion: string
  readonly totalBytes: number
  nextOffset: number
  complete: boolean
  chunks: Uint8Array[]
}

export class PreviewAssemblyError extends Error {
  constructor(
    readonly reason: 'invalid' | 'too_large' | 'incomplete' | 'invalid_utf8' | 'non_text'
  ) {
    super(reason)
    this.name = 'PreviewAssemblyError'
  }
}

export function createPreviewAssembly(
  previewSessionId: string,
  fileVersion: string,
  totalBytes: string
): PreviewAssembly {
  if (!previewSessionId || !/^[a-f0-9]{64}$/.test(fileVersion)) {
    throw new PreviewAssemblyError('invalid')
  }
  const parsedTotal = parseBoundedByteCount(totalBytes)
  if (parsedTotal === null) {
    throw new PreviewAssemblyError('invalid')
  }
  if (parsedTotal > DATA_CATALOG_PREVIEW_MAX_BYTES) {
    throw new PreviewAssemblyError('too_large')
  }
  return {
    previewSessionId,
    fileVersion,
    totalBytes: parsedTotal,
    nextOffset: 0,
    complete: false,
    chunks: []
  }
}

export function appendPreviewChunk(assembly: PreviewAssembly, chunk: PreviewChunkFrame): void {
  if (
    assembly.complete ||
    chunk.state !== 'chunk' ||
    chunk.previewSessionId !== assembly.previewSessionId ||
    chunk.fileVersion !== assembly.fileVersion ||
    parseBoundedByteCount(chunk.totalBytes) !== assembly.totalBytes ||
    !Number.isSafeInteger(chunk.offset) ||
    !Number.isSafeInteger(chunk.nextOffset) ||
    chunk.offset !== assembly.nextOffset
  ) {
    throw new PreviewAssemblyError('invalid')
  }

  const bytes = decodeCanonicalBase64(chunk.dataBase64)
  const nextOffset = chunk.offset + bytes.length
  const isFinalOffset = nextOffset === assembly.totalBytes
  if (
    bytes.length > DATA_CATALOG_PREVIEW_MAX_CHUNK_BYTES ||
    chunk.nextOffset !== nextOffset ||
    nextOffset > assembly.totalBytes ||
    chunk.final !== isFinalOffset ||
    (bytes.length === 0 && !(assembly.totalBytes === 0 && chunk.final && chunk.offset === 0))
  ) {
    bytes.fill(0)
    throw new PreviewAssemblyError('invalid')
  }

  assembly.chunks.push(bytes)
  assembly.nextOffset = nextOffset
  assembly.complete = chunk.final
}

/** Validate fatal UTF-8 and text eligibility without retaining decoded text. */
export function validateCompletePreviewAssembly(assembly: PreviewAssembly): void {
  const bytes = copyCompleteAssembly(assembly)
  try {
    assertTextEligible(bytes)
    decodeUtf8Strict(bytes)
  } catch (error) {
    if (error instanceof PreviewAssemblyError) {
      throw error
    }
    throw new PreviewAssemblyError('invalid_utf8')
  } finally {
    bytes.fill(0)
  }
}

/** Decode only after authorization finishes. Always erase byte buffers. */
export function decodeCompletePreviewAssembly(assembly: PreviewAssembly): string {
  const bytes = copyCompleteAssembly(assembly)
  try {
    assertTextEligible(bytes)
    try {
      return decodeUtf8Strict(bytes)
    } catch {
      throw new PreviewAssemblyError('invalid_utf8')
    }
  } finally {
    bytes.fill(0)
    disposePreviewAssembly(assembly)
  }
}

function copyCompleteAssembly(assembly: PreviewAssembly): Uint8Array {
  if (!assembly.complete || assembly.nextOffset !== assembly.totalBytes) {
    throw new PreviewAssemblyError('incomplete')
  }
  const bytes = new Uint8Array(assembly.totalBytes)
  let offset = 0
  for (const chunk of assembly.chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

function assertTextEligible(bytes: Uint8Array): void {
  if (containsForbiddenC0Control(bytes)) {
    throw new PreviewAssemblyError('non_text')
  }
}

function containsForbiddenC0Control(bytes: Uint8Array): boolean {
  return bytes.some((byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)
}

export function disposePreviewAssembly(assembly: PreviewAssembly): void {
  for (const chunk of assembly.chunks) {
    chunk.fill(0)
  }
  assembly.chunks.length = 0
  assembly.nextOffset = 0
  assembly.complete = false
}

function parseBoundedByteCount(value: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    return null
  }
  if (value.length > 15) {
    return DATA_CATALOG_PREVIEW_MAX_BYTES + 1
  }
  const bytes = Number(value)
  return Number.isSafeInteger(bytes) ? bytes : null
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (
    value.length > Math.ceil(DATA_CATALOG_PREVIEW_MAX_CHUNK_BYTES / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new PreviewAssemblyError('invalid')
  }
  if (value.length === 0) {
    return new Uint8Array(0)
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const output = new Uint8Array((value.length / 4) * 3 - padding)
  let outputOffset = 0
  for (let index = 0; index < value.length; index += 4) {
    const a = alphabet.indexOf(value[index])
    const b = alphabet.indexOf(value[index + 1])
    const c = value[index + 2] === '=' ? 0 : alphabet.indexOf(value[index + 2])
    const d = value[index + 3] === '=' ? 0 : alphabet.indexOf(value[index + 3])
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      output.fill(0)
      throw new PreviewAssemblyError('invalid')
    }
    const word = (a << 18) | (b << 12) | (c << 6) | d
    if (outputOffset < output.length) {
      output[outputOffset++] = (word >> 16) & 0xff
    }
    if (outputOffset < output.length) {
      output[outputOffset++] = (word >> 8) & 0xff
    }
    if (outputOffset < output.length) {
      output[outputOffset++] = word & 0xff
    }
  }

  const unusedBitsCharIndex = padding === 2 ? value.length - 3 : value.length - 2
  const unusedBitsChar = value[unusedBitsCharIndex]
  if (
    (padding === 2 &&
      (unusedBitsChar === undefined || (alphabet.indexOf(unusedBitsChar) & 0x0f) !== 0)) ||
    (padding === 1 &&
      (unusedBitsChar === undefined || (alphabet.indexOf(unusedBitsChar) & 0x03) !== 0))
  ) {
    output.fill(0)
    throw new PreviewAssemblyError('invalid')
  }
  return output
}

function decodeUtf8Strict(bytes: Uint8Array): string {
  const pieces: string[] = []
  let codePoints: number[] = []
  const append = (codePoint: number): void => {
    codePoints.push(codePoint)
    if (codePoints.length === 2048) {
      pieces.push(String.fromCodePoint(...codePoints))
      codePoints = []
    }
  }

  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index]
    if (first <= 0x7f) {
      append(first)
      index += 1
      continue
    }
    if (first >= 0xc2 && first <= 0xdf) {
      const second = continuation(bytes, index + 1)
      append(((first & 0x1f) << 6) | (second & 0x3f))
      index += 2
      continue
    }
    if (first >= 0xe0 && first <= 0xef) {
      const second = continuation(bytes, index + 1)
      const third = continuation(bytes, index + 2)
      if ((first === 0xe0 && second < 0xa0) || (first === 0xed && second > 0x9f)) {
        throw new Error('invalid_utf8')
      }
      append(((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f))
      index += 3
      continue
    }
    if (first >= 0xf0 && first <= 0xf4) {
      const second = continuation(bytes, index + 1)
      const third = continuation(bytes, index + 2)
      const fourth = continuation(bytes, index + 3)
      if ((first === 0xf0 && second < 0x90) || (first === 0xf4 && second > 0x8f)) {
        throw new Error('invalid_utf8')
      }
      append(
        ((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f)
      )
      index += 4
      continue
    }
    throw new Error('invalid_utf8')
  }
  if (codePoints.length > 0) {
    pieces.push(String.fromCodePoint(...codePoints))
  }
  return pieces.join('')
}

function continuation(bytes: Uint8Array, index: number): number {
  const byte = bytes[index]
  if (byte === undefined || byte < 0x80 || byte > 0xbf) {
    throw new Error('invalid_utf8')
  }
  return byte
}
