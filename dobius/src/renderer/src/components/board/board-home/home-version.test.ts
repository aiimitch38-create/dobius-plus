import { describe, expect, it } from 'vitest'
import { electronVersionFromUserAgent, homeVersionLabel } from './home-version'

describe('homeVersionLabel', () => {
  it('prefers the version stamped at build time', () => {
    expect(homeVersionLabel('2.0.10', '42.4.1', '42.4.1')).toBe('2.0.10')
  })

  it('uses the runtime version when no build version exists', () => {
    expect(homeVersionLabel(undefined, '2.0.10', '42.4.1')).toBe('2.0.10')
  })

  it("hides Electron's own version instead of showing it as the app's", () => {
    expect(homeVersionLabel('', '42.4.1', '42.4.1')).toBeNull()
  })

  it('hides the footer when nothing is known', () => {
    expect(homeVersionLabel(null, null, null)).toBeNull()
  })
})

describe('electronVersionFromUserAgent', () => {
  it('reads the Electron token', () => {
    expect(
      electronVersionFromUserAgent(
        'Mozilla/5.0 (Macintosh) Chrome/140.0 Electron/42.4.1 Safari/537.36'
      )
    ).toBe('42.4.1')
    expect(electronVersionFromUserAgent('Mozilla/5.0 Chrome/140.0')).toBeNull()
  })
})
