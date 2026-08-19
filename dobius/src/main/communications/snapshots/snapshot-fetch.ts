/**
 * Backs fetch_snapshot_bytes (vendor/buzz-desktop/src/shared/api/
 * tauriMedia.ts). Its own doc comment is explicit about the threat model:
 * "Inputs come directly from the message's imeta fields" — i.e. url/
 * filename/expectedSha256/expectedSize are all attacker-controlled (chosen
 * by whoever sent the message). This is the SSRF-relevant command in the
 * snapshot family: fetching an arbitrary attacker-supplied URL from the
 * main process would let a message attachment probe the local network or
 * cloud metadata endpoints. Mitigations, in order:
 *   1. origin allowlist — only the local Dobius relay's own HTTP origin
 *      (mirrors DOBIUS_RELAY_HTTP_URL in dobiusCommunications.ts, which
 *      this module cannot import — vendor/buzz-desktop is off limits for
 *      this task — so the value is duplicated here as a named constant).
 *   2. a hard byte cap on the response, enforced while streaming so a
 *      malicious/compromised relay can't OOM the main process with an
 *      unbounded body.
 *   3. SHA-256 + exact-size verification against the caller-declared
 *      values BEFORE the bytes are handed back — a mismatch is a hard
 *      failure, never a partial/best-effort return.
 */
import { createHash } from 'node:crypto'

// Why this exact value: matches DOBIUS_RELAY_HTTP_URL in
// vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts (read for
// reference, not imported — see file doc above).
export const SNAPSHOT_FETCH_ALLOWED_ORIGIN = 'http://localhost:3300'
export const MAX_SNAPSHOT_FETCH_BYTES = 8 * 1024 * 1024

export type FetchSnapshotBytesInput = {
  url: string
  filename: string
  expectedSha256: string
  expectedSize: number
}

export type FetchSnapshotBytesResult = { bytesBase64: string }

function assertAllowedOrigin(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid snapshot URL')
  }
  if (parsed.origin !== SNAPSHOT_FETCH_ALLOWED_ORIGIN) {
    throw new Error(`Snapshot URL must be served by the local relay (${SNAPSHOT_FETCH_ALLOWED_ORIGIN})`)
  }
  return parsed
}

function assertValidHash(expectedSha256: string): void {
  if (!/^[0-9a-f]{64}$/i.test(expectedSha256)) {
    throw new Error('Invalid expected SHA-256')
  }
}

/**
 * Fetches, size-caps, and hash-verifies a snapshot attachment. `fetchImpl`
 * defaults to the global `fetch` and is overridable so tests never make a
 * real network call.
 */
export async function fetchSnapshotBytes(
  input: FetchSnapshotBytesInput,
  fetchImpl: typeof fetch = fetch
): Promise<FetchSnapshotBytesResult> {
  assertAllowedOrigin(input.url)
  assertValidHash(input.expectedSha256)
  if (!Number.isInteger(input.expectedSize) || input.expectedSize < 0 || input.expectedSize > MAX_SNAPSHOT_FETCH_BYTES) {
    throw new Error(`Invalid expected size (must be 0-${MAX_SNAPSHOT_FETCH_BYTES})`)
  }

  const response = await fetchImpl(input.url)
  if (!response.ok) {
    throw new Error(`Snapshot fetch failed: HTTP ${response.status}`)
  }
  if (!response.body) {
    throw new Error('Snapshot fetch returned no body')
  }

  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > MAX_SNAPSHOT_FETCH_BYTES) {
      await reader.cancel()
      throw new Error(`Snapshot exceeds ${MAX_SNAPSHOT_FETCH_BYTES} bytes`)
    }
    chunks.push(value)
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))

  if (bytes.length !== input.expectedSize) {
    throw new Error(`Snapshot size mismatch: expected ${input.expectedSize}, got ${bytes.length}`)
  }
  const actualSha256 = createHash('sha256').update(bytes).digest('hex')
  if (actualSha256.toLowerCase() !== input.expectedSha256.toLowerCase()) {
    throw new Error('Snapshot hash mismatch (file may be corrupt or tampered)')
  }

  return { bytesBase64: bytes.toString('base64') }
}
