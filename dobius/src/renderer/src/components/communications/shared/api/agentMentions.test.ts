import { describe, expect, it } from 'vitest'

import { contentMentionsAgent } from './dobiusCommunications'

const agent = (name: string) => ({ id: name, name }) as never

describe('contentMentionsAgent', () => {
  it('matches a bare name, because Carson types "adam" not "@Adam"', () => {
    expect(contentMentionsAgent('adam', agent('Adam'))).toBe(true)
    expect(contentMentionsAgent('hey Adam can you look', agent('Adam'))).toBe(true)
  })

  it('does not match a name embedded in a longer word', () => {
    expect(contentMentionsAgent('adamant about this', agent('Adam'))).toBe(false)
    expect(contentMentionsAgent('fridays are busy', agent('Friday'))).toBe(false)
  })

  it('still matches explicit @mentions', () => {
    expect(contentMentionsAgent('@Friday take this', agent('Friday'))).toBe(true)
    expect(contentMentionsAgent('@voiceconductor', agent('Voice Conductor'))).toBe(true)
  })

  it('matches nobody when no agent is named, so the room still broadcasts', () => {
    expect(contentMentionsAgent('hey team what do we think', agent('Adam'))).toBe(false)
    expect(contentMentionsAgent('hey team what do we think', agent('Friday'))).toBe(false)
  })

  it('ignores short names entirely so they cannot collide with ordinary words', () => {
    expect(contentMentionsAgent('the cat sat', agent('Cat'))).toBe(false)
    expect(contentMentionsAgent('@cat', agent('Cat'))).toBe(true)
  })
})
