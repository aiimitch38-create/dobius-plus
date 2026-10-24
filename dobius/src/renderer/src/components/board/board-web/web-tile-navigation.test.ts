import { describe, expect, it } from 'vitest'
import { webTileAddressUrl } from './web-tile-navigation'

describe('webTileAddressUrl', () => {
  it('searches bare words instead of creating an unresolvable hostname', () => {
    expect(webTileAddressUrl('google', 'google')).toBe('https://www.google.com/search?q=google')
    expect(webTileAddressUrl('react hooks', 'duckduckgo')).toBe(
      'https://duckduckgo.com/?q=react%20hooks'
    )
  })
  it.each([
    ['google.com', 'https://google.com/'],
    ['localhost:3000', 'http://localhost:3000/'],
    ['http://intranet/', 'http://intranet/'],
    ['https://example.com/docs?q=1', 'https://example.com/docs?q=1']
  ])('preserves navigation for %s', (input, target) => {
    expect(webTileAddressUrl(input, 'google')).toBe(target)
  })
  it('rejects blank addresses and executable schemes', () => {
    expect(webTileAddressUrl('  ', 'google')).toBeNull()
    expect(webTileAddressUrl('javascript:alert(1)', 'google')).toBeNull()
  })
  it('uses the selected search engine, including a configured Kagi session', () => {
    expect(webTileAddressUrl('release notes', 'bing')).toBe(
      'https://www.bing.com/search?q=release%20notes'
    )
    const url = new URL(
      webTileAddressUrl('release notes', 'kagi', {
        kagiSessionLink: 'https://kagi.com/search?token=test-token'
      })!
    )
    expect(url.hostname).toBe('kagi.com')
    expect(url.searchParams.get('q')).toBe('release notes')
    expect(url.searchParams.get('token')).toBe('test-token')
  })
})
