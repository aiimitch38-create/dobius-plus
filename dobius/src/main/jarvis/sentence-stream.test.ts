import { describe, expect, it } from 'vitest'
import { createSentenceSplitter, lastSentenceEnd } from './sentence-stream'

describe('lastSentenceEnd', () => {
  it('finds the boundary after the last terminated sentence', () => {
    expect(lastSentenceEnd('One. Two! Three? tail')).toBe(16)
  })

  it('returns -1 when nothing is terminated', () => {
    expect(lastSentenceEnd('still going')).toBe(-1)
  })

  it('does not treat a trailing period with no whitespace as a boundary', () => {
    // Mid-stream "3." could be "3.14" — only whitespace confirms the end.
    expect(lastSentenceEnd('pi is 3.')).toBe(-1)
  })

  it('treats newlines as boundaries, including a trailing one', () => {
    expect(lastSentenceEnd('line one\nline two\n')).toBe(18)
    expect(lastSentenceEnd('line one\ntail')).toBe(9)
  })
})

describe('createSentenceSplitter', () => {
  it('emits nothing until a sentence completes, then emits it', () => {
    const splitter = createSentenceSplitter()
    expect(splitter.push('The build is ')).toEqual([])
    expect(splitter.push('green. Next up')).toEqual(['The build is green.'])
    expect(splitter.flush()).toBe('Next up')
  })

  it('splits several sentences arriving in one delta', () => {
    const splitter = createSentenceSplitter()
    expect(splitter.push('One done. Two done! Three? And a tail')).toEqual([
      'One done.',
      'Two done!',
      'Three?'
    ])
    expect(splitter.flush()).toBe('And a tail')
  })

  it('never splits inside a decimal that sits mid-buffer', () => {
    const splitter = createSentenceSplitter()
    // The '.' in 3.14 is followed by a digit, not whitespace — no boundary,
    // even though later text makes it a non-final character.
    expect(splitter.push('pi is 3.14 which is neat')).toEqual([])
    expect(splitter.push('. Next thought')).toEqual(['pi is 3.14 which is neat.'])
    expect(splitter.flush()).toBe('Next thought')
  })

  it('holds a number-like period until whitespace confirms it', () => {
    const splitter = createSentenceSplitter()
    expect(splitter.push('Version 1.')).toEqual([])
    expect(splitter.push('2 shipped. Done.')).toEqual(['Version 1.2 shipped.'])
    expect(splitter.flush()).toBe('Done.')
  })

  it('flush returns null when nothing is buffered', () => {
    const splitter = createSentenceSplitter()
    splitter.push('Complete. ')
    expect(splitter.flush()).toBeNull()
  })

  it('newline-separated lines come out as separate sentences', () => {
    const splitter = createSentenceSplitter()
    expect(splitter.push('First line\nSecond line\n')).toEqual(['First line', 'Second line'])
  })
})
