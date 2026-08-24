import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext, RpcMethod } from '../../runtime/rpc/core'
import type { RelayEvent } from '../relay/relay-types'
import { DOBIUS_CANVAS_KIND, DOBIUS_NOTE_KIND, DOBIUS_REACTION_KIND } from './canvas-relay-kinds'

// The handlers run against the REAL storage stack end to end: the participant
// identity store (temp home via mocked os.homedir + Electron safeStorage mock),
// the real in-memory RelayStore, and the pure shaping stores they delegate to.
// Global fetch is stubbed with an in-process adapter speaking the relay's
// actual /query + /events contract, so nothing leaves the process.
const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  isEncryptionAvailable: vi.fn(() => true)
}))

const TEST_PRIVATE_KEY = '11'.repeat(32)
const AUTHOR_OTHER = 'b'.repeat(64)

let tempHome = ''
let openStore: { close(): void } | null = null

async function loadMethods() {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })

  const { RelayStore } = await import('../relay/relay-store')
  const { verifyRelayEvent } = await import('../relay/relay-event')
  const identity = await import('../participant-identity-store')
  const selfIdentity = identity.importParticipantPrivateKey(TEST_PRIVATE_KEY)

  const store = new RelayStore(':memory:')
  openStore = store

  // Speaks the same contract relay-http-client.ts consumes: POST /query runs
  // the filters against the store, POST /events verifies then inserts — the
  // identical acceptance path relay-server.ts uses, minus the socket.
  vi.stubGlobal(
    'fetch',
    async (url: unknown, init?: { body?: unknown }) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '')
      if (path === '/query') {
        return okJsonResponse(store.query(JSON.parse(String(init?.body))))
      }
      if (path === '/events') {
        const event = JSON.parse(String(init?.body)) as RelayEvent
        const verification = verifyRelayEvent(event)
        if (!verification.ok) {
          return textResponse(400, verification.reason)
        }
        const result = store.insert(event)
        return okJsonResponse({
          accepted: result.accepted,
          event_id: event.id,
          message: result.message ?? ''
        })
      }
      return textResponse(404, `not found: ${path}`)
    }
  )

  const { CANVAS_NOTES_METHODS } = await import('./canvas-rpc-methods')
  return { methods: CANVAS_NOTES_METHODS, store, selfPubkey: selfIdentity.pubkey }
}

function okJsonResponse(value: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => value,
    text: async () => JSON.stringify(value)
  }
}

function textResponse(status: number, body: string) {
  return { ok: false, status, json: async () => ({}), text: async () => body }
}

const rpcContext = {} as RpcContext

function methodNamed(methods: readonly RpcMethod[], name: string): RpcMethod {
  const found = methods.find((method) => method.name === name)
  if (!found) {
    throw new Error(`test bug: method ${name} not registered`)
  }
  return found
}

/** Mirrors the dispatcher: validate with the method's own schema, then invoke. */
async function callMethod(method: RpcMethod, params: unknown): Promise<unknown> {
  const parsed = method.params === null ? undefined : method.params.parse(params)
  return method.handler(parsed, rpcContext)
}

let seedCounter = 0

function seedEvent(overrides: Partial<RelayEvent>): RelayEvent & { id: string } {
  seedCounter += 1
  return {
    id: `seeded-${seedCounter}`,
    pubkey: AUTHOR_OTHER,
    created_at: 1000,
    kind: DOBIUS_NOTE_KIND,
    tags: [],
    content: '',
    sig: 'f'.repeat(128),
    ...overrides
  }
}

describe('canvas-rpc-methods', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'dobius-canvas-rpc-'))
    seedCounter = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    openStore?.close()
    openStore = null
  })

  describe('registration', () => {
    it('registers exactly the 9 canvas-notes commands, uniquely named under canvas.', async () => {
      const { methods } = await loadMethods()
      expect(methods).toHaveLength(9)
      const names = methods.map((method) => method.name)
      expect(new Set(names).size).toBe(9)
      for (const name of names) {
        expect(name.startsWith('canvas.')).toBe(true)
      }
    })

    it('covers every Buzz command name 1:1 from the coverage manifest', async () => {
      const { methods } = await loadMethods()
      const covered = new Set(methods.map((method) => method.name.replace('canvas.', '')))

      const expectedByBuzzCommand: Record<string, string> = {
        get_canvas: 'getCanvas',
        set_canvas: 'setCanvas',
        publish_note: 'publishNote',
        get_note: 'getNote',
        get_user_notes: 'getUserNotes',
        get_global_notes: 'getGlobalNotes',
        get_liked_notes: 'getLikedNotes',
        get_notes_timeline: 'getNotesTimeline',
        get_note_reactions: 'getNoteReactions'
      }
      expect(Object.keys(expectedByBuzzCommand)).toHaveLength(9)

      for (const [buzzCommand, methodSuffix] of Object.entries(expectedByBuzzCommand)) {
        expect(covered.has(methodSuffix), `missing RPC method for Buzz command ${buzzCommand}`).toBe(true)
      }
    })
  })

  describe('canvas document', () => {
    it('set_canvas signs a kind-30011 addressable event and get_canvas reads it back', async () => {
      const { methods, store, selfPubkey } = await loadMethods()

      const setResult = (await callMethod(methodNamed(methods, 'canvas.setCanvas'), {
        channelId: 'channel-1',
        content: '# Hello canvas'
      })) as { ok: boolean; event_id: string }

      expect(setResult.ok).toBe(true)
      const stored = store.query([{ ids: [setResult.event_id] }])
      expect(stored).toHaveLength(1)
      expect(stored[0].kind).toBe(DOBIUS_CANVAS_KIND)
      expect(stored[0].tags).toContainEqual(['d', 'channel-1'])

      const fetched = (await callMethod(methodNamed(methods, 'canvas.getCanvas'), {
        channelId: 'channel-1'
      })) as { content: string | null; updated_at: number | null; author: string | null }

      expect(fetched.content).toBe('# Hello canvas')
      expect(fetched.updated_at).toBe(stored[0].created_at)
      expect(fetched.author).toBe(selfPubkey)
    })

    it('get_canvas returns all-null for a channel that has no canvas yet', async () => {
      const { methods } = await loadMethods()

      const fetched = await callMethod(methodNamed(methods, 'canvas.getCanvas'), {
        channelId: 'fresh-channel'
      })

      expect(fetched).toEqual({ content: null, updated_at: null, author: null })
    })

    it('get_canvas surfaces the newest stored revision', async () => {
      const { methods, store } = await loadMethods()
      store.insert(seedEvent({ kind: DOBIUS_CANVAS_KIND, created_at: 2000, tags: [['d', 'ch-rev']], content: 'older' }))
      store.insert(seedEvent({ kind: DOBIUS_CANVAS_KIND, created_at: 3000, tags: [['d', 'ch-rev']], content: 'newer' }))

      const fetched = await callMethod(methodNamed(methods, 'canvas.getCanvas'), { channelId: 'ch-rev' })

      expect((fetched as { content: string }).content).toBe('newer')
    })

    it('rejects blank channel ids after trimming, not just missing ones', async () => {
      const { methods } = await loadMethods()

      await expect(callMethod(methodNamed(methods, 'canvas.setCanvas'), { channelId: '   ', content: 'x' })).rejects.toThrow(
        'Missing channel id'
      )
      await expect(callMethod(methodNamed(methods, 'canvas.getCanvas'), {})).rejects.toThrow()
    })
  })

  describe('social notes', () => {
    it('publish_note signs a kind-1111 event carrying reply/mention/media tags and no h tag', async () => {
      const { methods, store } = await loadMethods()

      const result = (await callMethod(methodNamed(methods, 'canvas.publishNote'), {
        content: 'hello world',
        replyTo: 'note-parent',
        mentionPubkeys: [AUTHOR_OTHER],
        mediaTags: [['media', 'https://example.invalid/x.png']]
      })) as { event_id: string; accepted: boolean; message: string }

      expect(result.accepted).toBe(true)
      const stored = store.query([{ ids: [result.event_id] }])
      expect(stored).toHaveLength(1)
      expect(stored[0].kind).toBe(DOBIUS_NOTE_KIND)
      expect(stored[0].tags).toEqual([
        ['e', 'note-parent', '', 'reply'],
        ['p', AUTHOR_OTHER],
        ['media', 'https://example.invalid/x.png']
      ])
      expect(stored[0].tags.some((tag) => tag[0] === 'h')).toBe(false)
    })

    it('publish_note refuses a note with neither text nor an attachment', async () => {
      const { methods } = await loadMethods()

      await expect(
        callMethod(methodNamed(methods, 'canvas.publishNote'), { content: '   ', replyTo: null })
      ).rejects.toThrow('A note needs text or an attachment.')
    })

    it('get_note returns the raw note shape, or null for an unknown id', async () => {
      const { methods, selfPubkey } = await loadMethods()

      const published = (await callMethod(methodNamed(methods, 'canvas.publishNote'), {
        content: 'find me',
        replyTo: null
      })) as { event_id: string }

      const note = (await callMethod(methodNamed(methods, 'canvas.getNote'), {
        noteId: published.event_id
      })) as { id: string; pubkey: string; content: string; created_at: number; tags: string[][] }

      expect(note.id).toBe(published.event_id)
      expect(note.pubkey).toBe(selfPubkey)
      expect(note.content).toBe('find me')

      await expect(callMethod(methodNamed(methods, 'canvas.getNote'), { noteId: 'not-a-note' })).resolves.toBeNull()
    })

    it('getUserNotes pages one author newest-first and terminates the cursor', async () => {
      const { methods, store, selfPubkey } = await loadMethods()
      store.insert(seedEvent({ pubkey: selfPubkey, created_at: 100, content: 'first' }))
      const second = seedEvent({ pubkey: selfPubkey, created_at: 101, content: 'second' })
      store.insert(second)
      store.insert(seedEvent({ pubkey: selfPubkey, created_at: 102, content: 'third' }))
      store.insert(seedEvent({ pubkey: AUTHOR_OTHER, created_at: 105, content: 'someone else' }))

      const page1 = (await callMethod(methodNamed(methods, 'canvas.getUserNotes'), {
        pubkey: selfPubkey,
        limit: 2,
        before: null,
        beforeId: null
      })) as { notes: Array<{ id: string; content: string }>; next_cursor: { before: number; before_id: string } | null }

      expect(page1.notes.map((note) => note.content)).toEqual(['third', 'second'])
      const cursor = page1.next_cursor
      if (!cursor) {
        throw new Error('expected a next_cursor after a truncated first page')
      }
      expect(cursor).toEqual({ before: 101, before_id: second.id })

      const page2 = (await callMethod(methodNamed(methods, 'canvas.getUserNotes'), {
        pubkey: selfPubkey,
        limit: 2,
        before: cursor.before,
        beforeId: cursor.before_id
      })) as { notes: Array<{ content: string }>; next_cursor: unknown }

      expect(page2.notes.map((note) => note.content)).toEqual(['first'])
      expect(page2.next_cursor).toBeNull()
    })

    it('getGlobalNotes merges every author newest-first', async () => {
      const { methods, store, selfPubkey } = await loadMethods()
      store.insert(seedEvent({ pubkey: selfPubkey, created_at: 100, content: 'mine' }))
      store.insert(seedEvent({ pubkey: AUTHOR_OTHER, created_at: 200, content: 'theirs' }))

      const page = (await callMethod(methodNamed(methods, 'canvas.getGlobalNotes'), {
        limit: 10,
        before: null,
        beforeId: null
      })) as { notes: Array<{ content: string }>; next_cursor: unknown }

      expect(page.notes.map((note) => note.content)).toEqual(['theirs', 'mine'])
      expect(page.next_cursor).toBeNull()
    })

    it('getNotesTimeline caps each author at limitPerUser', async () => {
      const { methods, store, selfPubkey } = await loadMethods()
      store.insert(seedEvent({ pubkey: selfPubkey, created_at: 101, content: 'self-old' }))
      store.insert(seedEvent({ pubkey: selfPubkey, created_at: 102, content: 'self-new' }))
      store.insert(seedEvent({ pubkey: AUTHOR_OTHER, created_at: 200, content: 'other-old' }))
      store.insert(seedEvent({ pubkey: AUTHOR_OTHER, created_at: 201, content: 'other-new' }))

      const page = (await callMethod(methodNamed(methods, 'canvas.getNotesTimeline'), {
        pubkeys: [selfPubkey, AUTHOR_OTHER],
        limitPerUser: 1
      })) as { notes: Array<{ content: string }> }

      expect(page.notes.map((note) => note.content)).toEqual(['other-new', 'self-new'])
    })

    it('getLikedNotes resolves only the notes the author actually reacted to', async () => {
      const { methods, store } = await loadMethods()
      const likedNote = seedEvent({ pubkey: AUTHOR_OTHER, created_at: 300, content: 'liked note' })
      const vanishedNoteId = 'note-id-without-a-stored-event'
      store.insert(likedNote)
      store.insert(seedEvent({ kind: DOBIUS_REACTION_KIND, created_at: 400, tags: [['e', likedNote.id]], content: '+' }))
      // A reaction whose target note no longer exists in the store must not
      // conjure the note back.
      store.insert(seedEvent({ kind: DOBIUS_REACTION_KIND, created_at: 401, tags: [['e', vanishedNoteId]], content: '+' }))

      const page = (await callMethod(methodNamed(methods, 'canvas.getLikedNotes'), {
        authorPubkey: AUTHOR_OTHER,
        limit: 10
      })) as { notes: Array<{ content: string }>; next_cursor: unknown }

      expect(page.notes.map((note) => note.content)).toEqual(['liked note'])
      expect(page.next_cursor).toBeNull()
    })

    it('getLikedNotes returns an empty page for an author with no reactions', async () => {
      const { methods } = await loadMethods()

      const page = await callMethod(methodNamed(methods, 'canvas.getLikedNotes'), {
        authorPubkey: AUTHOR_OTHER,
        limit: 10
      })

      expect(page).toEqual({ notes: [], next_cursor: null })
    })

    it('getNoteReactions groups by note and emoji, counting each pubkey once', async () => {
      const { methods, store } = await loadMethods()
      const note = seedEvent({ content: 'react to me' })
      store.insert(note)
      const likerA = 'c'.repeat(64)
      const likerB = 'd'.repeat(64)
      store.insert(seedEvent({ kind: DOBIUS_REACTION_KIND, pubkey: likerA, tags: [['e', note.id]], content: '+' }))
      store.insert(seedEvent({ kind: DOBIUS_REACTION_KIND, pubkey: likerA, tags: [['e', note.id]], content: '+' }))
      store.insert(seedEvent({ kind: DOBIUS_REACTION_KIND, pubkey: likerB, tags: [['e', note.id]], content: '+' }))
      store.insert(seedEvent({ kind: DOBIUS_REACTION_KIND, pubkey: likerB, tags: [['e', note.id]], content: '🔥' }))
      store.insert(seedEvent({ kind: DOBIUS_REACTION_KIND, pubkey: likerB, tags: [['e', 'some-other-note']], content: '+' }))

      const summaries = (await callMethod(methodNamed(methods, 'canvas.getNoteReactions'), {
        noteIds: [note.id]
      })) as Array<{ note_id: string; emoji: string; count: number; pubkeys: string[] }>

      expect(summaries).toHaveLength(2)
      expect(summaries).toContainEqual({ note_id: note.id, emoji: '+', count: 2, pubkeys: [likerA, likerB] })
      expect(summaries).toContainEqual({ note_id: note.id, emoji: '🔥', count: 1, pubkeys: [likerB] })
    })
  })

  describe('validation', () => {
    it('enforces the schemas at the RPC boundary', async () => {
      const { methods } = await loadMethods()

      expect(methodNamed(methods, 'canvas.getUserNotes').params?.safeParse({}).success).toBe(false)
      // The vendor client always threads explicit nulls for absent paging
      // fields (social.ts passes `limit: options?.limit ?? null`) — those
      // must stay valid, not fail the boundary.
      expect(
        methodNamed(methods, 'canvas.getUserNotes').params?.safeParse({
          pubkey: AUTHOR_OTHER,
          limit: null,
          before: null,
          beforeId: null
        }).success
      ).toBe(true)
      expect(methodNamed(methods, 'canvas.getNoteReactions').params?.safeParse({ noteIds: [] }).success).toBe(false)
      expect(methodNamed(methods, 'canvas.getNotesTimeline').params?.safeParse({ pubkeys: [] }).success).toBe(false)
      expect(methodNamed(methods, 'canvas.publishNote').params?.safeParse({ content: 'ok', mentionPubkeys: 'nope' }).success).toBe(false)
      expect(methodNamed(methods, 'canvas.setCanvas').params?.safeParse({ channelId: 'c' }).success).toBe(false)
    })
  })
})
