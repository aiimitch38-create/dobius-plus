import { describe, expect, it } from 'vitest'
import { DOBIUS_NOTE_KIND } from './canvas-relay-kinds'
import {
  assertPublishableNoteContent,
  noteEventTags,
  noteQueryFetchLimit,
  noteQueryFilterByIds,
  noteQueryFilterForAuthor,
  noteQueryFilterGlobal,
  paginateNotes,
  rawUserNoteFromEvent,
  type NoteSourceEvent
} from './social-note'

function makeNote(overrides: Partial<NoteSourceEvent> = {}): NoteSourceEvent {
  return { id: 'note-1', pubkey: 'author-1', created_at: 1700000000, tags: [], content: 'hello', ...overrides }
}

describe('social-note', () => {
  it('maps a relay event to RawUserNote verbatim', () => {
    expect(rawUserNoteFromEvent(makeNote())).toEqual({
      id: 'note-1',
      pubkey: 'author-1',
      created_at: 1700000000,
      content: 'hello',
      tags: []
    })
  })

  it('builds query filters scoped to the note kind, never the channel-message kinds', () => {
    expect(noteQueryFilterForAuthor('author-1', 10)).toEqual({ kinds: [DOBIUS_NOTE_KIND], authors: ['author-1'], limit: 10 })
    expect(noteQueryFilterGlobal(10)).toEqual({ kinds: [DOBIUS_NOTE_KIND], limit: 10 })
    expect(noteQueryFilterByIds(['a', 'b'])).toEqual({ kinds: [DOBIUS_NOTE_KIND], ids: ['a', 'b'], limit: 2 })
  })

  it('never sends an empty ids filter (the relay treats that as "match nothing")', () => {
    expect(noteQueryFilterByIds([]).limit).toBe(1)
  })

  it('overfetches beyond the requested page size to make cursor filtering possible', () => {
    expect(noteQueryFetchLimit(10)).toBeGreaterThan(10)
    expect(noteQueryFetchLimit(1000)).toBe(4000)
  })

  it('rejects publishing a note with neither text nor an attachment', () => {
    expect(() => assertPublishableNoteContent({ content: '' })).toThrow('A note needs text or an attachment.')
    expect(() => assertPublishableNoteContent({ content: '   ' })).toThrow('A note needs text or an attachment.')
  })

  it('accepts a media-only note with no text', () => {
    expect(() => assertPublishableNoteContent({ content: '', mediaTags: [['media', 'https://example.invalid/x.png']] })).not.toThrow()
  })

  it('accepts a text-only note', () => {
    expect(() => assertPublishableNoteContent({ content: 'hi' })).not.toThrow()
  })

  it('builds reply/mention/media tags and never an "h" tag', () => {
    const tags = noteEventTags({
      content: 'hi',
      replyTo: 'parent-1',
      mentionPubkeys: ['p1', 'p2'],
      mediaTags: [['media', 'https://example.invalid/x.png']]
    })
    expect(tags).toEqual([
      ['e', 'parent-1', '', 'reply'],
      ['p', 'p1'],
      ['p', 'p2'],
      ['media', 'https://example.invalid/x.png']
    ])
    expect(tags.some((tag) => tag[0] === 'h')).toBe(false)
  })

  it('drops blank mention pubkeys and malformed media tags', () => {
    const tags = noteEventTags({ content: 'hi', mentionPubkeys: ['', '  ', 'p1'], mediaTags: [[], ['ok']] })
    expect(tags).toEqual([['p', 'p1'], ['ok']])
  })

  describe('paginateNotes', () => {
    const events = [
      makeNote({ id: 'c', created_at: 100 }),
      makeNote({ id: 'a', created_at: 100 }),
      makeNote({ id: 'b', created_at: 90 })
    ]

    it('sorts newest-first with ascending-id tiebreak, mirroring the relay store', () => {
      const page = paginateNotes(events, 10)
      expect(page.notes.map((note) => note.id)).toEqual(['a', 'c', 'b'])
      expect(page.next_cursor).toBeNull()
    })

    it('returns a next_cursor only when more rows exist past the page', () => {
      const page = paginateNotes(events, 2)
      expect(page.notes.map((note) => note.id)).toEqual(['a', 'c'])
      expect(page.next_cursor).toEqual({ before: 100, before_id: 'c' })
    })

    it('honors a before/beforeId cursor from a previous page', () => {
      const page = paginateNotes(events, 10, { before: 100, beforeId: 'c' })
      expect(page.notes.map((note) => note.id)).toEqual(['b'])
      expect(page.next_cursor).toBeNull()
    })

    it('returns an empty page, not an error, once the cursor exhausts the batch', () => {
      const page = paginateNotes(events, 10, { before: 90 })
      expect(page.notes).toEqual([])
      expect(page.next_cursor).toBeNull()
    })
  })
})
