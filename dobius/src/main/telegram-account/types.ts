import type { TelegramGroupKind, TelegramGroupSummary } from '../../shared/telegram-account'
import type {
  TelegramHistoryPage,
  TelegramParticipantSummary
} from '../../shared/telegram-account-api'

export type VerifiedTelegramDialog = {
  id: string
  title: string
  kind: TelegramGroupKind | 'user' | 'channel'
}

export type TelegramAccountIdentity = { userId: string }

export type TelegramAuthOutcome =
  | { kind: 'password-required' }
  | { kind: 'authorized'; identity: TelegramAccountIdentity; session: string }

export type TelegramIncomingText = {
  groupId: string
  groupKind: VerifiedTelegramDialog['kind']
  senderId: string
  messageId: string
  text: string
  /** Up to 20 earlier text messages from the group, oldest first. */
  context?: string
}

export type TelegramDeliveryOutcome = 'confirmed' | 'unknown' | 'not-sent'

/** Adapter API for a real MTProto client. No bot token or Bot API calls are accepted here. */
export type PersonalTelegramClient = {
  requestCode(phoneNumber: string, signal: AbortSignal): Promise<{ codeHandle: string }>
  submitCode(codeHandle: string, code: string, signal: AbortSignal): Promise<TelegramAuthOutcome>
  submitPassword(password: string, signal: AbortSignal): Promise<TelegramAuthOutcome>
  connect(session: string, signal: AbortSignal): Promise<TelegramAccountIdentity>
  listDialogs(signal: AbortSignal): Promise<VerifiedTelegramDialog[]>
  listParticipants?(groupId: string, signal: AbortSignal): Promise<TelegramParticipantSummary[]>
  readHistory?(
    groupId: string,
    beforeId: number,
    limit: number,
    signal: AbortSignal
  ): Promise<Omit<TelegramHistoryPage, 'groupTitle'>>
  subscribe(onMessage: (message: TelegramIncomingText) => void): Promise<() => Promise<void>>
  sendText(args: {
    groupId: string
    text: string
    randomId: string
    signal: AbortSignal
    canSend: () => boolean
  }): Promise<TelegramDeliveryOutcome>
  lookupRandomId(randomId: string, signal: AbortSignal): Promise<TelegramDeliveryOutcome>
  /** Optional until the production Teleproto adapter maps this to logOut(). */
  revokeAuthorization?(): Promise<boolean>
  disconnect(): Promise<void>
}

export type PersonalTelegramClientFactory = (session: string | null) => PersonalTelegramClient

export type ChatConsentProof = {
  allowed: boolean
  revision: string
}

/** Main-owned consent authority. Renderer-supplied booleans are never accepted as proof. */
export type TelegramConsentReader = (groupId: string, senderId: string) => ChatConsentProof

export type AdamTelegramReplyRequest = {
  agentId: 'adam'
  group: TelegramGroupSummary
  senderId: string
  messageId: string
  text: string
  context?: string
  signal: AbortSignal
}

/** Typed reply boundary; production composition must route through approved Adam APIs, never PTY text. */
export type AdamTelegramReplyPort = (request: AdamTelegramReplyRequest) => Promise<string>

export type TelegramOutboxEntry = {
  key: string
  draftId: string
  groupId: string
  body: string
  randomId: string
  state: 'prepared' | 'unknown' | 'sent'
}

export type TelegramVaultState = {
  schemaVersion: 2
  account: TelegramAccountIdentity | null
  session: string | null
  groups: TelegramGroupSummary[]
  drafts: {
    id: string
    revision: number
    groupId: string
    groupTitle: string
    senderId: string
    sourceMessageId: string
    consentRevision: string
    body: string
    state: 'awaiting-approval' | 'approved' | 'sending' | 'sent' | 'unknown'
    createdAt: number
  }[]
  outbox: TelegramOutboxEntry[]
  /** Private encrypted update admission ledger; independent from the bounded draft window. */
  inboundEvents: TelegramInboundEventReceipt[]
}

export type TelegramInboundEventReceipt = {
  accountId: string
  groupId: string
  messageId: string
  admittedAt: number
  state: 'processing' | 'manual-review' | 'draft-created'
}

export const TELEGRAM_INBOUND_EVENT_LIMIT = 10_000

export type TelegramVaultPort = {
  isSecureStorageAvailable(): boolean
  load(): TelegramVaultState
  save(state: TelegramVaultState): void
}

export function emptyTelegramVaultState(): TelegramVaultState {
  return {
    schemaVersion: 2,
    account: null,
    session: null,
    groups: [],
    drafts: [],
    outbox: [],
    inboundEvents: []
  }
}

export type TelegramAccountServiceOptions = {
  vault: TelegramVaultPort
  createClient: PersonalTelegramClientFactory | null
  replyToAdam: AdamTelegramReplyPort | null
  readConsent: ((groupId: string, senderId: string) => ChatConsentProof) | null
  enabled?: boolean
  now?: () => number
}
