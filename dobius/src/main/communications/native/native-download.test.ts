import { describe, expect, it, vi } from 'vitest'
import {
  downloadFile,
  downloadImage,
  filenameFromUrl,
  DOWNLOAD_MAX_BYTES,
  type NativeDownloadDeps
} from './native-download'

function makeDeps(overrides: Partial<NativeDownloadDeps> = {}): NativeDownloadDeps {
  return {
    fetchBytes: vi.fn(async () => Buffer.from('bytes')),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: '/tmp/out.bin' })),
    writeFile: vi.fn(async () => {}),
    ...overrides
  }
}

describe('filenameFromUrl', () => {
  it('takes the last decoded path segment', () => {
    expect(filenameFromUrl('https://relay.example/media/My%20Image.png')).toBe('My Image.png')
  })

  it('falls back to "image" for a path with no segments', () => {
    expect(filenameFromUrl('https://relay.example/')).toBe('image')
  })

  it('falls back to "image" for an unparseable URL', () => {
    expect(filenameFromUrl('not a url')).toBe('image')
  })
})

describe('downloadFile', () => {
  it('rejects non-http(s) URLs before showing the dialog', async () => {
    const deps = makeDeps()
    await expect(
      downloadFile({ url: 'file:///etc/passwd', filename: 'x' }, deps)
    ).rejects.toThrow('Only http(s)')
    expect(deps.showSaveDialog).not.toHaveBeenCalled()
  })

  it('shows the dialog before fetching, and fetches nothing on cancel', async () => {
    const deps = makeDeps({ showSaveDialog: vi.fn(async () => ({ canceled: true })) })
    const result = await downloadFile({ url: 'https://relay.example/f', filename: 'f.bin' }, deps)
    expect(result).toEqual({ downloaded: false })
    expect(deps.fetchBytes).not.toHaveBeenCalled()
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it('fetches and writes the file to the chosen path', async () => {
    const deps = makeDeps()
    const result = await downloadFile({ url: 'https://relay.example/f', filename: 'f.bin' }, deps)
    expect(result).toEqual({ downloaded: true, filePath: '/tmp/out.bin' })
    expect(deps.fetchBytes).toHaveBeenCalledWith('https://relay.example/f')
    expect(deps.writeFile).toHaveBeenCalledWith('/tmp/out.bin', Buffer.from('bytes'))
  })

  it('rejects an oversized download without writing to disk', async () => {
    const oversized = Buffer.alloc(DOWNLOAD_MAX_BYTES + 1)
    const deps = makeDeps({ fetchBytes: vi.fn(async () => oversized) })
    await expect(
      downloadFile({ url: 'https://relay.example/f', filename: 'f.bin' }, deps)
    ).rejects.toThrow('too large')
    expect(deps.writeFile).not.toHaveBeenCalled()
  })
})

describe('downloadImage', () => {
  it('derives the filename from the URL and delegates to downloadFile', async () => {
    const deps = makeDeps()
    const result = await downloadImage({ url: 'https://relay.example/media/pic.jpg' }, deps)
    expect(result).toEqual({ downloaded: true, filePath: '/tmp/out.bin' })
    expect(deps.showSaveDialog).toHaveBeenCalledWith('pic.jpg')
  })
})
