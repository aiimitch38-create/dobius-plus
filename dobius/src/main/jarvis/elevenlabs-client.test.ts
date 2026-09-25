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
  const noStoredKey = (): string => ''

  it('uses the protected-store key over the environment (#24)', () => {
    const config = resolveElevenLabsConfig(
      { elevenlabsVoiceId: 'voice-a' },
      { ELEVENLABS_API_KEY: 'sk_env', ELEVENLABS_VOICE_ID: 'voice-b' } as NodeJS.ProcessEnv,
      () => 'sk_stored'
    )
    expect(config).toEqual({ apiKey: 'sk_stored', voiceId: 'voice-a', modelId: 'eleven_turbo_v2_5' })
  })

  it('falls back to the environment when no key is stored', () => {
    const config = resolveElevenLabsConfig(
      { elevenlabsVoiceId: '' },
      { ELEVENLABS_API_KEY: 'sk_env', ELEVENLABS_VOICE_ID: 'voice-b' } as NodeJS.ProcessEnv,
      noStoredKey
    )
    expect(config?.apiKey).toBe('sk_env')
  })

  it('does not read the key store when no voice is pinned', () => {
    let reads = 0
    const config = resolveElevenLabsConfig(null, {} as NodeJS.ProcessEnv, () => {
      reads += 1
      return 'sk_stored'
    })
    expect(config).toBeNull()
    expect(reads).toBe(0)
  })

  it('returns null when neither source has a key and voice', () => {
    expect(resolveElevenLabsConfig(null, {} as NodeJS.ProcessEnv, noStoredKey)).toBeNull()
  })
})
