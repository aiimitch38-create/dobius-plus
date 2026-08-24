/**
 * Verification-harness fixtures for the nine canvas-notes RPC methods
 * (canvas-rpc-methods.ts): canvas.getCanvas/setCanvas plus the seven social
 * note methods. Composed into the shared SCENARIO array by
 * ../verify/command-scenario.ts (one import + one array-spread); this module
 * never edits verify/ itself.
 *
 * SEAM — every step sets via: 'method' and dispatches the RPC METHOD name.
 * All nine names are registered in ALL_RPC_METHODS (runtime/rpc/methods/
 * index.ts) and listed in COMMUNICATIONS_RUNTIME_METHODS (src/shared/
 * communications-bridge.ts), so they are reachable only through the real
 * gateway pipeline (sender-trust + allowlist + dispatcher). The handlers'
 * HTTP-loopback calls to the harness relay (127.0.0.1:3300) are safe here:
 * run-verification.test.ts's beforeAll starts that relay first and fails
 * loudly when it cannot.
 *
 * AUTHOR IDENTITY — these handlers sign through the MAIN-PROCESS participant
 * identity (participant-identity-store.ts under the harness's mocked
 * homedir), which is a DIFFERENT keypair from ctx.selfPubkey (the renderer
 * localStorage identity CORE seeds). No method's return value names the
 * author up front, so the chain derives it for real: setCanvas writes the
 * channel canvas, getCanvas reads it back and captures `author` into
 * ctx.family, and every later author-keyed query (getUserNotes,
 * getNotesTimeline, getLikedNotes) uses that captured pubkey instead of
 * guessing an identity this seam never hands out.
 *
 * REACTIONS ARE HONESTLY EMPTY — none of these nine methods can create a
 * reaction. Kind-7 events are published only by the vendor-seam
 * add_reaction/remove_reaction commands (CORE spends both on its channel
 * message, targeting ctx.eventId — a kind-1 id, never a note id). So:
 *   - getNoteReactions asserts [] : reactionQueryFilterForNotes matches only
 *     '#e' tags naming OUR note id, which no writer can reference.
 *   - getLikedNotes asserts the empty page {notes: [], next_cursor: null} :
 *     the participant identity has authored zero kind-7 events, and even a
 *     hypothetical message-directed one could not resolve through the
 *     two-hop lookup, which re-fetches by ids under kinds:[DOBIUS_NOTE_KIND].
 * The non-empty aggregation path is covered by note-reaction-aggregate.test.ts.
 *
 * NO requiresSecondBoundary ANYWHERE. The supersede race that flag guards
 * against needs a SECOND write of the SAME (pubkey, KIND, d-tag): setCanvas
 * is this run's only kind-30011 write (CORE writes kinds 39000/39002 to the
 * same channel id — different kind, no collision), and publishNote emits
 * kind 1111, deliberately non-addressable, so notes never replace each
 * other regardless of timing. Write-to-read visibility is synchronous: the
 * relay inserts into its store before answering POST /events 200, and every
 * read here runs after the write step returned. Newest-first assertions
 * therefore hold without any second-boundary wait.
 *
 * UNIQUENESS — the runner requires every via:'method' command name to be
 * unique across the whole composed SCENARIO, so publishNote appears exactly
 * once: exactly one note exists per run, making the singleton assertions
 * below exact rather than approximate.
 *
 * CLEANUP: the relay store is ':memory:' and dies with the run; the canvas
 * document persists only in that store. Nothing outlives the process.
 */
import {
  fail,
  isRecord,
  ok,
  type ScenarioContext,
  type ScenarioStep,
  type ShapeOutcome
} from '../scenario-contract'

const CANVAS_CONTENT = '# Canvas Verify\n\nSeeded by canvas.scenarios.'
const NOTE_CONTENT = 'Canvas verification probe note.'

const AUTHOR_KEY = 'canvasVerifyAuthorPubkey'
const NOTE_ID_KEY = 'canvasVerifyNoteId'
const NOTE_CREATED_KEY = 'canvasVerifyNoteCreatedAt'

function familyOf(ctx: ScenarioContext): Record<string, unknown> {
  return ctx.family
}

/** Event ids/pubkeys are 32 bytes, always lowercase hex on the wire. */
function isHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** Full RawUserNote wire shape (social-note.ts) every list row must carry. */
function isRawUserNoteShape(value: unknown): ShapeOutcome {
  if (!isRecord(value)) {
    return fail(`expected a note object, got ${typeof value}`)
  }
  if (!isHex64(value.id)) {
    return fail(`note.id should be 64-hex, got ${JSON.stringify(value.id)}`)
  }
  if (!isHex64(value.pubkey)) {
    return fail(`note.pubkey should be 64-hex, got ${JSON.stringify(value.pubkey)}`)
  }
  if (typeof value.created_at !== 'number' || !(value.created_at > 0)) {
    return fail(`note.created_at should be a positive unix second, got ${JSON.stringify(value.created_at)}`)
  }
  if (typeof value.content !== 'string') {
    return fail(`note.content should be a string, got ${typeof value.content}`)
  }
  if (
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'))
  ) {
    return fail(`note.tags should be string[][], got ${JSON.stringify(value.tags)}`)
  }
  return ok()
}

function isNotesPageShape(value: unknown): ShapeOutcome {
  if (!isRecord(value)) {
    return fail(`expected { notes, next_cursor }, got ${JSON.stringify(value)}`)
  }
  if (!Array.isArray(value.notes)) {
    return fail('missing notes array')
  }
  for (const note of value.notes) {
    const shape = isRawUserNoteShape(note)
    if (!shape.ok) {
      return shape
    }
  }
  const cursor = value.next_cursor
  if (cursor !== null && (!isRecord(cursor) || typeof cursor.before !== 'number' || typeof cursor.before_id !== 'string')) {
    return fail(`next_cursor should be null or {before, before_id}, got ${JSON.stringify(cursor)}`)
  }
  return ok()
}

/** paginateNotes/RelayStore sort newest-first with an id tiebreak; created_at
 * is therefore non-increasing across any correctly ordered page. */
function isNewestFirst(notes: unknown[]): boolean {
  return notes.every(
    (note, index) =>
      index === 0 ||
      ((notes[index - 1] as Record<string, unknown>).created_at as number) >=
        ((note as Record<string, unknown>).created_at as number)
  )
}

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    // Sole kind-30011 write of the run (see module doc): returns the signed
    // event id, which the relay accepted synchronously.
    command: 'canvas.setCanvas',
    via: 'method',
    args: (ctx) => ({ channelId: ctx.channelId, content: CANVAS_CONTENT }),
    shapeCheck: (r) => {
      if (!isRecord(r)) {
        return fail(`expected { ok, event_id }, got ${JSON.stringify(r)}`)
      }
      if (r.ok !== true) {
        return fail(`expected ok: true, got ${JSON.stringify(r.ok)}`)
      }
      return isHex64(r.event_id) ? ok() : fail(`event_id should be 64-hex, got ${JSON.stringify(r.event_id)}`)
    }
  },
  {
    // Round-trip: the just-written content comes back verbatim, authored by
    // the main-process participant identity — captured here because it is
    // the ONLY place the method seam reveals that pubkey (see module doc).
    command: 'canvas.getCanvas',
    via: 'method',
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: (r) => {
      if (!isRecord(r)) {
        return fail(`expected { content, updated_at, author }, got ${JSON.stringify(r)}`)
      }
      if (r.content !== CANVAS_CONTENT) {
        return fail(`canvas content did not round-trip: ${JSON.stringify(r.content)}`)
      }
      if (typeof r.updated_at !== 'number' || !(r.updated_at > 0)) {
        return fail(`updated_at should be a positive unix second, got ${JSON.stringify(r.updated_at)}`)
      }
      return isHex64(r.author) ? ok() : fail(`author should be 64-hex, got ${JSON.stringify(r.author)}`)
    },
    capture: (r, ctx) => {
      if (isRecord(r) && isHex64(r.author)) {
        familyOf(ctx)[AUTHOR_KEY] = r.author
      }
    }
  },
  {
    // mentionPubkeys exercises noteEventTags' p-tag projection; the tags
    // round-trip verbatim and are asserted exactly in get_note below.
    command: 'canvas.publishNote',
    via: 'method',
    args: (ctx) => ({ content: NOTE_CONTENT, replyTo: null, mentionPubkeys: [ctx.otherPubkey], mediaTags: null }),
    shapeCheck: (r) => {
      if (!isRecord(r)) {
        return fail(`expected { event_id, accepted, message }, got ${JSON.stringify(r)}`)
      }
      if (r.accepted !== true) {
        return fail(`expected accepted: true, got ${JSON.stringify(r.accepted)}`)
      }
      if (r.message !== '') {
        return fail(`expected empty message, got ${JSON.stringify(r.message)}`)
      }
      return isHex64(r.event_id) ? ok() : fail(`event_id should be 64-hex, got ${JSON.stringify(r.event_id)}`)
    },
    capture: (r, ctx) => {
      if (isRecord(r) && isHex64(r.event_id)) {
        familyOf(ctx)[NOTE_ID_KEY] = r.event_id
      }
    }
  },
  {
    // Fetch-by-id proves the note landed intact and pins created_at for the
    // list endpoints to cross-check against (same stored event everywhere).
    command: 'canvas.getNote',
    via: 'method',
    args: (ctx) => ({ noteId: familyOf(ctx)[NOTE_ID_KEY] }),
    shapeCheck: (r, ctx) => {
      if (r === null || r === undefined) {
        return fail('published note not found by id')
      }
      const shape = isRawUserNoteShape(r)
      if (!shape.ok) {
        return shape
      }
      const note = r as Record<string, unknown>
      if (note.id !== familyOf(ctx)[NOTE_ID_KEY]) {
        return fail(`id mismatch: ${JSON.stringify(note.id)}`)
      }
      if (note.content !== NOTE_CONTENT) {
        return fail(`content mismatch: ${JSON.stringify(note.content)}`)
      }
      if (note.pubkey !== familyOf(ctx)[AUTHOR_KEY]) {
        return fail(`author mismatch: ${JSON.stringify(note.pubkey)} vs captured canvas author`)
      }
      if (JSON.stringify(note.tags) !== JSON.stringify([['p', ctx.otherPubkey]])) {
        return fail(`tags did not round-trip the mention: ${JSON.stringify(note.tags)}`)
      }
      return ok()
    },
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.created_at === 'number') {
        familyOf(ctx)[NOTE_CREATED_KEY] = r.created_at
      }
    }
  },
  {
    // Multi-author merge: the real participant author plus the renderer's
    // otherPubkey (which has no notes — exercising the empty-filter leg).
    command: 'canvas.getNotesTimeline',
    via: 'method',
    args: (ctx) => ({ pubkeys: [familyOf(ctx)[AUTHOR_KEY], ctx.otherPubkey], limitPerUser: 10 }),
    shapeCheck: (r, ctx) => {
      const shape = isNotesPageShape(r)
      if (!shape.ok) {
        return shape
      }
      const page = r as Record<string, unknown>
      if (!isNewestFirst(page.notes as unknown[])) {
        return fail(`timeline rows not newest-first: ${JSON.stringify((page.notes as Record<string, unknown>[]).map((n) => n.created_at))}`)
      }
      const mine = (page.notes as Record<string, unknown>[]).find((n) => n.id === familyOf(ctx)[NOTE_ID_KEY])
      if (!mine) {
        return fail('published note missing from its own author timeline')
      }
      return mine.created_at === familyOf(ctx)[NOTE_CREATED_KEY] && mine.content === NOTE_CONTENT
        ? ok()
        : fail(`timeline served a divergent copy of the note: ${JSON.stringify(mine)}`)
    }
  },
  {
    // Author-scoped page: the participant identity publishes kind-1111 notes
    // through exactly one step in this whole SCENARIO (unique-command
    // invariant, see module doc), so the page is EXACTLY our singleton —
    // with next_cursor null because no further rows exist past it.
    command: 'canvas.getUserNotes',
    via: 'method',
    args: (ctx) => ({ pubkey: familyOf(ctx)[AUTHOR_KEY], limit: 10 }),
    shapeCheck: (r, ctx) => {
      const shape = isNotesPageShape(r)
      if (!shape.ok) {
        return shape
      }
      const page = r as Record<string, unknown>
      const notes = page.notes as Record<string, unknown>[]
      if (notes.length !== 1) {
        return fail(`expected exactly the one published note, got ${notes.length} rows`)
      }
      const [mine] = notes
      return mine.id === familyOf(ctx)[NOTE_ID_KEY] &&
        mine.created_at === familyOf(ctx)[NOTE_CREATED_KEY] &&
        mine.content === NOTE_CONTENT &&
        page.next_cursor === null
        ? ok()
        : fail(`unexpected user-notes page: ${JSON.stringify({ id: mine.id, cursor: page.next_cursor })}`)
    }
  },
  {
    // Global feed has no author filter; our note must surface in it with the
    // same fields get_note returned, and the page must stay newest-first.
    command: 'canvas.getGlobalNotes',
    via: 'method',
    args: () => ({ limit: 20 }),
    shapeCheck: (r, ctx) => {
      const shape = isNotesPageShape(r)
      if (!shape.ok) {
        return shape
      }
      const page = r as Record<string, unknown>
      const notes = page.notes as Record<string, unknown>[]
      if (!isNewestFirst(notes)) {
        return fail(`global rows not newest-first: ${JSON.stringify(notes.map((n) => n.created_at))}`)
      }
      const mine = notes.find((n) => n.id === familyOf(ctx)[NOTE_ID_KEY])
      if (!mine) {
        return fail('published note missing from the global feed')
      }
      return mine.created_at === familyOf(ctx)[NOTE_CREATED_KEY] && mine.pubkey === familyOf(ctx)[AUTHOR_KEY]
        ? ok()
        : fail(`global feed served a divergent copy: ${JSON.stringify(mine)}`)
    }
  },
  {
    // Honest zero: nothing in this SCENARIO can react to a note (module doc,
    // REACTIONS ARE HONESTLY EMPTY), so [] is the true aggregate.
    command: 'canvas.getNoteReactions',
    via: 'method',
    args: (ctx) => ({ noteIds: [familyOf(ctx)[NOTE_ID_KEY]] }),
    shapeCheck: (r) => (Array.isArray(r) && r.length === 0 ? ok() : fail(`expected [], got ${JSON.stringify(r)}`))
  },
  {
    // Honest empty page: the participant identity has authored zero kind-7
    // reactions (module doc), so the liked lookup resolves nothing.
    command: 'canvas.getLikedNotes',
    via: 'method',
    args: (ctx) => ({ authorPubkey: familyOf(ctx)[AUTHOR_KEY], limit: 10 }),
    shapeCheck: (r) =>
      isRecord(r) && Array.isArray(r.notes) && r.notes.length === 0 && r.next_cursor === null
        ? ok()
        : fail(`expected { notes: [], next_cursor: null }, got ${JSON.stringify(r)}`)
  }
]
