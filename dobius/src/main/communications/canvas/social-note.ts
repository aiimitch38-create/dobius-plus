/**
 * Pure shaping logic for the "social note" command family: get_note,
 * get_user_notes, get_liked_notes, get_global_notes, get_notes_timeline,
 * and publish_note (vendor call sites in shared/api/social.ts). See
 * canvas-document.ts's top comment for why this stays fetch/signing-free.
 */
import { DOBIUS_NOTE_KIND } from './canvas-relay-kinds'

export type NoteSourceEvent = {
  id: string
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

/** Wire shape of one note — mirrors RawUserNote (vendor social.ts:11). */
export type RawUserNote = {
  id: string
  pubkey: string
  created_at: number
  content: string
  tags: string[][]
}

export type RawUserNotesCursor = {
  before: number
  before_id: string
}

/** Mirrors RawUserNotesResponse (vendor social.ts:31), the return shape of
 * every notes list command in this family. */
export type RawUserNotesResponse = {
  notes: RawUserNote[]
  next_cursor: RawUserNotesCursor | null
}

export function rawUserNoteFromEvent(event: NoteSourceEvent): RawUserNote {
  return { id: event.id, pubkey: event.pubkey, created_at: event.created_at, content: event.content, tags: event.tags }
}

/**
 * The relay has no `until` filter (relay-types.ts's RelayFilter doc: "search,
 * `until`, and arbitrary #<letter> tags are unused, so supporting them would
 * be speculative surface"), so cursor pagination here is an overfetch +
 * client-side-filter approximation — the same honest tradeoff
 * getDobiusChannelWindow already ships in dobiusCommunications.ts. This
 * constant sizes that overfetch: request enough extra rows that filtering
 * out everything at-or-after the cursor still leaves a full page whenever
 * that many newer rows actually exist.
 */
export const NOTE_QUERY_OVERFETCH_FACTOR = 4
export const NOTE_QUERY_MIN_OVERFETCH = 50

export function noteQueryFetchLimit(pageLimit: number): number {
  return Math.max(pageLimit * NOTE_QUERY_OVERFETCH_FACTOR, pageLimit + NOTE_QUERY_MIN_OVERFETCH)
}

/** Deterministic newest-first order, ascending id as tiebreak — mirrors
 * relay-store.ts's own `compareNewestFirst` so cursor math agrees with what
 * the relay already returned the events sorted as. */
function compareNewestFirst(a: NoteSourceEvent, b: NoteSourceEvent): number {
  if (a.created_at !== b.created_at) {return b.created_at - a.created_at}
  if (a.id === b.id) {return 0}
  return a.id < b.id ? -1 : 1
}

export type NotePageCursor = { before?: number; beforeId?: string }

/**
 * Slices an (overfetched) batch of note events into one page, honoring an
 * optional `{ before, beforeId }` cursor from a previous page's
 * `next_cursor`. `next_cursor` is non-null only when strictly more rows
 * exist past the returned page, so a client that keeps paging always
 * terminates instead of looping on a same-sized last page.
 */
export function paginateNotes(events: NoteSourceEvent[], limit: number, cursor: NotePageCursor = {}): RawUserNotesResponse {
  const sorted = [...events].sort(compareNewestFirst)
  const filtered =
    cursor.before === undefined
      ? sorted
      : sorted.filter(
          (event) =>
            event.created_at < cursor.before! ||
            (event.created_at === cursor.before && cursor.beforeId !== undefined && event.id > cursor.beforeId)
        )
  const page = filtered.slice(0, limit)
  const last = page.at(-1)
  const nextCursor: RawUserNotesCursor | null =
    filtered.length > page.length && last ? { before: last.created_at, before_id: last.id } : null
  return { notes: page.map(rawUserNoteFromEvent), next_cursor: nextCursor }
}

export type PublishNoteInput = {
  content: string
  replyTo?: string | null
  mentionPubkeys?: string[] | null
  mediaTags?: string[][] | null
}

export function assertPublishableNoteContent(input: PublishNoteInput): void {
  const hasContent = typeof input.content === 'string' && input.content.trim().length > 0
  const hasMedia = Array.isArray(input.mediaTags) && input.mediaTags.length > 0
  if (!hasContent && !hasMedia) {
    throw new Error('A note needs text or an attachment.')
  }
}

/** Tags publish_note must sign onto the note event. Never carries an "h"
 * tag — that is precisely what keeps a note out of channel-scoped queries
 * (see canvas-relay-kinds.ts's DOBIUS_NOTE_KIND doc). */
export function noteEventTags(input: PublishNoteInput): string[][] {
  const tags: string[][] = []
  if (typeof input.replyTo === 'string' && input.replyTo.trim()) {
    tags.push(['e', input.replyTo.trim(), '', 'reply'])
  }
  for (const pubkey of input.mentionPubkeys ?? []) {
    if (typeof pubkey === 'string' && pubkey.trim()) {tags.push(['p', pubkey.trim()])}
  }
  for (const tag of input.mediaTags ?? []) {
    if (Array.isArray(tag) && tag.every((part) => typeof part === 'string') && tag.length > 0) {
      tags.push(tag)
    }
  }
  return tags
}

export function noteQueryFilterForAuthor(pubkey: string, fetchLimit: number): { kinds: number[]; authors: string[]; limit: number } {
  return { kinds: [DOBIUS_NOTE_KIND], authors: [pubkey], limit: fetchLimit }
}

export function noteQueryFilterGlobal(fetchLimit: number): { kinds: number[]; limit: number } {
  return { kinds: [DOBIUS_NOTE_KIND], limit: fetchLimit }
}

export function noteQueryFilterByIds(ids: string[]): { kinds: number[]; ids: string[]; limit: number } {
  return { kinds: [DOBIUS_NOTE_KIND], ids, limit: Math.max(ids.length, 1) }
}
