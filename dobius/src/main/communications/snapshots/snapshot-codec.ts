/**
 * Shared encode/decode + validation for both agent and team snapshots
 * (tauriPersonas.ts / tauriTeams.ts's SnapshotFormat = "json" | "png").
 *
 * SECURITY: a decoded snapshot is, by definition, an opaque blob a file the
 * user was SENT (fetch_snapshot_bytes's own doc: "Inputs come directly from
 * the message's imeta fields"). decodeSnapshotEnvelope enforces: a byte-size
 * cap before any parsing happens, JSON.parse (never eval), a required
 * `magic`/`version` tag checked before any field is trusted, and a shallow
 * structural check (bounded string lengths, bounded array lengths) so a
 * malformed or hostile file fails cleanly with a reason string instead of
 * throwing/crashing or being used to inflate multi-hundred-MB in memory.
 * Callers (agent-snapshot.ts / team-snapshot.ts) still validate their own
 * field-level shape on top of this.
 */
import { decodeSnapshotPng, encodeSnapshotPng } from './snapshot-png'

export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024
export const MAX_SNAPSHOT_STRING_LENGTH = 20_000
export const MAX_SNAPSHOT_ARRAY_LENGTH = 2_000

export type SnapshotFormat = 'json' | 'png'
export type SnapshotMemoryLevel = 'none' | 'core' | 'everything'

export type SnapshotEnvelope<TMagic extends string> = {
  magic: TMagic
  version: 1
} & Record<string, unknown>

export type DecodeEnvelopeResult<T> = { ok: true; value: T } | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Decodes an envelope from raw file bytes, format-sniffed by PNG magic bytes
 * rather than trusting a caller-declared format — a mislabeled/malicious
 * file must still fail cleanly, not be parsed as the wrong container.
 */
export function decodeEnvelopeBytes(
  bytes: Uint8Array,
  expectedMagic: string
): DecodeEnvelopeResult<Record<string, unknown>> {
  if (bytes.length === 0) {
    return { ok: false, reason: 'Snapshot file is empty' }
  }
  if (bytes.length > MAX_SNAPSHOT_BYTES) {
    return { ok: false, reason: `Snapshot file exceeds ${MAX_SNAPSHOT_BYTES} bytes` }
  }
  const buffer = Buffer.from(bytes)
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  let jsonText: string
  if (isPng) {
    const decoded = decodeSnapshotPng(buffer)
    if (!decoded.ok) {
      return { ok: false, reason: decoded.reason }
    }
    jsonText = decoded.payload.toString('utf-8')
  } else {
    jsonText = buffer.toString('utf-8')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: 'Snapshot payload is not valid JSON' }
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: 'Snapshot payload must be a JSON object' }
  }
  if (parsed.magic !== expectedMagic) {
    return { ok: false, reason: `Unrecognized snapshot type (expected "${expectedMagic}")` }
  }
  if (parsed.version !== 1) {
    return { ok: false, reason: `Unsupported snapshot version: ${JSON.stringify(parsed.version)}` }
  }
  return { ok: true, value: parsed }
}

export function encodeEnvelope(
  envelope: Record<string, unknown>,
  format: SnapshotFormat,
  baseImage?: Buffer | null
): Buffer {
  const json = Buffer.from(JSON.stringify(envelope), 'utf-8')
  if (format === 'json') {
    return json
  }
  return encodeSnapshotPng(json, baseImage).bytes
}

/** Bounded string read: honest empty/null rather than throwing, capped length. */
export function readBoundedString(value: unknown, maxLength = MAX_SNAPSHOT_STRING_LENGTH): string | null {
  if (typeof value !== 'string') {
    return null
  }
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

export function readBoundedStringArray(value: unknown, maxItems = MAX_SNAPSHOT_ARRAY_LENGTH): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .slice(0, maxItems)
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => (entry.length > MAX_SNAPSHOT_STRING_LENGTH ? entry.slice(0, MAX_SNAPSHOT_STRING_LENGTH) : entry))
}

/**
 * Parses a `data:image/png;base64,...` URL into raw bytes for use as a PNG
 * snapshot's base image. Returns null for anything else (missing, wrong
 * mime type, malformed base64) — callers fall back to the plain PNG
 * container rather than failing the whole export over a bad avatar.
 */
export function parsePngDataUrl(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) {
    return null
  }
  const match = /^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl.trim())
  if (!match) {
    return null
  }
  try {
    const decoded = Buffer.from(match[1], 'base64')
    return decoded.length > 0 && decoded.length <= MAX_SNAPSHOT_BYTES ? decoded : null
  } catch {
    return null
  }
}
