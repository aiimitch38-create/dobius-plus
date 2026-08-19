import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))

const { storeBlob, readBlobBytesByUrl, mediaServerOrigin, stopMediaServerForTests, isImageMimeType } = await import(
  './blob-store'
)

describe('blob-store', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-media-'))
  })

  afterEach(async () => {
    await stopMediaServerForTests()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('stores bytes content-addressed by sha256 and serves them back over real HTTP', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const descriptor = await storeBlob(bytes, 'photo.png')

    expect(descriptor.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(descriptor.size).toBe(bytes.length)
    expect(descriptor.type).toBe('image/png')
    expect(descriptor.url).toBe(`${mediaServerOrigin()}/media/${descriptor.sha256}.png`)
    expect(isImageMimeType(descriptor.type)).toBe(true)

    const response = await fetch(descriptor.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    const roundTripped = Buffer.from(await response.arrayBuffer())
    expect(roundTripped.equals(bytes)).toBe(true)
  })

  it('returns 404 for an unknown hash instead of leaking a directory listing', async () => {
    await storeBlob(Buffer.from('anything'), 'file.txt')
    const response = await fetch(`${mediaServerOrigin()}/media/${'0'.repeat(64)}.png`)
    expect(response.status).toBe(404)
  })

  it('rejects reading a blob URL from a different origin (same-origin guard)', async () => {
    await storeBlob(Buffer.from('anything'), 'file.txt')
    await expect(readBlobBytesByUrl(`https://evil.example.com/media/${'a'.repeat(64)}.png`)).rejects.toThrow(
      /not hosted by this media server/
    )
  })

  it('rejects a malformed URL', async () => {
    await expect(readBlobBytesByUrl('not a url')).rejects.toThrow(/Invalid media URL/)
  })
})
