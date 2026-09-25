import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import type * as Crypto from 'node:crypto'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))

// Counts sha256 hashing so tests can see when a served blob is re-verified.
const hashCalls = vi.hoisted(() => ({ count: 0 }))
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof Crypto>('node:crypto')
  return {
    ...actual,
    createHash: (algorithm: string) => {
      hashCalls.count += 1
      return actual.createHash(algorithm)
    }
  }
})

// One-shot crash simulation: the next blob write lands only half its bytes, then fails.
const writeFaults = vi.hoisted(() => ({ interruptNextWrite: false }))
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
  return {
    ...actual,
    writeFile: async (file: string, data: Buffer) => {
      if (writeFaults.interruptNextWrite) {
        writeFaults.interruptNextWrite = false
        await actual.writeFile(file, data.subarray(0, Math.floor(data.length / 2)))
        throw Object.assign(new Error('simulated crash mid-write'), { code: 'EIO' })
      }
      await actual.writeFile(file, data)
    }
  }
})

const { storeBlob, readBlobBytesByUrl, mediaServerOrigin, stopMediaServerForTests, isImageMimeType } = await import(
  './blob-store'
)

describe('blob-store', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-media-'))
    writeFaults.interruptNextWrite = false
  })

  const mediaDir = (): string => path.join(userDataDir, 'workstation-media')
  const pngBytes = (): Buffer =>
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 7)])

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

  it('an interrupted write never publishes a partial blob, and a same-hash retry stores it complete', async () => {
    const bytes = pngBytes()
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    writeFaults.interruptNextWrite = true
    await expect(storeBlob(bytes, 'photo.png')).rejects.toThrow(/simulated crash/)
    expect(readdirSync(mediaDir())).toEqual([])

    const descriptor = await storeBlob(bytes, 'photo.png')
    expect(descriptor.sha256).toBe(sha256)
    expect(readFileSync(path.join(mediaDir(), `${sha256}.png`)).equals(bytes)).toBe(true)
    expect((await readBlobBytesByUrl(descriptor.url)).equals(bytes)).toBe(true)
    const response = await fetch(descriptor.url)
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true)
  })

  it('repairs a half-written blob left by an older build when the same content is stored again', async () => {
    const bytes = pngBytes()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const blobPath = path.join(mediaDir(), `${sha256}.png`)
    mkdirSync(mediaDir(), { recursive: true })
    writeFileSync(blobPath, bytes.subarray(0, 100))

    const descriptor = await storeBlob(bytes, 'photo.png')

    expect(readFileSync(blobPath).equals(bytes)).toBe(true)
    expect((await readBlobBytesByUrl(descriptor.url)).equals(bytes)).toBe(true)
    expect(readdirSync(mediaDir())).toEqual([`${sha256}.png`])
  })

  it('never serves or returns a blob whose bytes do not match its hash', async () => {
    const bytes = pngBytes()
    const descriptor = await storeBlob(bytes, 'photo.png')
    writeFileSync(path.join(mediaDir(), `${descriptor.sha256}.png`), bytes.subarray(0, 100))

    expect((await fetch(descriptor.url)).status).toBe(404)
    await expect(readBlobBytesByUrl(descriptor.url)).rejects.toThrow(/missing or incomplete/)
  })

  it('sweeps temp files abandoned by a crashed write, keeping fresh ones', async () => {
    mkdirSync(mediaDir(), { recursive: true })
    const stale = `${'a'.repeat(64)}.png.999999999.0123456789ab.tmp`
    const fresh = `${'b'.repeat(64)}.png.999999999.0123456789ab.tmp`
    writeFileSync(path.join(mediaDir(), stale), 'partial')
    writeFileSync(path.join(mediaDir(), fresh), 'partial')
    const old = new Date(Date.now() - 60 * 60_000)
    utimesSync(path.join(mediaDir(), stale), old, old)

    await storeBlob(Buffer.from('anything'), 'file.txt')

    const names = readdirSync(mediaDir())
    expect(names).not.toContain(stale)
    expect(names).toContain(fresh)
  })

  it('does not re-hash an unchanged blob on repeated serves', async () => {
    const bytes = pngBytes()
    const descriptor = await storeBlob(bytes, 'photo.png')

    let before = hashCalls.count
    expect(Buffer.from(await (await fetch(descriptor.url)).arrayBuffer()).equals(bytes)).toBe(true)
    expect(hashCalls.count - before).toBe(1)

    before = hashCalls.count
    expect(Buffer.from(await (await fetch(descriptor.url)).arrayBuffer()).equals(bytes)).toBe(true)
    expect((await fetch(descriptor.url, { method: 'HEAD' })).status).toBe(200)
    expect((await readBlobBytesByUrl(descriptor.url)).equals(bytes)).toBe(true)
    expect(hashCalls.count - before).toBe(0)
  })

  it('re-verifies a served blob after its size or mtime changes', async () => {
    const bytes = pngBytes()
    const descriptor = await storeBlob(bytes, 'photo.png')
    const blobPath = path.join(mediaDir(), `${descriptor.sha256}.png`)
    await fetch(descriptor.url)

    // mtime only: re-hashed, still valid.
    const later = new Date(Date.now() + 60_000)
    utimesSync(blobPath, later, later)
    let before = hashCalls.count
    expect((await fetch(descriptor.url)).status).toBe(200)
    expect(hashCalls.count - before).toBe(1)

    // size changed (truncated in place): re-hashed, rejected.
    writeFileSync(blobPath, bytes.subarray(0, 100))
    before = hashCalls.count
    expect((await fetch(descriptor.url)).status).toBe(404)
    expect(hashCalls.count - before).toBe(1)
  })
})
