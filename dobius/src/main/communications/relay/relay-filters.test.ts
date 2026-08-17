import { describe, expect, it } from 'vitest'

import {
  eventMatchesAnyFilter,
  eventMatchesFilter,
  parseRelayFilters,
  resolveQueryLimit,
  selectMatchingEvents
} from './relay-filters'
import {
  RELAY_DEFAULT_QUERY_LIMIT,
  RELAY_MAX_QUERY_LIMIT,
  type RelayEvent,
  type RelayFilter
} from './relay-types'

function makeEvent(overrides: Partial<RelayEvent> = {}): RelayEvent {
  return {
    id: 'a1',
    pubkey: 'author-1',
    created_at: 1000,
    kind: 1,
    tags: [],
    content: 'hello',
    sig: 'sig-1',
    ...overrides
  }
}

describe('parseRelayFilters', () => {
  it('accepts the filter shapes the shipped Buzz client sends', () => {
    const body = [
      { kinds: [0], authors: ['pk'], limit: 1 },
      { kinds: [39000], '#d': ['channel-1'], limit: 1 },
      { ids: ['event-1'], limit: 1 },
      { kinds: [39002], '#p': ['pk'], limit: 1000 },
      { kinds: [1, 9, 40002, 45001, 45003], '#h': ['channel-1'], limit: 50 },
      { kinds: [1, 9, 40002, 45003], '#e': ['root-1'], limit: 100 },
      { kinds: [7], '#e': ['event-1'], authors: ['pk'], limit: 100 }
    ]
    expect(parseRelayFilters(body)).toEqual(body)
  })

  it('accepts an empty array of filters', () => {
    expect(parseRelayFilters([])).toEqual([])
  })

  it('accepts an empty filter object as an unconstrained filter', () => {
    expect(parseRelayFilters([{}])).toEqual([{}])
  })

  it.each([
    ['until', { kinds: [1], until: 1700 }],
    ['search', { kinds: [0], search: 'carson', limit: 8 }],
    ['page', { kinds: [0], limit: 8, page: 2 }],
    ['a future NIP key', { kinds: [1], '#t': ['topic'] }]
  ])('ignores the unknown key %s instead of rejecting the filter', (_label, body) => {
    const parsed = parseRelayFilters([body])
    expect(parsed).not.toBeNull()
    expect(parsed?.[0]).not.toHaveProperty(_label === 'a future NIP key' ? '#t' : _label)
  })

  it('keeps the known keys when dropping unknown ones', () => {
    expect(parseRelayFilters([{ kinds: [0], limit: 8, page: 2, search: 'x' }])).toEqual([
      { kinds: [0], limit: 8 }
    ])
  })

  it.each([
    ['a non-array body', { kinds: [1] }],
    ['a null body', null],
    ['a string body', '[]'],
    ['a null filter element', [null]],
    ['an array filter element', [[]]],
    ['a string filter element', ['{}']],
    ['non-string ids', [{ ids: [1] }]],
    ['non-array ids', [{ ids: 'event-1' }]],
    ['non-string authors', [{ authors: [{}] }]],
    ['non-integer kinds', [{ kinds: [1.5] }]],
    ['string kinds', [{ kinds: ['1'] }]],
    ['a string since', [{ since: '1000' }]],
    ['a NaN limit', [{ limit: Number.NaN }]],
    ['an infinite since', [{ since: Number.POSITIVE_INFINITY }]],
    ['a non-array tag filter', [{ '#p': 'pk' }]],
    ['a non-string tag value', [{ '#e': [7] }]],
    ['one bad filter among good ones', [{ kinds: [1] }, { authors: [3] }]]
  ])('returns null for %s', (_label, body) => {
    expect(parseRelayFilters(body)).toBeNull()
  })

  it('never throws on hostile input', () => {
    expect(() => parseRelayFilters(Symbol('nope'))).not.toThrow()
    expect(parseRelayFilters(Symbol('nope'))).toBeNull()
  })
})

describe('eventMatchesFilter — each key in isolation', () => {
  const event = makeEvent({
    id: 'id-1',
    pubkey: 'pk-1',
    kind: 9,
    created_at: 1000,
    tags: [
      ['h', 'channel-1'],
      ['p', 'pk-2'],
      ['e', 'root-1']
    ]
  })

  it.each<[string, RelayFilter, boolean]>([
    ['an empty filter matches everything', {}, true],
    ['ids hit', { ids: ['id-1'] }, true],
    ['ids hit among several', { ids: ['other', 'id-1'] }, true],
    ['ids miss', { ids: ['id-2'] }, false],
    ['authors hit', { authors: ['pk-1'] }, true],
    ['authors miss', { authors: ['pk-2'] }, false],
    ['kinds hit', { kinds: [1, 9] }, true],
    ['kinds miss', { kinds: [1, 7] }, false],
    ['since equal to created_at is inclusive', { since: 1000 }, true],
    ['since below created_at', { since: 999 }, true],
    ['since above created_at', { since: 1001 }, false],
    ['tag hit', { '#h': ['channel-1'] }, true],
    ['tag hit among several values', { '#p': ['pk-9', 'pk-2'] }, true],
    ['tag miss on value', { '#h': ['channel-2'] }, false],
    ['tag miss on absent tag name', { '#d': ['channel-1'] }, false],
    ['limit alone is not a match constraint', { limit: 1 }, true]
  ])('%s', (_label, filter, expected) => {
    expect(eventMatchesFilter(event, filter)).toBe(expected)
  })

  it('does not confuse the #-prefixed filter key with the raw tag name', () => {
    const prefixed = makeEvent({ tags: [['#h', 'channel-1']] })
    expect(eventMatchesFilter(prefixed, { '#h': ['channel-1'] })).toBe(false)
    expect(eventMatchesFilter(event, { '#h': ['channel-1'] })).toBe(true)
  })

  it('ignores a tag whose value slot is missing', () => {
    const truncated = makeEvent({ tags: [['h']] })
    expect(eventMatchesFilter(truncated, { '#h': ['channel-1'] })).toBe(false)
  })

  it('matches a value in any of several same-named tags', () => {
    const multi = makeEvent({
      tags: [
        ['p', 'pk-a'],
        ['p', 'pk-b']
      ]
    })
    expect(eventMatchesFilter(multi, { '#p': ['pk-b'] })).toBe(true)
  })
})

describe('eventMatchesFilter — empty arrays match nothing', () => {
  const event = makeEvent({ id: 'id-1', pubkey: 'pk-1', kind: 9, tags: [['p', 'pk-2']] })

  it.each<[string, RelayFilter]>([
    ['ids', { ids: [] }],
    ['authors', { authors: [] }],
    ['kinds', { kinds: [] }],
    ['#p', { '#p': [] }]
  ])('an explicitly empty %s matches nothing', (_label, filter) => {
    expect(eventMatchesFilter(event, filter)).toBe(false)
  })

  it('distinguishes an absent condition from an empty one', () => {
    expect(eventMatchesFilter(event, {})).toBe(true)
    expect(eventMatchesFilter(event, { authors: [] })).toBe(false)
  })
})

describe('eventMatchesFilter — conditions are ANDed', () => {
  const event = makeEvent({
    id: 'id-1',
    pubkey: 'pk-1',
    kind: 9,
    created_at: 1000,
    tags: [['h', 'channel-1']]
  })

  it('requires every present condition to hold', () => {
    expect(eventMatchesFilter(event, { kinds: [9], '#h': ['channel-1'], since: 500 })).toBe(true)
    expect(eventMatchesFilter(event, { kinds: [9], '#h': ['channel-2'], since: 500 })).toBe(false)
    expect(eventMatchesFilter(event, { kinds: [7], '#h': ['channel-1'], since: 500 })).toBe(false)
    expect(eventMatchesFilter(event, { kinds: [9], '#h': ['channel-1'], since: 1001 })).toBe(false)
    expect(eventMatchesFilter(event, { authors: ['pk-1'], ids: ['id-2'] })).toBe(false)
  })

  it('ANDs two different tag filters', () => {
    const tagged = makeEvent({
      tags: [
        ['h', 'channel-1'],
        ['e', 'root-1']
      ]
    })
    expect(eventMatchesFilter(tagged, { '#h': ['channel-1'], '#e': ['root-1'] })).toBe(true)
    expect(eventMatchesFilter(tagged, { '#h': ['channel-1'], '#e': ['root-2'] })).toBe(false)
  })
})

describe('eventMatchesAnyFilter', () => {
  const event = makeEvent({ id: 'id-1', pubkey: 'pk-1', kind: 9 })

  it('is true when any filter matches', () => {
    expect(eventMatchesAnyFilter(event, [{ kinds: [7] }, { kinds: [9] }])).toBe(true)
  })

  it('is false when no filter matches', () => {
    expect(eventMatchesAnyFilter(event, [{ kinds: [7] }, { authors: ['pk-2'] }])).toBe(false)
  })

  it('is false for an empty filter list', () => {
    expect(eventMatchesAnyFilter(event, [])).toBe(false)
  })

  it('ignores limit, which is a query concern and not a subscription one', () => {
    expect(eventMatchesAnyFilter(event, [{ kinds: [9], limit: 0 }])).toBe(true)
  })
})

describe('resolveQueryLimit', () => {
  it.each<[string, RelayFilter, number]>([
    ['absent limit', {}, RELAY_DEFAULT_QUERY_LIMIT],
    ['zero', { limit: 0 }, RELAY_DEFAULT_QUERY_LIMIT],
    ['negative', { limit: -5 }, RELAY_DEFAULT_QUERY_LIMIT],
    ['fractional', { limit: 2.5 }, RELAY_DEFAULT_QUERY_LIMIT],
    ['NaN', { limit: Number.NaN }, RELAY_DEFAULT_QUERY_LIMIT],
    ['one', { limit: 1 }, 1],
    ['an ordinary limit', { limit: 20 }, 20],
    ['exactly the ceiling', { limit: RELAY_MAX_QUERY_LIMIT }, RELAY_MAX_QUERY_LIMIT],
    ['above the ceiling', { limit: RELAY_MAX_QUERY_LIMIT + 1 }, RELAY_MAX_QUERY_LIMIT],
    ['absurdly large', { limit: 10_000_000 }, RELAY_MAX_QUERY_LIMIT]
  ])('resolves %s', (_label, filter, expected) => {
    expect(resolveQueryLimit(filter)).toBe(expected)
  })
})

describe('selectMatchingEvents', () => {
  const older = makeEvent({ id: 'b', created_at: 100, kind: 1 })
  const middle = makeEvent({ id: 'c', created_at: 200, kind: 1 })
  const newer = makeEvent({ id: 'd', created_at: 300, kind: 1 })
  const feed = [older, newer, middle]

  it('returns nothing for an empty filter list', () => {
    expect(selectMatchingEvents(feed, [])).toEqual([])
  })

  it('sorts newest first', () => {
    expect(selectMatchingEvents(feed, [{ kinds: [1] }]).map((event) => event.id)).toEqual([
      'd',
      'c',
      'b'
    ])
  })

  it('breaks created_at ties by ascending id', () => {
    const tied = [
      makeEvent({ id: 'z', created_at: 500 }),
      makeEvent({ id: 'a', created_at: 500 }),
      makeEvent({ id: 'm', created_at: 500 }),
      makeEvent({ id: 'q', created_at: 900 })
    ]
    expect(selectMatchingEvents(tied, [{}]).map((event) => event.id)).toEqual(['q', 'a', 'm', 'z'])
  })

  it('produces the same order regardless of input order', () => {
    const tied = [
      makeEvent({ id: 'a', created_at: 500 }),
      makeEvent({ id: 'z', created_at: 500 }),
      makeEvent({ id: 'm', created_at: 500 })
    ]
    const forward = selectMatchingEvents(tied, [{}]).map((event) => event.id)
    const reversed = selectMatchingEvents(tied.toReversed(), [{}]).map((event) => event.id)
    expect(forward).toEqual(['a', 'm', 'z'])
    expect(reversed).toEqual(forward)
  })

  it('takes the newest events when a limit truncates', () => {
    expect(selectMatchingEvents(feed, [{ kinds: [1], limit: 2 }]).map((event) => event.id)).toEqual([
      'd',
      'c'
    ])
  })

  it('applies limit per filter rather than to the merged result', () => {
    const notes = [
      makeEvent({ id: 'n1', kind: 1, created_at: 10 }),
      makeEvent({ id: 'n2', kind: 1, created_at: 20 })
    ]
    const reactions = [
      makeEvent({ id: 'r1', kind: 7, created_at: 30 }),
      makeEvent({ id: 'r2', kind: 7, created_at: 40 })
    ]
    const selected = selectMatchingEvents(
      [...notes, ...reactions],
      [
        { kinds: [1], limit: 1 },
        { kinds: [7], limit: 1 }
      ]
    )
    // Each filter contributes its own newest event; a merged cap of 1 would
    // have dropped the note entirely.
    expect(selected.map((event) => event.id)).toEqual(['r2', 'n2'])
  })

  it('deduplicates an event matched by more than one filter', () => {
    const overlapping = [
      makeEvent({ id: 'x', kind: 1, pubkey: 'pk-1', created_at: 10 }),
      makeEvent({ id: 'y', kind: 1, pubkey: 'pk-2', created_at: 20 })
    ]
    const selected = selectMatchingEvents(overlapping, [{ kinds: [1] }, { authors: ['pk-1'] }])
    expect(selected.map((event) => event.id)).toEqual(['y', 'x'])
  })

  it('deduplicates repeated ids in the input before applying the limit', () => {
    const duplicated = [
      makeEvent({ id: 'x', created_at: 10 }),
      makeEvent({ id: 'x', created_at: 10 }),
      makeEvent({ id: 'y', created_at: 5 })
    ]
    expect(selectMatchingEvents(duplicated, [{ limit: 2 }]).map((event) => event.id)).toEqual([
      'x',
      'y'
    ])
  })

  it('falls back to the default limit when a filter omits one', () => {
    const many = Array.from({ length: RELAY_DEFAULT_QUERY_LIMIT + 10 }, (_value, index) =>
      makeEvent({ id: `id-${String(index).padStart(4, '0')}`, created_at: index })
    )
    expect(selectMatchingEvents(many, [{}])).toHaveLength(RELAY_DEFAULT_QUERY_LIMIT)
  })

  it('returns nothing when a filter has an empty condition array', () => {
    expect(selectMatchingEvents(feed, [{ authors: [] }])).toEqual([])
  })

  it('does not mutate the caller’s event array', () => {
    const input = [...feed]
    selectMatchingEvents(input, [{ kinds: [1] }])
    expect(input).toEqual(feed)
  })
})
