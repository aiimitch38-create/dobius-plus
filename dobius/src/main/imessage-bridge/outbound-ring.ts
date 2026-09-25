// Every text Dobius sends over iMessage, newest last. Why: the conductor's
// approval reader and the `d:`/@mention bridge both read the self-chat, so a
// row Dobius wrote itself (a conductor question, an agent's channel reply)
// must never count as Carson speaking to either of them.

export type OutboundRecord = { text: string; sentAt: number }

const RING_SIZE = 500

/** Fixed tag on every Voice Conductor text; never agent-controlled. */
export const CONDUCTOR_OUTBOUND_TAG = '[Dobius conductor] '

let ring: OutboundRecord[] = []

function normalize(text: string): string {
  return text.trim()
}

/** Record a text as sent by Dobius. Call before the send so the echo row can't race it. */
export function recordOutbound(text: string, sentAt = Date.now()): void {
  ring.push({ text: normalize(text), sentAt })
  if (ring.length > RING_SIZE) {
    ring = ring.slice(-RING_SIZE)
  }
}

/** True when `text` is exactly something Dobius sent. */
export function wasSentByDobius(text: string): boolean {
  const wanted = normalize(text)
  return ring.some((record) => record.text === wanted)
}

/** Texts Dobius sent at or after `since` (ms). */
export function outboundSince(since: number): OutboundRecord[] {
  return ring.filter((record) => record.sentAt >= since)
}

/** True for rows the inbound command bridge must never act on. */
export function isDobiusAuthoredRow(text: string): boolean {
  return normalize(text).startsWith(CONDUCTOR_OUTBOUND_TAG.trim()) || wasSentByDobius(text)
}
