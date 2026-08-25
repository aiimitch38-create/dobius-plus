import { describe, expect, it } from 'vitest'
import { applyJarvisSignal } from './jarvis-state'

describe('applyJarvisSignal', () => {
  it('mode-on lands in idle from any phase', () => {
    expect(applyJarvisSignal('error', { type: 'mode-on' })).toBe('idle')
    expect(applyJarvisSignal('speaking', { type: 'mode-on' })).toBe('idle')
  })

  it('mode-off always returns to idle', () => {
    expect(applyJarvisSignal('thinking', { type: 'mode-off' })).toBe('idle')
    expect(applyJarvisSignal('listening', { type: 'mode-off' })).toBe('idle')
  })

  it('ask-started enters thinking', () => {
    expect(applyJarvisSignal('idle', { type: 'ask-started' })).toBe('thinking')
  })

  it('speak-started enters speaking', () => {
    expect(applyJarvisSignal('thinking', { type: 'speak-started' })).toBe('speaking')
  })

  it('turn-finished returns thinking and speaking to idle', () => {
    expect(applyJarvisSignal('thinking', { type: 'turn-finished' })).toBe('idle')
    expect(applyJarvisSignal('speaking', { type: 'turn-finished' })).toBe('idle')
  })

  it('errors surface as the error phase regardless of current phase', () => {
    expect(applyJarvisSignal('idle', { type: 'error', reason: 'x' })).toBe('error')
    expect(applyJarvisSignal('thinking', { type: 'error' })).toBe('error')
  })
})
