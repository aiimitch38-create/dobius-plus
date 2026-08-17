import { afterEach, describe, expect, it } from 'vitest'
import { RelayStore } from './relay-store'
import type { RelayEvent } from './relay-types'

const AUTHOR_A = 'a'.repeat(64)
const AUTHOR_B = 'b'.repeat(64)

function makeEvent(overrides: Partial<RelayEvent> & Pick<RelayEvent, 'id'>): RelayEvent {
  return {
    pubkey: AUTHOR_A,
    created_at: 1000,
    kind: 1,
    tags: [],
    content: 'hello',
    sig: 'f'.repeat(128),
    ...overrides
  }
}

describe('RelayStore', () => {
  const stores: RelayStore[] = []

  afterEach(() => {
    for (const open of stores.splice(0)) {
      open.close()
    }
  })

  function createStore(): RelayStore {
    const store = new RelayStore(':memory:')
    stores.push(store)
    return store
  }

  function ids(events: RelayEvent[]): string[] {
    return events.map((event) => event.id)
  }

  describe('insert', () => {
    it('persists an event and reads it back verbatim', () => {
      const s = createStore()
      const event = makeEvent({
        id: '01',
        tags: [
          ['p', AUTHOR_B],
          ['h', 'room-1']
        ],
        content: 'body text'
      })

      expect(s.insert(event)).toEqual({ accepted: true })

      const [stored] = s.query([{ ids: ['01'] }])
      expect(stored).toEqual(event)
    })

    it('treats a duplicate id as success without storing a second copy', () => {
      const s = createStore()
      const event = makeEvent({ id: '01' })

      expect(s.insert(event).accepted).toBe(true)
      const second = s.insert(event)

      expect(second.accepted).toBe(true)
      expect(second.message).toMatch(/duplicate/i)
      expect(s.query([{ ids: ['01'] }])).toHaveLength(1)
    })

    it('does not collapse ordinary kinds from the same author', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '01', kind: 1, created_at: 1000 }))
      s.insert(makeEvent({ id: '02', kind: 1, created_at: 2000 }))

      expect(ids(s.query([{ kinds: [1] }]))).toEqual(['02', '01'])
    })
  })

  describe('replaceable kinds', () => {
    it('keeps the newest when the older event arrives second', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '02', kind: 0, created_at: 2000, content: 'new' }))

      const older = s.insert(makeEvent({ id: '01', kind: 0, created_at: 1000, content: 'old' }))

      expect(older.accepted).toBe(true)
      expect(older.message).toMatch(/superseded/i)
      const stored = s.query([{ kinds: [0] }])
      expect(ids(stored)).toEqual(['02'])
      expect(stored[0].content).toBe('new')
    })

    it('keeps the newest when the older event arrives first', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '01', kind: 0, created_at: 1000, content: 'old' }))

      expect(s.insert(makeEvent({ id: '02', kind: 0, created_at: 2000, content: 'new' }))).toEqual({
        accepted: true
      })

      const stored = s.query([{ kinds: [0] }])
      expect(ids(stored)).toEqual(['02'])
      expect(stored[0].content).toBe('new')
    })

    it('replaces per author, not globally', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '01', pubkey: AUTHOR_A, kind: 0, created_at: 1000 }))
      s.insert(makeEvent({ id: '02', pubkey: AUTHOR_B, kind: 0, created_at: 2000 }))

      expect(ids(s.query([{ kinds: [0] }])).sort()).toEqual(['01', '02'])
    })

    it('breaks an equal created_at tie in favour of the lower id, either order', () => {
      const s = createStore()
      s.insert(makeEvent({ id: 'bb', kind: 10002, created_at: 5000 }))
      s.insert(makeEvent({ id: 'aa', kind: 10002, created_at: 5000 }))
      expect(ids(s.query([{ kinds: [10002] }]))).toEqual(['aa'])

      const reverse = createStore()
      reverse.insert(makeEvent({ id: 'aa', kind: 10002, created_at: 5000 }))
      const loser = reverse.insert(makeEvent({ id: 'bb', kind: 10002, created_at: 5000 }))
      expect(loser.message).toMatch(/superseded/i)
      expect(ids(reverse.query([{ kinds: [10002] }]))).toEqual(['aa'])
    })
  })

  describe('addressable kinds', () => {
    it('replaces only within the same d tag', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '01', kind: 39000, created_at: 1000, tags: [['d', 'chan-1']] }))
      s.insert(makeEvent({ id: '02', kind: 39000, created_at: 1000, tags: [['d', 'chan-2']] }))

      s.insert(
        makeEvent({
          id: '03',
          kind: 39000,
          created_at: 2000,
          tags: [['d', 'chan-1']],
          content: 'renamed'
        })
      )

      const stored = s.query([{ kinds: [39000] }])
      expect(ids(stored).sort()).toEqual(['02', '03'])
      expect(stored.find((event) => event.id === '03')?.content).toBe('renamed')
    })

    it('rejects an older revision of the same d tag', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '02', kind: 30622, created_at: 2000, tags: [['d', 'x']] }))

      const older = s.insert(
        makeEvent({ id: '01', kind: 30622, created_at: 1000, tags: [['d', 'x']] })
      )

      expect(older).toEqual({
        accepted: true,
        message: expect.stringMatching(/superseded/i)
      })
      expect(ids(s.query([{ kinds: [30622] }]))).toEqual(['02'])
    })

    it('treats a missing d tag as the empty d tag', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '01', kind: 39002, created_at: 1000, tags: [] }))
      s.insert(makeEvent({ id: '02', kind: 39002, created_at: 2000, tags: [] }))

      expect(ids(s.query([{ kinds: [39002] }]))).toEqual(['02'])
    })

    it('drops the replaced event tag rows so stale tag filters stop matching', () => {
      const s = createStore()
      s.insert(
        makeEvent({
          id: '01',
          kind: 39000,
          created_at: 1000,
          tags: [
            ['d', 'chan-1'],
            ['p', AUTHOR_B]
          ]
        })
      )
      s.insert(makeEvent({ id: '02', kind: 39000, created_at: 2000, tags: [['d', 'chan-1']] }))

      expect(s.query([{ '#p': [AUTHOR_B] }])).toEqual([])
    })
  })

  describe('filters', () => {
    function seed(s: RelayStore): void {
      s.insert(makeEvent({ id: '01', kind: 1, created_at: 1000, pubkey: AUTHOR_A }))
      s.insert(
        makeEvent({
          id: '02',
          kind: 9,
          created_at: 2000,
          pubkey: AUTHOR_B,
          tags: [
            ['p', AUTHOR_A],
            ['h', 'room-1']
          ]
        })
      )
      s.insert(
        makeEvent({
          id: '03',
          kind: 7,
          created_at: 3000,
          pubkey: AUTHOR_A,
          tags: [
            ['e', '02'],
            ['h', 'room-2']
          ]
        })
      )
    }

    it('filters by ids', () => {
      const s = createStore()
      seed(s)
      expect(ids(s.query([{ ids: ['01', '03'] }]))).toEqual(['03', '01'])
    })

    it('filters by authors', () => {
      const s = createStore()
      seed(s)
      expect(ids(s.query([{ authors: [AUTHOR_B] }]))).toEqual(['02'])
    })

    it('filters by kinds', () => {
      const s = createStore()
      seed(s)
      expect(ids(s.query([{ kinds: [1, 7] }]))).toEqual(['03', '01'])
    })

    it('filters by since, inclusive of the boundary', () => {
      const s = createStore()
      seed(s)
      expect(ids(s.query([{ since: 2000 }]))).toEqual(['03', '02'])
    })

    it('filters by #p, #h and #e tags', () => {
      const s = createStore()
      seed(s)
      expect(ids(s.query([{ '#p': [AUTHOR_A] }]))).toEqual(['02'])
      expect(ids(s.query([{ '#h': ['room-1', 'room-2'] }]))).toEqual(['03', '02'])
      expect(ids(s.query([{ '#e': ['02'] }]))).toEqual(['03'])
    })

    it('filters by #d tags', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '01', kind: 39000, created_at: 1000, tags: [['d', 'chan-1']] }))
      s.insert(makeEvent({ id: '02', kind: 39000, created_at: 2000, tags: [['d', 'chan-2']] }))

      expect(ids(s.query([{ '#d': ['chan-2'] }]))).toEqual(['02'])
    })

    it('ANDs every key within a single filter', () => {
      const s = createStore()
      seed(s)
      expect(s.query([{ authors: [AUTHOR_A], kinds: [9] }])).toEqual([])
      expect(ids(s.query([{ authors: [AUTHOR_A], kinds: [7], since: 3000 }]))).toEqual(['03'])
    })

    it('matches nothing for an empty array or a zero limit', () => {
      const s = createStore()
      seed(s)
      expect(s.query([{ ids: [] }])).toEqual([])
      expect(s.query([{ authors: [] }])).toEqual([])
      expect(s.query([{ kinds: [] }])).toEqual([])
      expect(s.query([{ '#p': [] }])).toEqual([])
      expect(s.query([{ limit: 0 }])).toEqual([])
    })

    it('returns everything for an empty filter object and nothing for no filters', () => {
      const s = createStore()
      seed(s)
      expect(ids(s.query([{}]))).toEqual(['03', '02', '01'])
      expect(s.query([])).toEqual([])
    })
  })

  describe('limit, merge and ordering', () => {
    it('applies limit per filter and dedupes the merged result', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '01', kind: 1, created_at: 1000, pubkey: AUTHOR_A }))
      s.insert(makeEvent({ id: '02', kind: 1, created_at: 2000, pubkey: AUTHOR_A }))
      s.insert(makeEvent({ id: '03', kind: 9, created_at: 3000, pubkey: AUTHOR_B }))
      s.insert(makeEvent({ id: '04', kind: 9, created_at: 4000, pubkey: AUTHOR_B }))

      // Each filter contributes its own newest slice; '04' is in both.
      const merged = s.query([{ kinds: [1, 9], limit: 1 }, { authors: [AUTHOR_B] }])

      expect(ids(merged)).toEqual(['04', '03'])
    })

    it('takes the newest events when limit truncates', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '01', created_at: 1000 }))
      s.insert(makeEvent({ id: '02', created_at: 2000 }))
      s.insert(makeEvent({ id: '03', created_at: 3000 }))

      expect(ids(s.query([{ limit: 2 }]))).toEqual(['03', '02'])
    })

    it('orders equal created_at by ascending id, newest group first', () => {
      const s = createStore()
      s.insert(makeEvent({ id: 'cc', created_at: 1000 }))
      s.insert(makeEvent({ id: 'aa', created_at: 2000 }))
      s.insert(makeEvent({ id: 'bb', created_at: 2000 }))

      expect(ids(s.query([{}]))).toEqual(['aa', 'bb', 'cc'])
      // The tiebreak must survive the cross-filter merge too.
      expect(ids(s.query([{ ids: ['bb'] }, { ids: ['aa', 'cc'] }]))).toEqual(['aa', 'bb', 'cc'])
    })

    it('clamps an oversized limit instead of failing', () => {
      const s = createStore()
      s.insert(makeEvent({ id: '01', created_at: 1000 }))

      expect(ids(s.query([{ limit: 10_000_000 }]))).toEqual(['01'])
    })
  })
})
