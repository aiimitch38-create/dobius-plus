/**
 * Minimal PNG chunk read/write for the "format: png" agent/team snapshots
 * (SnapshotFormat in tauriPersonas.ts/tauriTeams.ts) — the snapshot is a
 * real, openable PNG (the agent/team's avatar when one was supplied) with
 * the JSON snapshot payload embedded in a private ancillary chunk, so a
 * snapshot can be shared as an ordinary-looking image attachment.
 *
 * No PNG library is added as a dependency (pnpm install is off-limits for
 * this task) — chunk framing is simple enough to hand-roll: 4-byte length +
 * 4-byte ASCII type + data + 4-byte CRC-32 (over type+data), using Node's
 * built-in `zlib.crc32` (same CRC-32/ISO-HDLC algorithm the PNG spec calls
 * for). See png-spec chunk-naming rules in CHUNK_TYPE below for why the
 * custom chunk is named "snDt".
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// Why this exact name: PNG chunk-type bytes each carry a case-encoded flag
// (spec §5.4). Byte 0 lowercase = ancillary (a reader may ignore it safely).
// Byte 1 lowercase = private (not a registered public chunk type). Byte 2
// MUST stay uppercase — it's reserved by the current spec. Byte 3 lowercase
// = safe-to-copy (an editor that doesn't understand this chunk may still
// copy it verbatim when it edits the image). "snDt" = s(ancillary)
// n(private) D(reserved-uppercase) t(safe-to-copy).
const CHUNK_TYPE = 'snDt'
const MAX_PNG_BYTES = 8 * 1024 * 1024

function crc32Of(bytes: Buffer): number {
  return crc32(bytes) >>> 0
}

function writeChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBytes = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([typeBytes, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32Of(crcInput), 0)
  return Buffer.concat([length, typeBytes, data, crc])
}

type ParsedChunk = { type: string; data: Buffer; crcOk: boolean }

function readChunks(bytes: Buffer): ParsedChunk[] | null {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null
  }
  const chunks: ParsedChunk[] = []
  let offset = PNG_SIGNATURE.length
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const typeStart = offset + 4
    const dataStart = typeStart + 4
    const dataEnd = dataStart + length
    const crcEnd = dataEnd + 4
    if (length > MAX_PNG_BYTES || crcEnd > bytes.length) {
      return null
    }
    const type = bytes.subarray(typeStart, dataStart).toString('ascii')
    const data = bytes.subarray(dataStart, dataEnd)
    const expectedCrc = bytes.readUInt32BE(dataEnd)
    const actualCrc = crc32Of(bytes.subarray(typeStart, dataEnd))
    chunks.push({ type, data: Buffer.from(data), crcOk: expectedCrc === actualCrc })
    offset = crcEnd
    if (type === 'IEND') {
      break
    }
  }
  return chunks
}

/** A minimal, valid 1x1 transparent PNG (IHDR + IDAT + IEND), used when no real avatar is supplied. */
function buildFallbackImageChunks(): Buffer {
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(1, 0) // width
  ihdrData.writeUInt32BE(1, 4) // height
  ihdrData.writeUInt8(8, 8) // bit depth
  ihdrData.writeUInt8(6, 9) // color type: RGBA
  ihdrData.writeUInt8(0, 10) // compression
  ihdrData.writeUInt8(0, 11) // filter
  ihdrData.writeUInt8(0, 12) // interlace
  const raw = Buffer.from([0, 0, 0, 0, 0]) // filter-type-none byte + 1 transparent RGBA pixel
  const idatData = deflateSync(raw)
  return Buffer.concat([writeChunk('IHDR', ihdrData), writeChunk('IDAT', idatData)])
}

export type EncodedPngResult = { bytes: Buffer }

/**
 * Builds a PNG carrying `payload` in the private snDt chunk. When
 * `baseImage` is a valid PNG (the real avatar), its IHDR/IDAT/etc. chunks
 * are reused verbatim and the snapshot chunk is spliced in immediately
 * before IEND; any pre-existing snDt chunk in the base image is dropped so
 * a re-encode can't accumulate stale payloads. Falls back to a 1x1
 * transparent image when no usable base image is supplied.
 */
export function encodeSnapshotPng(payload: Buffer, baseImage?: Buffer | null): EncodedPngResult {
  const baseChunks = baseImage ? readChunks(baseImage) : null
  const bodyChunks =
    baseChunks && baseChunks.every((chunk) => chunk.crcOk) && baseChunks.some((chunk) => chunk.type === 'IHDR')
      ? baseChunks.filter((chunk) => chunk.type !== 'IEND' && chunk.type !== CHUNK_TYPE)
      : null
  const imageChunkBytes = bodyChunks
    ? Buffer.concat(bodyChunks.map((chunk) => writeChunk(chunk.type, chunk.data)))
    : buildFallbackImageChunks()
  const bytes = Buffer.concat([
    PNG_SIGNATURE,
    imageChunkBytes,
    writeChunk(CHUNK_TYPE, payload),
    writeChunk('IEND', Buffer.alloc(0))
  ])
  return { bytes }
}

export type DecodedPngPayload = { ok: true; payload: Buffer } | { ok: false; reason: string }

/** Extracts and CRC-verifies the snDt payload chunk from a PNG snapshot file. */
export function decodeSnapshotPng(bytes: Buffer): DecodedPngPayload {
  if (bytes.length > MAX_PNG_BYTES) {
    return { ok: false, reason: `PNG exceeds ${MAX_PNG_BYTES} bytes` }
  }
  const chunks = readChunks(bytes)
  if (!chunks) {
    return { ok: false, reason: 'Not a valid PNG file' }
  }
  const payloadChunk = chunks.find((chunk) => chunk.type === CHUNK_TYPE)
  if (!payloadChunk) {
    return { ok: false, reason: 'PNG has no embedded snapshot data' }
  }
  if (!payloadChunk.crcOk) {
    return { ok: false, reason: 'Snapshot chunk failed CRC check (corrupt or tampered file)' }
  }
  return { ok: true, payload: payloadChunk.data }
}

/** Re-exported for tests that need to assert real deflate/inflate round-tripping of the fallback image. */
export function inflateForTest(bytes: Buffer): Buffer {
  return inflateSync(bytes)
}
