import { describe, expect, it } from 'vitest'
import { isTrustedCommunicationsGuestUrl } from './communications-guest'

describe('trusted Communications guest URL', () => {
  it('accepts only the bundled Buzz entry beneath the configured dev renderer origin', () => {
    const options = { rendererUrl: 'http://localhost:5173/' }
    expect(
      isTrustedCommunicationsGuestUrl(
        'http://localhost:5173/buzz/index.html?embed=dobius&bridge=1',
        options
      )
    ).toBe(true)
    expect(
      isTrustedCommunicationsGuestUrl('http://localhost:5173/?embed=dobius', options)
    ).toBe(false)
    expect(
      isTrustedCommunicationsGuestUrl('http://127.0.0.1:5173/buzz/index.html?embed=dobius', options)
    ).toBe(false)
  })

  it('accepts the packaged renderer entry and rejects lookalike file URLs', () => {
    const options = { rendererUrl: '', mainBundleDirectory: '/app/out/main' }
    expect(
      isTrustedCommunicationsGuestUrl(
        'file:///app/out/renderer/buzz/index.html?embed=dobius',
        options
      )
    ).toBe(true)
    expect(
      isTrustedCommunicationsGuestUrl(
        'file:///tmp/renderer/buzz/index.html?embed=dobius',
        options
      )
    ).toBe(false)
  })

  it.each([
    'not a url',
    'https://example.com/buzz/index.html?embed=dobius',
    'http://localhost:5173/buzz/index.html',
    'http://localhost:5173/buzz/index.html?embed=other'
  ])('rejects an untrusted source: %s', (sourceUrl) => {
    expect(
      isTrustedCommunicationsGuestUrl(sourceUrl, {
        rendererUrl: 'http://localhost:5173/'
      })
    ).toBe(false)
  })
})

