import { describe, expect, it } from 'vitest'
import {
  isWebTileBrowserPageId,
  takeWebTilePopupToken,
  webTileBrowserPageId,
  webTilePopupUrl
} from './board-web-tile-popup'

describe('web tile popup URLs', () => {
  it('keeps http(s) and turns about:blank into an empty tile', () => {
    expect(webTilePopupUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(webTilePopupUrl('http://localhost:3000')).toBe('http://localhost:3000/')
    expect(webTilePopupUrl('about:blank')).toBe('')
    expect(webTilePopupUrl('')).toBe('')
  })

  it('drops javascript:, file:, data: and custom schemes', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'myapp://x', 'not a url']) {
      expect(webTilePopupUrl(url)).toBeNull()
    }
  })

  it('allows 3 popups per 10 s per guest and refills as old ones age out', () => {
    const recent: number[] = []
    expect(takeWebTilePopupToken(recent, 1_000)).toBe(true)
    expect(takeWebTilePopupToken(recent, 2_000)).toBe(true)
    expect(takeWebTilePopupToken(recent, 3_000)).toBe(true)
    expect(takeWebTilePopupToken(recent, 4_000)).toBe(false)
    expect(takeWebTilePopupToken(recent, 11_001)).toBe(true)
    expect(takeWebTilePopupToken(recent, 11_002)).toBe(false)
    expect(recent).toHaveLength(3)
  })

  it('names and recognises tile page ids', () => {
    expect(webTileBrowserPageId('card-1')).toBe('web-tile:card-1')
    expect(isWebTileBrowserPageId('web-tile:card-1')).toBe(true)
    expect(isWebTileBrowserPageId('browser-1')).toBe(false)
    expect(isWebTileBrowserPageId(null)).toBe(false)
  })
})
