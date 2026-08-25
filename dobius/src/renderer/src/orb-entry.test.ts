import { describe, expect, it } from 'vitest'
import { parseOrbHash } from './orb-entry'

describe('parseOrbHash', () => {
  it('matches the bare orb route', () => {
    expect(parseOrbHash('#/orb')).toEqual({ kind: 'orb' })
    expect(parseOrbHash('/orb')).toEqual({ kind: 'orb' })
    expect(parseOrbHash('#/orb/')).toEqual({ kind: 'orb' })
  })

  it('rejects every other hash', () => {
    expect(parseOrbHash('')).toBeNull()
    expect(parseOrbHash('#')).toBeNull()
    expect(parseOrbHash('#phone-visual=1&mode=app')).toBeNull()
    expect(parseOrbHash('#terminal-torn-off=1')).toBeNull()
    expect(parseOrbHash('#orbb')).toBeNull()
  })
})
