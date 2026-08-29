import { describe, expect, it } from 'vitest'
import { chunkForSpeech, resolveElevenLabsConfig } from './elevenlabs-client'

describe('chunkForSpeech', () => {
  it('keeps a short reply in one chunk', () => {
    expect(chunkForSpeech('All seventeen jobs are green.')).toEqual(['All seventeen jobs are green.'])
  })

  it('speaks the first sentence first when the reply is long', () => {
    const long = `${'You have seventeen jobs in flight. '.repeat(1)}${'x'.repeat(300)}`
    const [first, rest] = chunkForSpeech(long)
    expect(first).toBe('You have seventeen jobs in flight.')
    expect(rest).toBe('x'.repeat(300))
  })

  it('does not split when no sentence break lands early enough', () => {
    const noBreak = 'x'.repeat(400)
    expect(chunkForSpeech(noBreak)).toEqual([noBreak])
  })
})

describe('resolveElevenLabsConfig', () => {
  it('prefers saved settings over the environment', () => {
    const config = resolveElevenLabsConfig(
      { elevenlabsApiKey: 'sk_settings', elevenlabsVoiceId: 'voice-a' },
      { ELEVENLABS_API_KEY: 'sk_env', ELEVENLABS_VOICE_ID: 'voice-b' } as NodeJS.ProcessEnv
    )
    expect(config).toEqual({ apiKey: 'sk_settings', voiceId: 'voice-a', modelId: 'eleven_turbo_v2_5' })
  })

  it('falls back to the environment when settings are empty', () => {
    const config = resolveElevenLabsConfig(
      { elevenlabsApiKey: '  ', elevenlabsVoiceId: '' },
      { ELEVENLABS_API_KEY: 'sk_env', ELEVENLABS_VOICE_ID: 'voice-b' } as NodeJS.ProcessEnv
    )
    expect(config?.apiKey).toBe('sk_env')
  })

  it('returns null when neither source has a key and voice', () => {
    expect(resolveElevenLabsConfig(null, {} as NodeJS.ProcessEnv)).toBeNull()
  })
})
