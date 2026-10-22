import type { TelegramAccountApi } from '../../shared/telegram-account-api'
import type { TelegramAccountService } from '../telegram-account/service'
import type { TelegramConsentAuthority } from '../telegram-account/consent-authority'

export function createDesktopTelegramConsentControls(
  service: TelegramAccountService,
  authority: TelegramConsentAuthority,
  boundAccountId: () => string | null = () => service.getAccountId()
): Pick<TelegramAccountApi, 'getParticipants' | 'grantConsent' | 'revokeConsent'> {
  // Only in-progress mutations need tokens. Completed revokes still supersede old grants.
  const mutations = new Map<string, symbol>()
  const accountId = (requireConnected = false): string => {
    const id = boundAccountId()
    if (!id || (requireConnected && !service.snapshot().connected)) {
      throw new Error('client-unavailable')
    }
    return id
  }
  const beginMutation = (id: string, groupId: string, senderId: string) => {
    const key = JSON.stringify([id, groupId, senderId])
    const token = Symbol()
    mutations.set(key, token)
    return {
      assertCurrent() {
        if (mutations.get(key) !== token) {
          throw new Error('stale-operation')
        }
      },
      finish() {
        if (mutations.get(key) === token) {
          mutations.delete(key)
        }
      }
    }
  }
  return {
    getParticipants: ({ groupId }) => service.listParticipants(groupId),
    async grantConsent(input) {
      const id = accountId(true)
      const mutation = beginMutation(id, input.groupId, input.senderId)
      try {
        const participants = await service.listParticipants(input.groupId)
        mutation.assertCurrent()
        const participant = participants.find(
          (value) => value.groupId === input.groupId && value.senderId === input.senderId
        )
        if (accountId(true) !== id || !participant) {
          throw new Error('invalid-input')
        }
        authority.grant({ ...input, accountId: id, displayName: participant.displayName })
      } finally {
        mutation.finish()
      }
    },
    async revokeConsent(input) {
      const id = accountId()
      const mutation = beginMutation(id, input.groupId, input.senderId)
      try {
        // Stop before writing: a failed durable withdrawal must not leave inference running.
        await service.stopReplies()
        mutation.assertCurrent()
        if (accountId() !== id) {
          throw new Error('stale-operation')
        }
        authority.revoke({ ...input, accountId: id })
      } finally {
        mutation.finish()
      }
    }
  }
}
