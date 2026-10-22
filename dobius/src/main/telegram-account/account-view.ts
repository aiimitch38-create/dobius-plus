import type { TelegramAccountSnapshot, TelegramSafeError } from '../../shared/telegram-account'
import type { TelegramManualReviewReceipt } from '../../shared/telegram-account-api'
import type { TelegramVaultState, TelegramConsentReader } from './types'
import { hasCurrentConsent } from './consent-policy'
type SnapshotInput = {
  state: TelegramVaultState
  phase: TelegramAccountSnapshot['phase']
  paused: boolean
  lastError: TelegramSafeError | null
  revision: number
}
export function telegramAccountSnapshot(input: SnapshotInput): TelegramAccountSnapshot {
  return {
    phase: input.phase,
    connected: input.phase === 'connected' && !input.paused,
    paused: input.paused,
    canResume: Boolean(input.state.session && input.state.account),
    selectedGroups: input.state.groups.map((group) => ({ ...group })),
    drafts: input.state.drafts.map((draft) => ({
      id: draft.id,
      revision: draft.revision,
      groupId: draft.groupId,
      groupTitle: draft.groupTitle,
      body: draft.body,
      state: draft.state,
      createdAt: draft.createdAt
    })),
    lastError: input.lastError,
    revision: input.revision
  }
}

export function telegramManualReview(state: TelegramVaultState): TelegramManualReviewReceipt[] {
  return state.inboundEvents
    .filter((event) => event.state === 'manual-review' && event.accountId === state.account?.userId)
    .map((event) => ({
      groupId: event.groupId,
      groupTitle:
        state.groups.find((group) => group.id === event.groupId)?.title ??
        'Previously selected group',
      messageId: event.messageId,
      admittedAt: event.admittedAt
    }))
}

export function telegramDraftConsent(
  state: TelegramVaultState,
  readConsent: TelegramConsentReader | null,
  id: string,
  revision: number
): boolean {
  const draft = state.drafts.find((value) => value.id === id && value.revision === revision)
  return Boolean(
    draft && hasCurrentConsent(readConsent, draft.groupId, draft.senderId, draft.consentRevision)
  )
}
