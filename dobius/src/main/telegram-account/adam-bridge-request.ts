import { createHash } from 'node:crypto'
import type { AdamTelegramReplyRequest } from './types'

export function createAdamBridgeRequest(accountId: string, request: AdamTelegramReplyRequest) {
  const id = `tg_${createHash('sha256')
    .update(
      JSON.stringify([
        accountId,
        request.group.id,
        request.senderId,
        request.messageId,
        createHash('sha256').update(request.text).digest('hex')
      ])
    )
    .digest('hex')}`
  return {
    v: 1,
    type: 'request',
    id,
    groupId: request.group.id,
    senderId: request.senderId,
    messageId: request.messageId,
    groupTitle: request.group.title,
    text: request.context
      ? `Recent messages, oldest first:\n${request.context}\n\nNewest message to reply to:\n${request.text}`
      : request.text
  }
}
