import { describe, expect, it } from 'vitest'
import { buildE2EEAuthPayload, buildE2EEAuthPayloadFromFrame } from './e2ee-handshake'

describe('buildE2EEAuthPayload (#17 handshake v2)', () => {
  it('echoes the server challenge', () => {
    expect(
      buildE2EEAuthPayload('tok', { type: 'e2ee_ready', version: 2, challenge: 'c1' })
    ).toEqual({
      type: 'e2ee_auth',
      deviceToken: 'tok',
      challenge: 'c1'
    })
  })

  it('omits the field for an older server with no challenge', () => {
    expect(buildE2EEAuthPayload('tok', { type: 'e2ee_ready' })).toEqual({
      type: 'e2ee_auth',
      deviceToken: 'tok'
    })
    expect(buildE2EEAuthPayload('tok', { type: 'e2ee_ready', challenge: 7 })).toEqual({
      type: 'e2ee_auth',
      deviceToken: 'tok'
    })
  })

  it('reads the challenge from a raw ready frame', () => {
    expect(
      buildE2EEAuthPayloadFromFrame('tok', JSON.stringify({ type: 'e2ee_ready', challenge: 'c2' }))
    ).toEqual({ type: 'e2ee_auth', deviceToken: 'tok', challenge: 'c2' })
    expect(buildE2EEAuthPayloadFromFrame('tok', 'not json')).toEqual({
      type: 'e2ee_auth',
      deviceToken: 'tok'
    })
  })
})
