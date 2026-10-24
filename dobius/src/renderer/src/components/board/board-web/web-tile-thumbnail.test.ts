import { describe, expect, it, vi } from 'vitest'
import {
  WEB_THUMBNAIL_MAX_WIDTH,
  captureWebTileThumbnail,
  type ThumbnailImage
} from './web-tile-thumbnail'

function fakeImage(width: number, empty = false): ThumbnailImage {
  const image: ThumbnailImage = {
    isEmpty: () => empty,
    getSize: () => ({ width, height: width / 2 }),
    resize: vi.fn(({ width: w }: { width: number }) => fakeImage(w)),
    toDataURL: () => `data:image/png;w=${width}`
  }
  return image
}

describe('captureWebTileThumbnail', () => {
  it('returns a data URL of the guest frame', async () => {
    const guest = { capturePage: vi.fn(async () => fakeImage(640)) }
    expect(await captureWebTileThumbnail(guest)).toBe('data:image/png;w=640')
  })

  it('downscales wide frames', async () => {
    const guest = { capturePage: async () => fakeImage(2400) }
    expect(await captureWebTileThumbnail(guest)).toBe(`data:image/png;w=${WEB_THUMBNAIL_MAX_WIDTH}`)
  })

  it('gives null (keep the previous still) for empty frames, failures and missing guests', async () => {
    expect(
      await captureWebTileThumbnail({ capturePage: async () => fakeImage(640, true) })
    ).toBeNull()
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    expect(
      await captureWebTileThumbnail({
        capturePage: () => Promise.reject(new Error('not attached'))
      })
    ).toBeNull()
    debug.mockRestore()
    expect(await captureWebTileThumbnail(null)).toBeNull()
    expect(await captureWebTileThumbnail({})).toBeNull()
  })
})
