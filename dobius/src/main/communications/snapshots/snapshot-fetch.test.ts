import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { MAX_SNAPSHOT_FETCH_BYTES, SNAPSHOT_FETCH_ALLOWED_ORIGIN, fetchSnapshotBytes } from './snapshot-fetch'

function bodyStreamFor(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
}

function makeFetch(bytes: Uint8Array, opts: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () =>
    ({
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      body: bodyStreamFor(bytes)
    }) as unknown as Response
  )
}

describe('fetchSnapshotBytes', () => {
  const goodUrl = `${SNAPSHOT_FETCH_ALLOWED_ORIGIN}/media/abc.png`

  it('fetches, verifies hash + size, and returns base64 bytes', async () => {
    const bytes = Buffer.from('snapshot payload bytes')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fetchImpl = makeFetch(bytes)

    const result = await fetchSnapshotBytes(
      { url: goodUrl, filename: 'x.json', expectedSha256: sha256, expectedSize: bytes.length },
      fetchImpl
    )
    expect(Buffer.from(result.bytesBase64, 'base64')).toEqual(bytes)
    expect(fetchImpl).toHaveBeenCalledWith(goodUrl)
  })

  it('rejects a URL on a different origin (SSRF guard)', async () => {
    const fetchImpl = makeFetch(Buffer.from('x'))
    await expect(
      fetchSnapshotBytes(
        { url: 'https://evil.example.com/x.png', filename: 'x', expectedSha256: 'a'.repeat(64), expectedSize: 1 },
        fetchImpl
      )
    ).rejects.toThrow(/must be served by the local relay/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an invalid URL', async () => {
    const fetchImpl = makeFetch(Buffer.from('x'))
    await expect(
      fetchSnapshotBytes({ url: 'not a url', filename: 'x', expectedSha256: 'a'.repeat(64), expectedSize: 1 }, fetchImpl)
    ).rejects.toThrow(/Invalid snapshot URL/)
  })

  it('rejects a malformed expected hash', async () => {
    const fetchImpl = makeFetch(Buffer.from('x'))
    await expect(
      fetchSnapshotBytes({ url: goodUrl, filename: 'x', expectedSha256: 'not-hex', expectedSize: 1 }, fetchImpl)
    ).rejects.toThrow(/Invalid expected SHA-256/)
  })

  it('rejects an out-of-range expected size', async () => {
    const fetchImpl = makeFetch(Buffer.from('x'))
    await expect(
      fetchSnapshotBytes({ url: goodUrl, filename: 'x', expectedSha256: 'a'.repeat(64), expectedSize: -1 }, fetchImpl)
    ).rejects.toThrow(/Invalid expected size/)
    await expect(
      fetchSnapshotBytes(
        { url: goodUrl, filename: 'x', expectedSha256: 'a'.repeat(64), expectedSize: MAX_SNAPSHOT_FETCH_BYTES + 1 },
        fetchImpl
      )
    ).rejects.toThrow(/Invalid expected size/)
  })

  it('rejects a non-ok HTTP response', async () => {
    const fetchImpl = makeFetch(Buffer.from('x'), { ok: false, status: 404 })
    await expect(
      fetchSnapshotBytes({ url: goodUrl, filename: 'x', expectedSha256: 'a'.repeat(64), expectedSize: 1 }, fetchImpl)
    ).rejects.toThrow(/HTTP 404/)
  })

  it('rejects a size mismatch even when the hash of the wrong-size bytes happens to be requested correctly', async () => {
    const bytes = Buffer.from('actual bytes')
    const fetchImpl = makeFetch(bytes)
    await expect(
      fetchSnapshotBytes(
        { url: goodUrl, filename: 'x', expectedSha256: 'a'.repeat(64), expectedSize: bytes.length + 5 },
        fetchImpl
      )
    ).rejects.toThrow(/size mismatch/)
  })

  it('rejects a hash mismatch', async () => {
    const bytes = Buffer.from('actual bytes')
    const fetchImpl = makeFetch(bytes)
    await expect(
      fetchSnapshotBytes(
        { url: goodUrl, filename: 'x', expectedSha256: 'a'.repeat(64), expectedSize: bytes.length },
        fetchImpl
      )
    ).rejects.toThrow(/hash mismatch/)
  })

  it('aborts a response that exceeds the byte cap while streaming', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const chunkCount = Math.ceil(MAX_SNAPSHOT_FETCH_BYTES / chunk.length) + 2
    const cancel = vi.fn()
    const fetchImpl = vi.fn(async () => {
      let sent = 0
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= chunkCount) {
            controller.close()
            return
          }
          sent += 1
          controller.enqueue(chunk)
        },
        cancel
      })
      return { ok: true, status: 200, body: stream } as unknown as Response
    })
    await expect(
      fetchSnapshotBytes(
        { url: goodUrl, filename: 'x', expectedSha256: 'a'.repeat(64), expectedSize: MAX_SNAPSHOT_FETCH_BYTES },
        fetchImpl
      )
    ).rejects.toThrow(/exceeds/)
  })
})
