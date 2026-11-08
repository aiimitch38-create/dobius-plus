import { describe, expect, it } from 'vitest'
import { resolveAdamCharacterState } from './adam-animation-state'

function voice(state: 'idle' | 'listening' | 'thinking' | 'speaking') {
  return { state, activitySource: 'preview' as const }
}

describe('resolveAdamCharacterState', () => {
  it('voice activity always wins over agent status', () => {
    expect(resolveAdamCharacterState(voice('listening'), 'running')).toBe('listening')
    expect(resolveAdamCharacterState(voice('speaking'), 'waiting')).toBe('speaking')
    expect(resolveAdamCharacterState(voice('thinking'), 'review')).toBe('thinking')
  })

  it('falls back to agent status when voice is idle', () => {
    expect(resolveAdamCharacterState(voice('idle'), 'running')).toBe('thinking')
    expect(resolveAdamCharacterState(voice('idle'), 'waiting')).toBe('listening')
    expect(resolveAdamCharacterState(voice('idle'), 'review')).toBe('thinking')
  })

  it('is idle when both voice and agent status are quiet', () => {
    expect(resolveAdamCharacterState(voice('idle'), 'idle')).toBe('idle')
    expect(resolveAdamCharacterState(voice('idle'), 'jumping')).toBe('idle')
  })
})
