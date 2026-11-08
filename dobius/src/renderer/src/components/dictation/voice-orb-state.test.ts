import { describe, expect, it } from 'vitest'
import { resolveVoiceOrbPresentation } from './voice-orb-state'

describe('resolveVoiceOrbPresentation', () => {
  const idle = {
    dictationState: 'idle' as const,
    jarvisState: 'idle' as const,
    agentMode: false,
    agentState: 'idle' as const
  }

  it('uses the live microphone while dictation owns capture', () => {
    expect(resolveVoiceOrbPresentation({ ...idle, dictationState: 'listening' })).toEqual({
      state: 'listening',
      activitySource: 'input'
    })
    expect(resolveVoiceOrbPresentation({ ...idle, dictationState: 'stopping' })).toEqual({
      state: 'thinking',
      activitySource: 'preview'
    })
  })

  it('maps Jarvis conversation phases to the saved character states', () => {
    expect(resolveVoiceOrbPresentation({ ...idle, jarvisState: 'thinking' })).toEqual({
      state: 'thinking',
      activitySource: 'preview'
    })
    expect(resolveVoiceOrbPresentation({ ...idle, jarvisState: 'speaking' })).toEqual({
      state: 'speaking',
      activitySource: 'preview'
    })
  })

  it('uses the correct live side of an agent conversation', () => {
    expect(
      resolveVoiceOrbPresentation({ ...idle, agentMode: true, agentState: 'listening' })
    ).toEqual({ state: 'listening', activitySource: 'input' })
    expect(
      resolveVoiceOrbPresentation({ ...idle, agentMode: true, agentState: 'speaking' })
    ).toEqual({ state: 'speaking', activitySource: 'output' })
  })

  it('gives dictation precedence over an already configured voice agent', () => {
    expect(
      resolveVoiceOrbPresentation({
        ...idle,
        dictationState: 'listening',
        agentMode: true,
        agentState: 'speaking'
      })
    ).toEqual({ state: 'listening', activitySource: 'input' })
  })

  it.each(['idle', 'error'] as const)('returns to idle on Jarvis %s', (jarvisState) => {
    expect(resolveVoiceOrbPresentation({ ...idle, jarvisState })).toEqual({
      state: 'idle',
      activitySource: 'preview'
    })
  })

  it.each(['idle', 'error'] as const)('returns to idle on agent %s', (agentState) => {
    expect(
      resolveVoiceOrbPresentation({ ...idle, agentMode: true, agentState, jarvisState: 'speaking' })
    ).toEqual({ state: 'idle', activitySource: 'preview' })
  })

  it('shows thinking while connecting and ignores agents outside live mode', () => {
    expect(
      resolveVoiceOrbPresentation({ ...idle, agentMode: true, agentState: 'connecting' })
    ).toEqual({ state: 'thinking', activitySource: 'preview' })
    expect(
      resolveVoiceOrbPresentation({ ...idle, agentState: 'speaking', jarvisState: 'listening' })
    ).toEqual({ state: 'listening', activitySource: 'input' })
  })

  it('shows listening while starting dictation, even over an active Jarvis turn', () => {
    expect(
      resolveVoiceOrbPresentation({ ...idle, dictationState: 'starting', jarvisState: 'speaking' })
    ).toEqual({ state: 'listening', activitySource: 'input' })
  })
})
