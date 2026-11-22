/**
 * The OpenAI Live data-channel events the call uses, in one place.
 *
 * Event NAMES come from plans/research/REALTIME-VOICE-ADAM.md sections 1.3
 * to 1.6. The design doc does not give the FIELDS inside each event, so the
 * readers below accept a few likely spellings and the writers use the
 * plainest one. UNVERIFIED against the live API: every field name here. Check
 * them on the first live call and fix them only in this file.
 */
export const LIVE_DATA_CHANNEL = 'oai-events'

export const LIVE_EVENT = {
  started: 'session.started',
  paused: 'session.paused',
  resumed: 'session.resumed',
  closed: 'session.closed',
  inputDelta: 'session.input_transcript.delta',
  outputDelta: 'session.output_transcript.delta',
  delegation: 'session.delegation.created',
  commentary: 'session.commentary.append',
  mute: 'session.input_audio.mute',
  unmute: 'session.input_audio.unmute',
  error: 'error'
} as const

// Why: commentary.append is capped at 500 tokens (design doc section 1.3).
// Main already shapes ADAM's reply below this; this is the last backstop.
export const LIVE_COMMENTARY_MAX_CHARS = 1_600

export type LiveEvent =
  | { type: 'started'; expiresAtMs: number | null }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'closed'; reason: string }
  | { type: 'input'; delta: string }
  | { type: 'output'; delta: string }
  | { type: 'delegation'; id: string | null }
  | { type: 'error'; message: string }
  | { type: 'other' }

type Raw = Record<string, unknown>

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function nested(raw: Raw, key: string, inner: string): unknown {
  const value = raw[key]
  return value && typeof value === 'object' ? (value as Raw)[inner] : undefined
}

function expiresAtMs(raw: Raw): number | null {
  const value = raw.expires_at ?? nested(raw, 'session', 'expires_at')
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  // Why: OpenAI timestamps are usually Unix seconds; accept milliseconds too.
  return value < 1e12 ? value * 1000 : value
}

/** One data-channel message as an event the call understands, or null. */
export function parseLiveEvent(data: unknown): LiveEvent | null {
  if (typeof data !== 'string' || data.length > 200_000) {
    return null
  }
  let raw: Raw
  try {
    const parsed: unknown = JSON.parse(data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    raw = parsed as Raw
  } catch {
    return null
  }
  switch (raw.type) {
    case LIVE_EVENT.started:
      return { type: 'started', expiresAtMs: expiresAtMs(raw) }
    case LIVE_EVENT.paused:
      return { type: 'paused' }
    case LIVE_EVENT.resumed:
      return { type: 'resumed' }
    case LIVE_EVENT.closed:
      return {
        type: 'closed',
        reason: text(raw.reason) || text(nested(raw, 'session', 'reason')) || 'unknown'
      }
    case LIVE_EVENT.inputDelta:
      return { type: 'input', delta: text(raw.delta) }
    case LIVE_EVENT.outputDelta:
      return { type: 'output', delta: text(raw.delta) }
    case LIVE_EVENT.delegation: {
      const id =
        text(raw.delegation_id) || text(nested(raw, 'delegation', 'id')) || text(raw.id) || null
      return { type: 'delegation', id }
    }
    case LIVE_EVENT.error:
      return {
        type: 'error',
        message: text(nested(raw, 'error', 'message')) || text(raw.message) || 'unknown error'
      }
    default:
      return { type: 'other' }
  }
}

/** "Say this" for the voice model, tied to the delegation it answers when known. */
export function commentaryEvent(say: string, delegationId: string | null): string {
  return JSON.stringify({
    type: LIVE_EVENT.commentary,
    // Why `content`: the Live API reference names the text field `content`;
    // the earlier `text` was silently ignored, so answers were never spoken.
    content: say.slice(0, LIVE_COMMENTARY_MAX_CHARS),
    ...(delegationId ? { delegation_id: delegationId } : {})
  })
}

export function muteEvent(muted: boolean): string {
  return JSON.stringify({ type: muted ? LIVE_EVENT.mute : LIVE_EVENT.unmute })
}
