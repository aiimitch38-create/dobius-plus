import { describe, expect, it } from 'vitest'
import { boardAssetId, boardAssetSrc, isBoardAssetSrc } from './board-image-assets'

describe('board image asset refs', () => {
  it('round-trips an id through the src form', () => {
    const src = boardAssetSrc('abc-123')
    expect(src).toBe('board-asset:abc-123')
    expect(isBoardAssetSrc(src)).toBe(true)
    expect(boardAssetId(src)).toBe('abc-123')
  })

  it('treats other srcs as pass-through', () => {
    expect(isBoardAssetSrc('data:image/png;base64,AAA')).toBe(false)
    expect(boardAssetId('https://example.com/a.png')).toBeNull()
    expect(boardAssetId('board-asset:')).toBeNull()
  })
})
