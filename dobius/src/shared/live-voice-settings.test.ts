import { describe, expect, it } from 'vitest'
import { getDefaultVoiceSettings } from './constants'
import {
  normalizeLiveVoiceDailyCapUsd,
  normalizeLiveVoiceIdleTimeoutSec,
  normalizeLiveVoiceMicMode,
  normalizeOpenAiLiveVoice,
  resolveActiveVoiceEngine,
  resolveLiveVoiceEngine,
  resolveLiveVoiceSettings
} from './live-voice-settings'
import type { VoiceSettings } from './speech-types'

function voice(patch: Partial<VoiceSettings>): VoiceSettings {
  return { ...getDefaultVoiceSettings(), ...patch }
}

// Settings as an older build saved them: no live voice fields at all.
function legacyVoice(patch: Partial<VoiceSettings>): VoiceSettings {
  const {
    liveVoiceEngine: _engine,
    openAiLiveVoice: _voice,
    liveVoiceMicMode: _mic,
    liveVoiceDailyCapUsd: _cap,
    liveVoiceIdleTimeoutSec: _idle,
    ...rest
  } = getDefaultVoiceSettings()
  return { ...rest, ...patch }
}

describe('live voice defaults', () => {
  it('defaults to OpenAI Live, marin, push-to-talk, a $15 cap and a 30 second idle timeout', () => {
    expect(getDefaultVoiceSettings()).toMatchObject({
      liveVoiceEngine: 'openai-live',
      openAiLiveVoice: 'marin',
      liveVoiceMicMode: 'push-to-talk',
      liveVoiceDailyCapUsd: 15,
      liveVoiceIdleTimeoutSec: 30
    })
    expect(resolveLiveVoiceSettings(undefined)).toEqual({
      engine: 'openai-live',
      voice: 'marin',
      micMode: 'push-to-talk',
      dailyCapUsd: 15,
      idleTimeoutSec: 30
    })
  })
})

describe('resolveLiveVoiceEngine (migration of saved settings)', () => {
  it('moves settings that never chose an engine to OpenAI Live', () => {
    expect(resolveLiveVoiceEngine(legacyVoice({}))).toBe('openai-live')
    expect(resolveLiveVoiceEngine(legacyVoice({ preferNativeAdamVoice: true }))).toBe('openai-live')
    expect(resolveLiveVoiceEngine(legacyVoice({ elevenlabsAgentId: 'agent_1' }))).toBe(
      'openai-live'
    )
  })

  it('keeps someone who explicitly switched to the ElevenLabs conversation', () => {
    expect(
      resolveLiveVoiceEngine(
        legacyVoice({ preferNativeAdamVoice: false, elevenlabsAgentId: 'agent_1' })
      )
    ).toBe('elevenlabs')
  })

  it('keeps an explicit choice and ignores a bad stored value', () => {
    expect(resolveLiveVoiceEngine(voice({ liveVoiceEngine: 'hermes' }))).toBe('hermes')
    expect(resolveLiveVoiceEngine(voice({ liveVoiceEngine: 'elevenlabs' }))).toBe('elevenlabs')
    expect(resolveLiveVoiceEngine(voice({ liveVoiceEngine: 'bogus' as unknown as 'hermes' }))).toBe(
      'openai-live'
    )
  })
})

describe('resolveActiveVoiceEngine (runtime fallback)', () => {
  it('falls back to Hermes turns when OpenAI Live has no key', () => {
    expect(resolveActiveVoiceEngine(voice({ openAiApiKeyConfigured: false }), false)).toBe('hermes')
    expect(resolveActiveVoiceEngine(voice({ openAiApiKeyConfigured: false }))).toBe('hermes')
  })

  it('falls back to the ElevenLabs conversation when that was the previous engine', () => {
    expect(
      resolveActiveVoiceEngine(
        voice({ preferNativeAdamVoice: false, elevenlabsAgentId: 'agent_1' }),
        false
      )
    ).toBe('elevenlabs')
  })

  it('runs OpenAI Live once it is available', () => {
    expect(resolveActiveVoiceEngine(voice({ openAiApiKeyConfigured: true }), true)).toBe(
      'openai-live'
    )
  })

  it('runs Hermes when ElevenLabs is chosen without an agent id', () => {
    expect(resolveActiveVoiceEngine(voice({ liveVoiceEngine: 'elevenlabs' }), true)).toBe('hermes')
    expect(
      resolveActiveVoiceEngine(
        voice({ liveVoiceEngine: 'elevenlabs', elevenlabsAgentId: 'agent_1' }),
        true
      )
    ).toBe('elevenlabs')
  })

  it('keeps an explicit Hermes choice whatever the key state', () => {
    expect(resolveActiveVoiceEngine(voice({ liveVoiceEngine: 'hermes' }), true)).toBe('hermes')
  })
})

describe('live voice normalizers', () => {
  it('accepts a simple voice name and falls back to marin otherwise', () => {
    expect(normalizeOpenAiLiveVoice(' Cedar ')).toBe('cedar')
    expect(normalizeOpenAiLiveVoice('')).toBe('marin')
    expect(normalizeOpenAiLiveVoice('a b; rm')).toBe('marin')
    expect(normalizeOpenAiLiveVoice(7)).toBe('marin')
  })

  it('defaults the microphone to push-to-talk', () => {
    expect(normalizeLiveVoiceMicMode('hands-free')).toBe('hands-free')
    expect(normalizeLiveVoiceMicMode('always')).toBe('push-to-talk')
  })

  it('keeps the daily cap between 1 and 500 dollars', () => {
    expect(normalizeLiveVoiceDailyCapUsd(22.456)).toBe(22.46)
    expect(normalizeLiveVoiceDailyCapUsd(0)).toBe(1)
    expect(normalizeLiveVoiceDailyCapUsd(-5)).toBe(1)
    expect(normalizeLiveVoiceDailyCapUsd(9999)).toBe(500)
    expect(normalizeLiveVoiceDailyCapUsd(Number.NaN)).toBe(15)
    expect(normalizeLiveVoiceDailyCapUsd('15')).toBe(15)
  })

  it('keeps the idle timeout a whole number from 5 to 60', () => {
    expect(normalizeLiveVoiceIdleTimeoutSec(12.4)).toBe(12)
    expect(normalizeLiveVoiceIdleTimeoutSec(1)).toBe(5)
    expect(normalizeLiveVoiceIdleTimeoutSec(600)).toBe(60)
    expect(normalizeLiveVoiceIdleTimeoutSec(undefined)).toBe(30)
  })
})

describe('malformed saved settings', () => {
  const damaged = [
    { preferNativeAdamVoice: false, elevenlabsAgentId: 42 },
    { preferNativeAdamVoice: false, elevenlabsAgentId: { id: 'agent_1' } },
    { liveVoiceEngine: 'elevenlabs', elevenlabsAgentId: ['agent_1'] },
    { liveVoiceEngine: 7, openAiLiveVoice: {}, liveVoiceMicMode: [], liveVoiceDailyCapUsd: 'x' },
    'not an object',
    null
  ] as unknown as VoiceSettings[]

  it.each(damaged.map((value) => [value]))('never throws on %j', (value) => {
    expect(() => resolveLiveVoiceSettings(value)).not.toThrow()
    expect(() => resolveActiveVoiceEngine(value)).not.toThrow()
    expect(() => resolveActiveVoiceEngine(value, true)).not.toThrow()
  })

  it('treats a non-string agent id as no agent id', () => {
    expect(resolveLiveVoiceEngine(damaged[0])).toBe('openai-live')
    expect(resolveActiveVoiceEngine(damaged[2], true)).toBe('hermes')
  })
})
