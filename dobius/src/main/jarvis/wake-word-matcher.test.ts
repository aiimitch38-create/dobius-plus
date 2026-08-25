import { describe, expect, it } from 'vitest'
import { createWakeWordMatcher, WAKE_WORD_WINDOW_MS } from './wake-word-matcher'

function makeMatcher(now: { value: number }, windowMs = WAKE_WORD_WINDOW_MS) {
  return createWakeWordMatcher({ now: () => now.value, windowMs })
}

describe('createWakeWordMatcher', () => {
  it('fires immediately when the wake phrase carries its own utterance', () => {
    const clock = { value: 0 }
    expect(makeMatcher(clock).feed('hey adam what is shipping today')).toBe(
      'what is shipping today'
    )
  })

  it('matches comma, punctuation, and case variants', () => {
    const clock = { value: 0 }
    expect(makeMatcher(clock).feed('Hey, Adam status')).toBe('status')

    // A punctuation-only remainder arms the matcher without firing.
    expect(makeMatcher(clock).feed('HEY ADAM!')).toBeNull()

    expect(makeMatcher(clock).feed('hello there')).toBeNull()
  })

  it('does not match mid-sentence mentions', () => {
    const clock = { value: 0 }
    expect(makeMatcher(clock).feed('tell hey adam about it later')).toBeNull()
  })

  it('requires a word boundary after adam', () => {
    const clock = { value: 0 }
    expect(makeMatcher(clock).feed('hey adamski hello')).toBeNull()
  })

  it('consumes the bare wake phrase as an arm, not an utterance', () => {
    const clock = { value: 0 }
    const matcher = makeMatcher(clock)
    expect(matcher.feed('hey adam')).toBeNull()

    clock.value = 1_000
    expect(matcher.feed('deploy the branch')).toBe('deploy the branch')
  })

  it('stays armed across an immediate-remainder fire for follow-ups', () => {
    const clock = { value: 0 }
    const matcher = makeMatcher(clock)
    expect(matcher.feed('hey adam status')).toBe('status')

    clock.value = 2_000
    expect(matcher.feed('and the logs')).toBe('and the logs')
  })

  it('expires the arm after the rolling window', () => {
    const clock = { value: 0 }
    const matcher = makeMatcher(clock)
    expect(matcher.feed('hey adam')).toBeNull()

    clock.value = WAKE_WORD_WINDOW_MS + 1
    expect(matcher.feed('deploy the branch')).toBeNull()
  })

  it('expires exactly at the window boundary edge', () => {
    const clock = { value: 0 }
    const matcher = makeMatcher(clock)
    expect(matcher.feed('hey adam')).toBeNull()

    clock.value = WAKE_WORD_WINDOW_MS - 1
    expect(matcher.feed('still fresh')).toBe('still fresh')
  })

  it('disarms after firing a follow-up so stray speech is not sent', () => {
    const clock = { value: 0 }
    const matcher = makeMatcher(clock)
    matcher.feed('hey adam')
    clock.value = 500
    matcher.feed('first command')
    clock.value = 600
    expect(matcher.feed('unrelated dictation continues')).toBeNull()
  })

  it('ignores empty finals while armed instead of consuming the arm', () => {
    const clock = { value: 0 }
    const matcher = makeMatcher(clock)
    expect(matcher.feed('hey adam')).toBeNull()
    expect(matcher.feed('   ')).toBeNull()
    clock.value = 1_000
    expect(matcher.feed('real utterance')).toBe('real utterance')
  })

  it('reset clears a pending arm', () => {
    const clock = { value: 0 }
    const matcher = makeMatcher(clock)
    matcher.feed('hey adam')
    matcher.reset()
    expect(matcher.feed('should not fire')).toBeNull()
  })
})
