// Native port of useTypingBroadcast.ts's send side only. The original sends
// over an already-open WebSocket the app keeps for live subscriptions; this
// tab has no live WS connection, so it sends the same ephemeral kind:20002
// event over the relay's HTTP /events endpoint instead (fire-and-forget,
// same as upstream — no ack is awaited).
//
// ponytail: receive-side rendering of *other* participants' typing indicators
// is cut for this pass — it needs either a live WS subscription or continuous
// polling, and DM threads here are 1:1 with an agent that doesn't watch for
// typing anyway. Add it if/when a live subscription exists for other reasons.
import { publishAsSelf } from './relay-client'

const TYPING_KIND = 20002
const SEND_INTERVAL_MS = 3_000

let lastChannelId: string | null = null
let lastSentAt = 0

export function notifyTyping(channelId: string): void {
  if (lastChannelId !== channelId) {
    lastChannelId = channelId
    lastSentAt = 0
  }
  const now = Date.now()
  if (now - lastSentAt < SEND_INTERVAL_MS) {return}
  lastSentAt = now

  void publishAsSelf({ kind: TYPING_KIND, content: '', tags: [['h', channelId]] }).catch(() => undefined)
}
