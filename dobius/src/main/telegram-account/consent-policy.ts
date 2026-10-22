import type { ChatConsentProof, TelegramVaultState } from './types'

export function currentConsent(
  reader: ((groupId: string, senderId: string) => ChatConsentProof) | null,
  groupId: string,
  senderId: string
): ChatConsentProof | null {
  try {
    const proof = reader?.(groupId, senderId)
    return proof?.allowed === true && validConsentRevision(proof.revision) ? proof : null
  } catch {
    return null
  }
}

export function hasCurrentConsent(
  reader: ((groupId: string, senderId: string) => ChatConsentProof) | null,
  groupId: string,
  senderId: string,
  revision: string
): boolean {
  return currentConsent(reader, groupId, senderId)?.revision === revision
}

export function hasDuplicateDraft(
  state: TelegramVaultState,
  groupId: string,
  messageId: string
): boolean {
  return state.drafts.some(
    (draft) => draft.groupId === groupId && draft.sourceMessageId === messageId
  )
}

function validConsentRevision(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}
