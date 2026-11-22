// Pure folding of OLDER turns in the native chat (ported from Line A #24,
// shared/chat-rows.js foldTurns). Everything before the newest message the
// person sent shows only Claude's last reply text plus one "Show N steps"
// toggle per turn; the exchange after the newest sent message stays fully open.
// Kept out of the .tsx so the boundary rules are unit-testable.

import {
  isTextBlock,
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatMessage
} from '../../../../shared/native-chat-types'
import { isPendingMessageId } from './native-chat-pending'

export type NativeChatFoldSegment =
  | { kind: 'message'; message: NativeChatMessage }
  | {
      kind: 'turn'
      /** Stable identity: the id of the sent message right AFTER the turn. The
       *  turn's own first row changes as the read window slides; this does not. */
      key: string
      messages: NativeChatMessage[]
      /** Tool calls plus reasoning rows folded away. */
      steps: number
      /** Claude's last reply text in the turn, or null when it wrote none. */
      summary: string | null
    }

// Why: only a message the person actually sent is a turn boundary. An
// optimistic "queued" echo has not reached the agent yet, so the exchange
// before it may still be running; folding there would hide the live tool run
// (Line A Codex P1). A user-role row carrying tool results is the harness
// answering a tool, not the person. Erring this way only leaves a finished turn
// open longer.
function isSentUserMessage(message: NativeChatMessage): boolean {
  return (
    message.role === 'user' &&
    !isPendingMessageId(message.id) &&
    !message.blocks.some(isToolResultBlock) &&
    message.blocks.some((block) => isTextBlock(block) || block.type === 'image-ref')
  )
}

function lastText(message: NativeChatMessage): string | null {
  let text: string | null = null
  for (const block of message.blocks) {
    if (isTextBlock(block) && block.text.trim().length > 0) {
      text = block.text
    }
  }
  return text
}

/**
 * Split ordered, tool-folded messages into render segments. A turn is every
 * row between two sent messages, before the newest sent message. A turn with
 * no steps is not folded: its rows come back as plain message segments.
 */
export function foldOlderNativeChatTurns(
  messages: readonly NativeChatMessage[]
): NativeChatFoldSegment[] {
  let lastSent = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isSentUserMessage(messages[i]!)) {
      lastSent = i
      break
    }
  }
  const out: NativeChatFoldSegment[] = []
  let i = 0
  while (i < messages.length) {
    const message = messages[i]!
    if (i >= lastSent || isSentUserMessage(message)) {
      out.push({ kind: 'message', message })
      i++
      continue
    }
    const start = i
    let steps = 0
    let summary: string | null = null
    for (; i < lastSent && !isSentUserMessage(messages[i]!); i++) {
      const row = messages[i]!
      if (row.role === 'reasoning') {
        steps++
        continue
      }
      if (row.role !== 'assistant') {
        continue
      }
      steps += row.blocks.filter(isToolCallBlock).length
      summary = lastText(row) ?? summary
    }
    // i now points at the sent message after the turn (lastSent at the latest).
    const turnMessages = messages.slice(start, i)
    if (steps > 0) {
      out.push({ kind: 'turn', key: `turn:${messages[i]!.id}`, messages: turnMessages, steps, summary })
    } else {
      for (const row of turnMessages) {
        out.push({ kind: 'message', message: row })
      }
    }
  }
  return out
}
