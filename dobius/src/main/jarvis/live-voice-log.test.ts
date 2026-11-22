import { describe, expect, it } from 'vitest'
import { cleanLiveVoiceLogText } from './live-voice-log'

describe('cleanLiveVoiceLogText', () => {
  it('hides key-shaped text and keeps one line', () => {
    expect(cleanLiveVoiceLogText('bad key sk-proj-abc123XYZ\nnext')).toBe('bad key [hidden] next')
    expect(cleanLiveVoiceLogText('x'.repeat(900))).toHaveLength(500)
  })
})

describe('cleanLiveVoiceLogText secrets', () => {
  it('hides ephemeral keys and SDP credentials', () => {
    expect(cleanLiveVoiceLogText('ek_abcdef123 a=ice-pwd:s3cr3t a=ice-ufrag:u1')).toBe(
      '[hidden] a=ice-pwd:[hidden] a=ice-ufrag:[hidden]'
    )
  })
})
