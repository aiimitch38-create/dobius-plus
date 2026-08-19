/**
 * Client-side cursor pagination for channel message history.
 *
 * Why this exists: the relay's `/query` endpoint has no `until` support (see
 * relay-filters.ts and relay-types.ts — `until` is deliberately unimplemented,
 * silently ignored rather than rejected). A "load older messages" page must
 * therefore be computed here, over a bulk newest-first fetch, rather than
 * asked of the relay directly. Mirrors the escape-hatch cursor contract
 * documented on `getChannelMessagesBefore` in
 * vendor/buzz-desktop/src/shared/api/tauriChannels.ts: strictly older than
 * `(before, beforeId)`, i.e. `created_at < before OR (created_at === before
 * AND id > beforeId)`.
 */

export type ChatEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

export type MessagePageCursor = {
  createdAt: number
  eventId: string
}

export type MessagePage = {
  /** Ascending by created_at — ready to prepend above the currently loaded page. */
  events: ChatEvent[]
  /** Cursor for the next (older) page, or null once the page came back short. */
  nextCursor: MessagePageCursor | null
}

/**
 * `events` must already be sorted newest-first (created_at desc, id asc on
 * ties) — the shape our relay's `/query` returns. A null cursor means "from
 * the newest message", matching the first page of a channel's history.
 */
export function selectMessagesBeforeCursor(
  events: readonly ChatEvent[],
  cursor: MessagePageCursor | null,
  limit: number
): MessagePage {
  const olderNewestFirst = cursor
    ? events.filter(
        (event) => event.created_at < cursor.createdAt || (event.created_at === cursor.createdAt && event.id > cursor.eventId)
      )
    : events

  const page = olderNewestFirst.slice(0, limit)
  const oldest = page.at(-1)

  return {
    events: page.toReversed(),
    nextCursor: page.length === limit && oldest ? { createdAt: oldest.created_at, eventId: oldest.id } : null
  }
}
