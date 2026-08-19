import { describe, expect, it } from 'vitest'
import { DOBIUS_REACTION_KIND } from './canvas-relay-kinds'
import { aggregateNoteReactions, reactionQueryFilterForNotes, type ReactionSourceEvent } from './note-reaction-aggregate'

function makeReaction(overrides: Partial<ReactionSourceEvent> = {}): ReactionSourceEvent {
  return { id: 'r1', pubkey: 'user-1', tags: [['e', 'note-1']], content: '👍', ...overrides }
}

describe('note-reaction-aggregate', () => {
  it('builds a kind-7 filter tagged to the requested note ids', () => {
    expect(reactionQueryFilterForNotes(['note-1', 'note-2'])).toEqual({
      kinds: [DOBIUS_REACTION_KIND],
      '#e': ['note-1', 'note-2'],
      limit: 400
    })
  })

  it('never sends limit 0 for an empty note id list', () => {
    expect(reactionQueryFilterForNotes([]).limit).toBe(200)
  })

  it('groups reactions by note id and emoji, counting distinct pubkeys', () => {
    const events = [
      makeReaction({ id: 'r1', pubkey: 'user-1', content: '👍' }),
      makeReaction({ id: 'r2', pubkey: 'user-2', content: '👍' }),
      makeReaction({ id: 'r3', pubkey: 'user-1', content: '❤️' })
    ]
    const summary = aggregateNoteReactions(events, ['note-1'])
    expect(summary).toHaveLength(2)
    expect(summary).toContainEqual({ note_id: 'note-1', emoji: '👍', count: 2, pubkeys: ['user-1', 'user-2'] })
    expect(summary).toContainEqual({ note_id: 'note-1', emoji: '❤️', count: 1, pubkeys: ['user-1'] })
  })

  it('counts a resent reaction from the same pubkey once, not twice', () => {
    const events = [
      makeReaction({ id: 'r1', pubkey: 'user-1', content: '👍' }),
      makeReaction({ id: 'r2', pubkey: 'user-1', content: '👍' })
    ]
    expect(aggregateNoteReactions(events, ['note-1'])).toEqual([
      { note_id: 'note-1', emoji: '👍', count: 1, pubkeys: ['user-1'] }
    ])
  })

  it('ignores reactions targeting a note that was not asked about', () => {
    const events = [makeReaction({ tags: [['e', 'note-other']] })]
    expect(aggregateNoteReactions(events, ['note-1'])).toEqual([])
  })

  it('ignores a reaction event with no e-tag or empty content (failure path)', () => {
    const noTag = makeReaction({ tags: [] })
    const emptyEmoji = makeReaction({ content: '' })
    expect(aggregateNoteReactions([noTag, emptyEmoji], ['note-1'])).toEqual([])
  })

  it('returns an empty array, not an error, for an empty note id list', () => {
    expect(aggregateNoteReactions([makeReaction()], [])).toEqual([])
  })
})
