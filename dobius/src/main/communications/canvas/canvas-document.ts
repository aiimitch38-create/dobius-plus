/**
 * Pure shaping logic for `get_canvas`/`set_canvas` (vendor call sites
 * shared/api/tauri.ts:425 and :441). Kept free of `fetch`/signing/Electron
 * so it is unit-testable here; the renderer case blocks this family reports
 * for dobiusCommunications.ts perform the actual relay round trip and call
 * these same shaping rules inline (see this task's report, SWITCH_CASES).
 */
import { DOBIUS_CANVAS_KIND } from './canvas-relay-kinds'

/** Minimal shape of a stored relay event this module reads — a structural
 * subset of RelayEvent (relay/relay-types.ts), not a re-export, so this
 * file has zero import coupling to relay/ (off limits to this family). */
export type CanvasSourceEvent = {
  id: string
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

/** Wire shape `get_canvas` must return — mirrors RawCanvasResponse
 * (vendor tauri.ts:247). `null` fields mean "no canvas yet", which the
 * Buzz UI's ensureWelcomeCanvas relies on to seed a first canvas. */
export type RawCanvasResponse = {
  content: string | null
  updated_at: number | null
  author: string | null
}

export type RawSetCanvasResult = {
  ok: boolean
  event_id: string
}

export function assertValidChannelId(channelId: unknown): string {
  if (typeof channelId !== 'string' || !channelId.trim()) {
    throw new Error('Missing channel id')
  }
  return channelId.trim()
}

export function assertValidCanvasContent(content: unknown): string {
  if (typeof content !== 'string') {
    throw new Error('Missing canvas content')
  }
  return content
}

/** The relay filter `get_canvas` must send: latest addressable canvas
 * event for this channel. `limit: 1` is safe even before RelayStore
 * collapses old revisions, since query() itself returns newest-first. */
export function canvasQueryFilter(channelId: string): {
  kinds: number[]
  '#d': string[]
  limit: number
} {
  return { kinds: [DOBIUS_CANVAS_KIND], '#d': [assertValidChannelId(channelId)], limit: 1 }
}

/** Tags `set_canvas` must sign onto the addressable canvas event. */
export function canvasEventTags(channelId: string): string[][] {
  return [['d', assertValidChannelId(channelId)]]
}

/** Maps the latest matching relay event (or none) to `get_canvas`'s wire
 * response. `undefined` means "no canvas has ever been published for this
 * channel" — distinct from an empty-string canvas, which is a real value. */
export function canvasResponseFromEvent(event: CanvasSourceEvent | undefined): RawCanvasResponse {
  if (!event) {
    return { content: null, updated_at: null, author: null }
  }
  return { content: event.content, updated_at: event.created_at, author: event.pubkey }
}
