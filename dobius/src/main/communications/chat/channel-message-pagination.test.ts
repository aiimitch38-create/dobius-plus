import { describe, expect, it } from 'vitest'

import { type ChatEvent, selectMessagesBeforeCursor } from './channel-message-pagination'

function makeEvent(id: string, createdAt: number): ChatEvent {
  return { id, pubkey: 'author-1', created_at: createdAt, kind: 9, tags: [], content: id }
}

// Newest-first, matching what our relay's /query returns (relay-store.ts compareNewestFirst).
const NEWEST_FIRST = [makeEvent('e5', 500), makeEvent('e4', 400), makeEvent('e3', 300), makeEvent('e2', 200), makeEvent('e1', 100)]

describe('selectMessagesBeforeCursor', () => {
  it('returns the newest page ascending when no cursor is given', () => {
    const page = selectMessagesBeforeCursor(NEWEST_FIRST, null, 2)
    expect(page.events.map((event) => event.id)).toEqual(['e4', 'e5'])
  })

  it('sets nextCursor to the oldest event in the page when the page is full', () => {
    const page = selectMessagesBeforeCursor(NEWEST_FIRST, null, 2)
    expect(page.nextCursor).toEqual({ createdAt: 400, eventId: 'e4' })
  })

  it('returns null nextCursor once the page comes back short of the limit (happy path: exhausted)', () => {
    const page = selectMessagesBeforeCursor(NEWEST_FIRST, { createdAt: 200, eventId: 'e2' }, 10)
    expect(page.events.map((event) => event.id)).toEqual(['e1'])
    expect(page.nextCursor).toBeNull()
  })

  it('breaks a created_at tie by id, keeping only the lexically-greater sibling (failure path: tie-break)', () => {
    const tied = [makeEvent('e5', 500), makeEvent('ez', 200), makeEvent('ea', 200), makeEvent('e1', 100)]
    // Cursor sits at (200, "em"). Per the documented contract, "older" means
    // created_at < before OR (created_at === before AND id > beforeId).
    const page = selectMessagesBeforeCursor(tied, { createdAt: 200, eventId: 'em' }, 10)
    expect(page.events.map((event) => event.id)).toEqual(['e1', 'ez'])
  })

  it('returns an empty page with a null cursor when nothing is older than the cursor (failure path: no data)', () => {
    const page = selectMessagesBeforeCursor(NEWEST_FIRST, { createdAt: 100, eventId: 'e1' }, 10)
    expect(page.events).toEqual([])
    expect(page.nextCursor).toBeNull()
  })
})
