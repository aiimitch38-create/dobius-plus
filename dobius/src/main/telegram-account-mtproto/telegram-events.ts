import { Api } from 'teleproto/tl'
import type { TelegramIncomingText } from '../telegram-account/types'
import { MAX_TEXT_BYTES, peerKind, validPeerId } from './telegram-peer'
import { telegramListenerDiagnostic } from './listener-diagnostics'
import { readRecentContext } from './telegram-recent-context'

function dropped(reason: string, detail: Record<string, string | null> = {}): null {
  telegramListenerDiagnostic('event-dropped', { reason, ...detail })
  return null
}

type IncomingMessage = {
  out?: boolean
  media?: unknown
  message?: unknown
  id?: unknown
  senderId?: unknown
  peerId?: unknown
  client?: unknown
  getChat: () => Promise<unknown>
}

export async function readIncomingText(
  message: IncomingMessage,
  getPeerId: (entity: unknown, addMark: boolean) => Promise<string>
): Promise<TelegramIncomingText | null> {
  if (
    message.out ||
    // A link preview is attached as media, but the message is still plain text.
    (message.media && !(message.media instanceof Api.MessageMediaWebPage)) ||
    typeof message.message !== 'string' ||
    !message.message.trim()
  ) {
    return dropped(message.out ? 'own-message' : 'not-text')
  }
  if (Buffer.byteLength(message.message, 'utf8') > MAX_TEXT_BYTES) {
    return dropped('too-long')
  }
  if (!Number.isSafeInteger(message.id)) {
    return dropped('bad-message-id')
  }
  const senderInput = peerIdString(message.senderId)
  if (!senderInput) {
    return dropped('no-sender')
  }
  const chat = await message.getChat()
  const groupKind = peerKind(chat)
  if (groupKind !== 'group' && groupKind !== 'supergroup') {
    return dropped('not-a-group', { chatKind: chat ? String(groupKind) : 'chat-unavailable' })
  }
  const [groupId, senderId] = await Promise.all([
    getPeerId(chat, true),
    getPeerId(senderInput, true)
  ])
  if (!validPeerId(groupId) || !groupId.startsWith('-') || !validPeerId(senderId)) {
    return dropped('bad-peer-id', { groupId, senderId })
  }
  return {
    groupId,
    groupKind,
    senderId,
    messageId: String(message.id),
    text: message.message,
    context: await readRecentContext(message.client, chat, message.id as number)
  }
}

function peerIdString(value: unknown): string | null {
  try {
    if (typeof value === 'string') {
      return validPeerId(value) ? value : null
    }
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const toString = (value as { toString?: unknown }).toString
    if (typeof toString !== 'function') {
      return null
    }
    const result = toString.call(value)
    return validPeerId(result) ? result : null
  } catch {
    return null
  }
}

export function isPlainMessage(value: unknown): value is Api.Message {
  return value instanceof Api.Message
}
