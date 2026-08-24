/**
 * RPC methods backing the 9 canvas-notes Buzz commands (vendor call sites:
 * shared/api/tauri.ts getCanvas/setCanvas, shared/api/social.ts for the
 * note family). Handlers own no storage — they shape input/output through
 * this directory's tested stores (canvas-document.ts, social-note.ts,
 * note-reaction-aggregate.ts), sign through the main-process participant
 * identity (participant-identity-store.ts), and ride the local relay's HTTP
 * routes via identity/relay-http-client.ts — the same round trip every
 * other relay-backed main-process module uses (see identity-archival-relay.ts).
 *
 * WIRING (not applied by this file — see the build report): the coordinator
 * adds one import + one array-spread line to ALL_RPC_METHODS in
 * src/main/runtime/rpc/methods/index.ts and nine entries to
 * COMMUNICATIONS_RUNTIME_METHODS in src/shared/communications-bridge.ts.
 */
import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../../runtime/rpc/core'
import { OptionalPositiveInt, requiredString } from '../../runtime/rpc/schemas'
import { queryRelayEvents, submitRelayEvent } from '../identity/relay-http-client'
import { signParticipantEvent } from '../participant-identity-store'
import {
  assertValidChannelId,
  assertValidCanvasContent,
  canvasEventTags,
  canvasQueryFilter,
  canvasResponseFromEvent
} from './canvas-document'
import {
  aggregateNoteReactions,
  reactionQueryFilterForNotes
} from './note-reaction-aggregate'
import {
  assertPublishableNoteContent,
  noteEventTags,
  noteQueryFetchLimit,
  noteQueryFilterByIds,
  noteQueryFilterForAuthor,
  noteQueryFilterGlobal,
  paginateNotes,
  rawUserNoteFromEvent,
  type NotePageCursor,
  type PublishNoteInput
} from './social-note'
import { DOBIUS_CANVAS_KIND, DOBIUS_NOTE_KIND, DOBIUS_REACTION_KIND } from './canvas-relay-kinds'

// Page size when the caller omits `limit` — same scale as the vendor UI's
// explicit page requests (scenario args pass 10-20) and comfortably below
// the relay's own default cap.
const DEFAULT_NOTE_PAGE_LIMIT = 50

const NullableInt = z.union([z.number().int(), z.null()]).optional()
const NullableString = z.union([z.string(), z.null()]).optional()

const GetCanvasParams = z.object({ channelId: requiredString('Missing channel id') })

const SetCanvasParams = z.object({
  channelId: requiredString('Missing channel id'),
  content: z.string()
})

const PublishNoteParams = z.object({
  content: z.string(),
  replyTo: NullableString,
  mentionPubkeys: z.array(z.string()).nullable().optional(),
  mediaTags: z.array(z.array(z.string())).nullable().optional()
})

const GetNoteParams = z.object({ noteId: requiredString('Missing note id') })

const NotesCursorFields = {
  limit: OptionalPositiveInt,
  before: NullableInt,
  beforeId: NullableString
}

const GetUserNotesParams = z.object({
  ...NotesCursorFields,
  pubkey: requiredString('Missing author pubkey')
})

const GetGlobalNotesParams = z.object(NotesCursorFields)

const GetLikedNotesParams = z.object({
  authorPubkey: requiredString('Missing author pubkey'),
  limit: OptionalPositiveInt
})

const GetNotesTimelineParams = z.object({
  pubkeys: z.array(requiredString('Missing timeline pubkey')).min(1, 'Missing timeline pubkeys'),
  limitPerUser: OptionalPositiveInt
})

const GetNoteReactionsParams = z.object({
  noteIds: z.array(requiredString('Missing note id')).min(1, 'Missing note ids')
})

function noteCursor(before: number | null | undefined, beforeId: string | null | undefined): NotePageCursor {
  const cursor: NotePageCursor = {}
  if (typeof before === 'number') {
    cursor.before = before
  }
  if (typeof beforeId === 'string') {
    cursor.beforeId = beforeId
  }
  return cursor
}

export const CANVAS_NOTES_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'canvas.getCanvas',
    params: GetCanvasParams,
    handler: async (params) => {
      const channelId = assertValidChannelId(params.channelId)
      const [event] = await queryRelayEvents([canvasQueryFilter(channelId)])
      return canvasResponseFromEvent(event)
    }
  }),
  defineMethod({
    name: 'canvas.setCanvas',
    params: SetCanvasParams,
    handler: async (params) => {
      const channelId = assertValidChannelId(params.channelId)
      const content = assertValidCanvasContent(params.content)
      const signed = signParticipantEvent({
        kind: DOBIUS_CANVAS_KIND,
        content,
        tags: canvasEventTags(channelId)
      })
      await submitRelayEvent(signed)
      return { ok: true, event_id: signed.id }
    }
  }),
  defineMethod({
    name: 'canvas.publishNote',
    params: PublishNoteParams,
    handler: async (params) => {
      const input: PublishNoteInput = params
      assertPublishableNoteContent(input)
      const signed = signParticipantEvent({
        kind: DOBIUS_NOTE_KIND,
        content: input.content,
        tags: noteEventTags(input)
      })
      await submitRelayEvent(signed)
      return { event_id: signed.id, accepted: true, message: '' }
    }
  }),
  defineMethod({
    name: 'canvas.getNote',
    params: GetNoteParams,
    handler: async (params) => {
      const [event] = await queryRelayEvents([noteQueryFilterByIds([params.noteId])])
      return event ? rawUserNoteFromEvent(event) : null
    }
  }),
  defineMethod({
    name: 'canvas.getUserNotes',
    params: GetUserNotesParams,
    handler: async (params) => {
      const pageLimit = params.limit ?? DEFAULT_NOTE_PAGE_LIMIT
      const events = await queryRelayEvents([
        noteQueryFilterForAuthor(params.pubkey, noteQueryFetchLimit(pageLimit))
      ])
      return paginateNotes(events, pageLimit, noteCursor(params.before, params.beforeId))
    }
  }),
  defineMethod({
    name: 'canvas.getGlobalNotes',
    params: GetGlobalNotesParams,
    handler: async (params) => {
      const pageLimit = params.limit ?? DEFAULT_NOTE_PAGE_LIMIT
      const events = await queryRelayEvents([noteQueryFilterGlobal(noteQueryFetchLimit(pageLimit))])
      return paginateNotes(events, pageLimit, noteCursor(params.before, params.beforeId))
    }
  }),
  // Notes the author reacted to. Two hops because a kind-7 event carries
  // only its target id, not the note body; liked-order is then folded back
  // into note-recency order by paginateNotes so cursor semantics match the
  // other list endpoints.
  defineMethod({
    name: 'canvas.getLikedNotes',
    params: GetLikedNotesParams,
    handler: async (params) => {
      const pageLimit = params.limit ?? DEFAULT_NOTE_PAGE_LIMIT
      const reactions = await queryRelayEvents([
        {
          kinds: [DOBIUS_REACTION_KIND],
          authors: [params.authorPubkey],
          limit: noteQueryFetchLimit(pageLimit)
        }
      ])
      const likedIds = [
        ...new Set(
          reactions.map((reaction) => reaction.tags.find((tag) => tag[0] === 'e')?.[1]).filter(
            (noteId): noteId is string => typeof noteId === 'string' && noteId.length > 0
          )
        )
      ]
      if (likedIds.length === 0) {
        return { notes: [], next_cursor: null }
      }
      const notes = await queryRelayEvents([noteQueryFilterByIds(likedIds)])
      return paginateNotes(notes, pageLimit)
    }
  }),
  // One filter per author so each contributes up to limitPerUser rows —
  // RelayStore.query honours per-filter limits and merges newest-first.
  // The merge is still global-newest-first across authors, so the true
  // per-author cap has to be applied client-side before paging.
  defineMethod({
    name: 'canvas.getNotesTimeline',
    params: GetNotesTimelineParams,
    handler: async (params) => {
      const perUserLimit = params.limitPerUser ?? DEFAULT_NOTE_PAGE_LIMIT
      const filters = params.pubkeys.map((pubkey) =>
        noteQueryFilterForAuthor(pubkey, noteQueryFetchLimit(perUserLimit))
      )
      const events = await queryRelayEvents(filters)
      const takenPerAuthor = new Map<string, number>()
      const capped = events.filter((event) => {
        const taken = takenPerAuthor.get(event.pubkey) ?? 0
        if (taken >= perUserLimit) {
          return false
        }
        takenPerAuthor.set(event.pubkey, taken + 1)
        return true
      })
      return paginateNotes(capped, perUserLimit * params.pubkeys.length)
    }
  }),
  defineMethod({
    name: 'canvas.getNoteReactions',
    params: GetNoteReactionsParams,
    handler: async (params) => {
      const events = await queryRelayEvents([reactionQueryFilterForNotes(params.noteIds)])
      return aggregateNoteReactions(events, params.noteIds)
    }
  })
]
