import { describe, expect, it } from 'vitest'
import { DOBIUS_CANVAS_KIND } from './canvas-relay-kinds'
import {
  assertValidCanvasContent,
  assertValidChannelId,
  canvasEventTags,
  canvasQueryFilter,
  canvasResponseFromEvent,
  type CanvasSourceEvent
} from './canvas-document'

function makeEvent(overrides: Partial<CanvasSourceEvent> = {}): CanvasSourceEvent {
  return {
    id: 'event-1',
    pubkey: 'pubkey-1',
    created_at: 1700000000,
    tags: [['d', 'channel-1']],
    content: '# Notes',
    ...overrides
  }
}

describe('canvas-document', () => {
  it('builds the get_canvas relay filter keyed by channel d-tag', () => {
    expect(canvasQueryFilter('channel-1')).toEqual({
      kinds: [DOBIUS_CANVAS_KIND],
      '#d': ['channel-1'],
      limit: 1
    })
  })

  it('trims the channel id before using it as a filter/tag value', () => {
    expect(canvasQueryFilter('  channel-1  ')['#d']).toEqual(['channel-1'])
    expect(canvasEventTags('  channel-1  ')).toEqual([['d', 'channel-1']])
  })

  it('rejects a missing or blank channel id (happy/failure path)', () => {
    expect(() => assertValidChannelId('channel-1')).not.toThrow()
    expect(() => assertValidChannelId('')).toThrow('Missing channel id')
    expect(() => assertValidChannelId('   ')).toThrow('Missing channel id')
    expect(() => assertValidChannelId(undefined)).toThrow('Missing channel id')
  })

  it('accepts an empty string canvas content but rejects a missing one', () => {
    expect(assertValidCanvasContent('')).toBe('')
    expect(() => assertValidCanvasContent(undefined)).toThrow('Missing canvas content')
    expect(() => assertValidCanvasContent(null)).toThrow('Missing canvas content')
  })

  it('builds the addressable event tags set_canvas signs', () => {
    expect(canvasEventTags('channel-1')).toEqual([['d', 'channel-1']])
  })

  it('maps a found canvas event to content/updated_at/author', () => {
    expect(canvasResponseFromEvent(makeEvent())).toEqual({
      content: '# Notes',
      updated_at: 1700000000,
      author: 'pubkey-1'
    })
  })

  it('maps a missing canvas to the honest null triple, not fabricated values', () => {
    expect(canvasResponseFromEvent(undefined)).toEqual({
      content: null,
      updated_at: null,
      author: null
    })
  })

  it('treats an empty-string canvas as a real value, not "no canvas yet"', () => {
    expect(canvasResponseFromEvent(makeEvent({ content: '' }))).toEqual({
      content: '',
      updated_at: 1700000000,
      author: 'pubkey-1'
    })
  })
})
