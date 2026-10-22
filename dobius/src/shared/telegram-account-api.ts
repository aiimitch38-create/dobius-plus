import type {
  TelegramAccountSnapshot,
  TelegramApproveDraftInput,
  TelegramAuditEntry,
  TelegramGroupSummary,
  TelegramSendDraftInput
} from './telegram-account'

export type TelegramAccountView = {
  account: TelegramAccountSnapshot
  groups: TelegramGroupSummary[]
  audit: TelegramAuditEntry[]
  consents?: TelegramParticipantConsent[]
  replyHandling?: TelegramReplyHandling
  manualReview?: TelegramManualReviewReceipt[]
}

/** One page of a selected group's history, oldest first; page back with `oldestMessageId`. */
export type TelegramHistoryPage = {
  groupTitle: string
  text: string
  count: number
  oldestMessageId: number | null
}

export type TelegramTerminalSendResult = {
  draftId: string
  outcome: 'sent' | 'unknown' | 'declined'
}

export type TelegramManualReviewReceipt = {
  groupId: string
  groupTitle: string
  messageId: string
  admittedAt: number
}

export type TelegramParticipantSummary = {
  groupId: string
  senderId: string
  displayName: string
}

export type TelegramParticipantConsent = TelegramParticipantSummary & {
  evidence: string
  grantedAt: number
  expiresAt: number
  revision: string
}

export type TelegramGrantConsentInput = {
  groupId: string
  senderId: string
  evidence: string
  expiresAt: number
}

export type TelegramReplyHandling = {
  bridge: 'unavailable' | 'starting' | 'ready' | 'error'
  listening: boolean
  policy: 'approval-required'
}

/** Credentials are transient input to the desktop main process, never settings data. */
export type TelegramBeginSignInInput = {
  phoneNumber: string
  apiId?: number
  apiHash?: string
}

export type TelegramAccountApi = {
  getSnapshot(): Promise<TelegramAccountView>
  beginSignIn(input: TelegramBeginSignInInput): Promise<void>
  submitCode(input: { code: string }): Promise<void>
  submitPassword(input: { password: string }): Promise<void>
  cancelSignIn(): Promise<void>
  refreshGroups(): Promise<TelegramGroupSummary[]>
  saveGroups(input: { groupIds: string[] }): Promise<void>
  getParticipants(input: { groupId: string }): Promise<TelegramParticipantSummary[]>
  grantConsent(input: TelegramGrantConsentInput): Promise<void>
  revokeConsent(input: { groupId: string; senderId: string }): Promise<void>
  startReplies(): Promise<void>
  stopReplies(): Promise<void>
  approveDraft(input: TelegramApproveDraftInput): Promise<void>
  sendDraft(input: TelegramSendDraftInput): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  disconnect(): Promise<void>
  revoke(): Promise<void>
}
