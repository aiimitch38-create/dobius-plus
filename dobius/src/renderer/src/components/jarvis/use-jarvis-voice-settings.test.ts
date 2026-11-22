import { describe, expect, it } from 'vitest'
import { getDefaultVoiceSettings } from '../../../../shared/constants'
import { toJarvisVoiceFlags } from './use-jarvis-voice-settings'

describe('toJarvisVoiceFlags', () => {
  it('chooses OpenAI Live by default but runs Hermes turns while no key is saved', () => {
    const flags = toJarvisVoiceFlags(getDefaultVoiceSettings())
    expect(flags.liveVoice.engine).toBe('openai-live')
    expect(flags.activeVoiceEngine).toBe('hermes')
    expect(flags.preferNativeAdamVoice).toBe(true)
  })

  it('falls back to the ElevenLabs conversation when that was the previous engine', () => {
    const flags = toJarvisVoiceFlags({
      ...getDefaultVoiceSettings(),
      preferNativeAdamVoice: false,
      elevenlabsAgentId: ' agent_1 '
    })
    expect(flags.activeVoiceEngine).toBe('elevenlabs')
    expect(flags.preferNativeAdamVoice).toBe(false)
    expect(flags.agentId).toBe('agent_1')
  })

  it('lets an explicit Hermes choice win over a leftover ElevenLabs flag', () => {
    const flags = toJarvisVoiceFlags({
      ...getDefaultVoiceSettings(),
      liveVoiceEngine: 'hermes',
      preferNativeAdamVoice: false,
      elevenlabsAgentId: 'agent_1'
    })
    expect(flags.preferNativeAdamVoice).toBe(true)
  })

  it('does not throw on a non-string agent id', () => {
    const flags = toJarvisVoiceFlags({
      ...getDefaultVoiceSettings(),
      preferNativeAdamVoice: false,
      elevenlabsAgentId: 42 as unknown as string
    })
    expect(flags.agentId).toBe('')
    expect(flags.activeVoiceEngine).toBe('hermes')
  })

  it('has safe values before settings load', () => {
    expect(toJarvisVoiceFlags(undefined)).toMatchObject({
      jarvisEnabled: false,
      activeVoiceEngine: 'hermes',
      preferNativeAdamVoice: true
    })
  })
})
