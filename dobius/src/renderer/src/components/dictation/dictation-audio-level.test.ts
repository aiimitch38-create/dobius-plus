import { describe, expect, it } from 'vitest'
import { audioLevelFromSamples, holdAudioLevel } from './dictation-audio-level'

describe('audioLevelFromSamples', () => {
  it('reports zero for silence', () => {
    expect(audioLevelFromSamples(new Float32Array(512))).toBe(0)
  })

  it('reports zero for an empty buffer', () => {
    expect(audioLevelFromSamples(new Float32Array(0))).toBe(0)
  })

  it('maps quiet speech into the lower half of the range', () => {
    const level = audioLevelFromSamples(new Float32Array(512).fill(0.03))
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThan(0.5)
  })

  it('clamps loud audio to 1', () => {
    expect(audioLevelFromSamples(new Float32Array(512).fill(0.9))).toBe(1)
  })
})

describe('holdAudioLevel', () => {
  it('holds the level flat between capture chunks', () => {
    // Chunks arrive ~85ms apart; every reading in that gap must be identical,
    // otherwise the orb sees a sawtooth and visibly jitters.
    expect(holdAudioLevel(0.8, 0)).toBe(0.8)
    expect(holdAudioLevel(0.8, 85)).toBe(0.8)
    expect(holdAudioLevel(0.8, 400)).toBe(0.8)
  })

  it('falls back to silence when capture has stalled', () => {
    expect(holdAudioLevel(0.8, 501)).toBe(0)
    expect(holdAudioLevel(0.8, 5000)).toBe(0)
  })
})
