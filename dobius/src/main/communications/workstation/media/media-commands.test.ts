import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const showOpenDialogMock = vi.fn()
vi.mock('electron', () => ({ dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialogMock(...args) } }))

const storeBlobMock = vi.fn()
const readBlobBytesByUrlMock = vi.fn()
const ensureMediaServerStartedMock = vi.fn()
vi.mock('./blob-store', () => ({
  storeBlob: (...args: unknown[]) => storeBlobMock(...args),
  readBlobBytesByUrl: (...args: unknown[]) => readBlobBytesByUrlMock(...args),
  ensureMediaServerStarted: (...args: unknown[]) => ensureMediaServerStartedMock(...args),
  isImageMimeType: (type: string) => type.startsWith('image/')
}))

const { pickAndUploadImage, pickAndUploadMedia, uploadMedia, uploadMediaBytes, fetchMediaBytes, getMediaProxyPort } =
  await import('./media-commands')

describe('media-commands', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-media-cmds-'))
    showOpenDialogMock.mockReset()
    storeBlobMock.mockReset()
    readBlobBytesByUrlMock.mockReset()
    ensureMediaServerStartedMock.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('pickAndUploadImage returns null when the user cancels the dialog', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await pickAndUploadImage()).toBeNull()
    expect(storeBlobMock).not.toHaveBeenCalled()
  })

  it('pickAndUploadImage uploads the chosen file and rejects a non-image result', async () => {
    const filePath = path.join(dir, 'not-image.txt')
    writeFileSync(filePath, 'hello')
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [filePath] })
    storeBlobMock.mockResolvedValue({ url: 'http://x/media/a.txt', sha256: 'a', size: 5, type: 'text/plain', uploaded: 1 })

    await expect(pickAndUploadImage()).rejects.toThrow(/not an image/)
  })

  it('pickAndUploadMedia uploads every selected file', async () => {
    const a = path.join(dir, 'a.bin')
    const b = path.join(dir, 'b.bin')
    writeFileSync(a, 'aaa')
    writeFileSync(b, 'bbb')
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [a, b] })
    storeBlobMock.mockResolvedValue({ url: 'http://x/media/a.bin', sha256: 'a', size: 3, type: 'application/octet-stream', uploaded: 1 })

    const result = await pickAndUploadMedia()
    expect(result).toHaveLength(2)
    expect(storeBlobMock).toHaveBeenCalledTimes(2)
  })

  it('uploadMedia reads the file at filePath and stores it', async () => {
    const filePath = path.join(dir, 'file.bin')
    writeFileSync(filePath, 'contents')
    storeBlobMock.mockResolvedValue({ url: 'http://x/media/a.bin', sha256: 'a', size: 8, type: 'application/octet-stream', uploaded: 1 })

    await uploadMedia(filePath, false)
    expect(storeBlobMock).toHaveBeenCalledWith(Buffer.from('contents'), 'file.bin')
  })

  it('uploadMediaBytes rejects a payload over the size limit without storing it', async () => {
    // Length-only fixture: the size guard reads .length and must reject before any read.
    const tooBig = { length: 200 * 1024 * 1024 + 1 } as unknown as number[]
    await expect(uploadMediaBytes(tooBig, 'huge.bin')).rejects.toThrow(/too large/)
    expect(storeBlobMock).not.toHaveBeenCalled()
  })

  it('uploadMediaBytes stores an ordinary byte payload', async () => {
    storeBlobMock.mockResolvedValue({ url: 'http://x/media/a.bin', sha256: 'a', size: 3, type: 'application/octet-stream', uploaded: 1 })
    await uploadMediaBytes([1, 2, 3], 'small.bin')
    expect(storeBlobMock).toHaveBeenCalledWith(Buffer.from([1, 2, 3]), 'small.bin')
  })

  it('fetchMediaBytes returns a plain number array', async () => {
    readBlobBytesByUrlMock.mockResolvedValue(Buffer.from([9, 8, 7]))
    expect(await fetchMediaBytes('http://x/media/a.bin')).toEqual([9, 8, 7])
  })

  it('getMediaProxyPort delegates to ensureMediaServerStarted', async () => {
    ensureMediaServerStartedMock.mockResolvedValue(54321)
    expect(await getMediaProxyPort()).toBe(54321)
  })
})
