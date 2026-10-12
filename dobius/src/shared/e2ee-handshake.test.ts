import { describe, expect, it } from 'vitest'
import { beginE2EEAuth, beginE2EEAuthFromFrame } from './e2ee-handshake'
import { isE2EESequenced } from './e2ee-sequencing'

describe('beginE2EEAuth (#17 handshake v2)', () => {
  it('echoes the challenge and turns on frame sequencing for a v2 server', () => {
    const key = new Uint8Array(32)
    expect(beginE2EEAuth(key, 'tok', { type: 'e2ee_ready', version: 2, challenge: 'c1' })).toEqual({
      type: 'e2ee_auth',
      deviceToken: 'tok',
      challenge: 'c1'
    })
    expect(isE2EESequenced(key)).toBe(true)
  })

  it('keeps the v1 format for an older server', () => {
    for (const ready of [
      { type: 'e2ee_ready' },
      { type: 'e2ee_ready', challenge: 'c1' },
      { type: 'e2ee_ready', version: 2, challenge: 7 }
    ]) {
      const key = new Uint8Array(32)
      expect(beginE2EEAuth(key, 'tok', ready)).toEqual({ type: 'e2ee_auth', deviceToken: 'tok' })
      expect(isE2EESequenced(key)).toBe(false)
    }
  })

  it('reads the challenge from a raw ready frame', () => {
    const key = new Uint8Array(32)
    expect(
      beginE2EEAuthFromFrame(
        key,
        'tok',
        JSON.stringify({ type: 'e2ee_ready', version: 2, challenge: 'c2' })
      )
    ).toEqual({ type: 'e2ee_auth', deviceToken: 'tok', challenge: 'c2' })
    expect(beginE2EEAuthFromFrame(new Uint8Array(32), 'tok', 'not json')).toEqual({
      type: 'e2ee_auth',
      deviceToken: 'tok'
    })
  })
})
