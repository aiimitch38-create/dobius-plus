import type { TelegramGroupSummary } from '../../shared/telegram-account'
import type { TelegramHistoryPage } from '../../shared/telegram-account-api'
import { bounded } from './connection-operation'
import type { PersonalTelegramClient } from './types'

/** Terminal Adam names a group by title or id; only the owner's selected groups ever match. */
export async function readSelectedGroupHistory(
  groups: TelegramGroupSummary[],
  client: PersonalTelegramClient | null,
  request: { group: string; beforeId: number; limit: number; signal: AbortSignal }
): Promise<TelegramHistoryPage> {
  const { group: query, beforeId, limit, signal } = request
  const wanted = query.trim().toLowerCase()
  const match = groups.find(
    (group) => group.id === query.trim() || group.title.trim().toLowerCase() === wanted
  )
  if (!match || !client?.readHistory) {
    throw new Error('group-selection-required')
  }
  const page = await bounded(client.readHistory(match.id, beforeId, limit, signal), signal)
  return { groupTitle: match.title, ...page }
}
