import { describe, expect, it } from 'vitest'
import { audioLevelFromSamples, decayAudioLevel } from './dictation-audio-level'

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

describe('decayAudioLevel', () => {
  it('returns the full level at the moment it was measured', () => {
    expect(decayAudioLevel(0.8, 0)).toBeCloseTo(0.8)
  })

  it('fades partway through the decay window', () => {
    expect(decayAudioLevel(0.8, 200)).toBeCloseTo(0.4)
  })

  it('reaches zero once the window has passed', () => {
    expect(decayAudioLevel(0.8, 400)).toBe(0)
    expect(decayAudioLevel(0.8, 5000)).toBe(0)
  })
})
