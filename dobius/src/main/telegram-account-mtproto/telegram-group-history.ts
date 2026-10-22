import type { TelegramHistoryPage } from '../../shared/telegram-account-api'
import { TelegramAdapterError } from './telegram-errors'
import { isHistoryClient, senderLabel } from './telegram-recent-context'

export const MAX_HISTORY_PAGE = 200

/** One page of full group history before `beforeId` (0 = newest), with ids and dates so a reader can page back. */
export async function readGroupHistory(
  client: unknown,
  chat: unknown,
  beforeId: number,
  limit: number
): Promise<Omit<TelegramHistoryPage, 'groupTitle'>> {
  if (!isHistoryClient(client)) {
    throw new TelegramAdapterError()
  }
  const messages = await client.getMessages(chat, {
    limit: Math.min(Math.max(1, limit), MAX_HISTORY_PAGE),
    maxId: beforeId
  })
  const lines = messages.toReversed().flatMap((item) => {
    if (typeof item.message !== 'string' || !item.message.trim()) {
      return []
    }
    const when =
      typeof item.date === 'number' ? new Date(item.date * 1000).toISOString().slice(0, 16) : '?'
    return [`#${String(item.id)} ${when} ${senderLabel(item)}: ${item.message.trim()}`]
  })
  const oldest = messages.at(-1)?.id
  return {
    text: lines.join('\n'),
    count: messages.length,
    oldestMessageId: typeof oldest === 'number' ? oldest : null
  }
}
