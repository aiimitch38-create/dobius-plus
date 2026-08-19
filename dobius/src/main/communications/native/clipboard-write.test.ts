import { describe, expect, it, vi } from 'vitest'
import {
  copyImageToClipboard,
  copyTextToClipboard,
  CLIPBOARD_IMAGE_MAX_BYTES
} from './clipboard-write'

describe('copyTextToClipboard', () => {
  it('writes plain text when no html is given', () => {
    const writeText = vi.fn()
    const writeTextAndHtml = vi.fn()
    const result = copyTextToClipboard({ text: 'hello' }, { writeText, writeTextAndHtml })
    expect(result).toEqual({ copied: true })
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(writeTextAndHtml).not.toHaveBeenCalled()
  })

  it('writes text+html together when html is given', () => {
    const writeText = vi.fn()
    const writeTextAndHtml = vi.fn()
    copyTextToClipboard(
      { text: 'hello', html: '<b>hello</b>' },
      { writeText, writeTextAndHtml }
    )
    expect(writeTextAndHtml).toHaveBeenCalledWith({ text: 'hello', html: '<b>hello</b>' })
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('copyImageToClipboard', () => {
  it('rejects non-http(s) URLs before fetching', async () => {
    const fetchBytes = vi.fn()
    await expect(
      copyImageToClipboard(
        { url: 'file:///etc/passwd' },
        { createImageFromBuffer: vi.fn(), writeImage: vi.fn(), fetchBytes }
      )
    ).rejects.toThrow('Only http(s)')
    expect(fetchBytes).not.toHaveBeenCalled()
  })

  it('fetches, converts, and writes the image to the clipboard', async () => {
    const buffer = Buffer.from('fake-image-bytes')
    const fetchBytes = vi.fn(async () => buffer)
    const image = { marker: 'native-image' }
    const createImageFromBuffer = vi.fn(() => image)
    const writeImage = vi.fn()
    const result = await copyImageToClipboard(
      { url: 'https://relay.example/media/1.png' },
      { createImageFromBuffer, writeImage, fetchBytes }
    )
    expect(result).toEqual({ copied: true })
    expect(fetchBytes).toHaveBeenCalledWith('https://relay.example/media/1.png')
    expect(createImageFromBuffer).toHaveBeenCalledWith(buffer)
    expect(writeImage).toHaveBeenCalledWith(image)
  })

  it('rejects an oversized image without writing to the clipboard', async () => {
    const oversized = Buffer.alloc(CLIPBOARD_IMAGE_MAX_BYTES + 1)
    const writeImage = vi.fn()
    await expect(
      copyImageToClipboard(
        { url: 'https://relay.example/media/1.png' },
        {
          createImageFromBuffer: vi.fn(),
          writeImage,
          fetchBytes: async () => oversized
        }
      )
    ).rejects.toThrow('too large')
    expect(writeImage).not.toHaveBeenCalled()
  })
})
