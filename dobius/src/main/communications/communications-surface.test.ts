import { describe, expect, it } from 'vitest'
import { isTrustedCommunicationsSurfaceUrl } from './communications-surface'

describe('Communications surface trust rule', () => {
  it('accepts any path on the dev renderer origin (SPA routes included)', () => {
    const options = { rendererUrl: 'http://localhost:5173/' }
    expect(isTrustedCommunicationsSurfaceUrl('http://localhost:5173/', options)).toBe(true)
    expect(isTrustedCommunicationsSurfaceUrl('http://localhost:5173/#/buzz', options)).toBe(true)
  })

  it('rejects other origins and garbage in dev mode', () => {
    const options = { rendererUrl: 'http://localhost:5173/' }
    expect(isTrustedCommunicationsSurfaceUrl('https://example.com/', options)).toBe(false)
    expect(isTrustedCommunicationsSurfaceUrl('http://127.0.0.1:5173/', options)).toBe(false)
    expect(isTrustedCommunicationsSurfaceUrl('not a url', options)).toBe(false)
  })

  it('accepts packaged file: URLs under the renderer directory', () => {
    const options = { mainBundleDirectory: '/app/out/main' }
    expect(isTrustedCommunicationsSurfaceUrl('file:///app/out/renderer/index.html', options)).toBe(true)
  })

  it('rejects packaged file: URLs outside the renderer directory', () => {
    const options = { mainBundleDirectory: '/app/out/main' }
    expect(isTrustedCommunicationsSurfaceUrl('file:///etc/passwd', options)).toBe(false)
    expect(isTrustedCommunicationsSurfaceUrl('file:///app/other/index.html', options)).toBe(false)
    expect(isTrustedCommunicationsSurfaceUrl('https://example.com/', options)).toBe(false)
  })
})
