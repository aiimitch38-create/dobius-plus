import { describe, expect, it } from 'vitest'
import { cleanLiveVoiceLogText } from './live-voice-log'

describe('cleanLiveVoiceLogText', () => {
  it('hides key-shaped text and keeps one line', () => {
    expect(cleanLiveVoiceLogText('bad key sk-proj-abc123XYZ\nnext')).toBe('bad key [hidden] next')
    expect(cleanLiveVoiceLogText('x'.repeat(900))).toHaveLength(500)
  })
})
