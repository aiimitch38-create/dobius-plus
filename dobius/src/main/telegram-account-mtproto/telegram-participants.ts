import { Api } from 'teleproto/tl'
import type { TeleprotoClient } from './teleproto-runtime'
import type { TelegramParticipantSummary } from '../../shared/telegram-account-api'
import { TelegramAdapterError } from './telegram-errors'

export async function readTelegramParticipants(
  client: TeleprotoClient,
  groupId: string,
  assertCurrent: () => void
): Promise<TelegramParticipantSummary[]> {
  const entity = await client.getEntity(groupId)
  if (!(entity instanceof Api.Chat) && !(entity instanceof Api.Channel && entity.megagroup)) {
    throw new TelegramAdapterError()
  }
  const participants = await client.getParticipants(entity, { limit: 200 })
  assertCurrent()
  return participants.flatMap((participant) => {
    const senderId = String(participant.id)
    if (
      !(participant instanceof Api.User) ||
      participant.bot ||
      participant.deleted ||
      !/^[1-9]\d{0,19}$/.test(senderId)
    ) {
      return []
    }
    const displayName =
      [participant.firstName, participant.lastName].filter(Boolean).join(' ').trim() ||
      participant.username ||
      'Telegram participant'
    return [{ groupId, senderId, displayName: displayName.slice(0, 200) }]
  })
}
