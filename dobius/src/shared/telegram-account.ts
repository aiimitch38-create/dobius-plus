/** Public, secret-free Telegram personal-account contract for future IPC/UI composition. */
export const TELEGRAM_ASSIGNED_AGENT = 'adam' as const
export const TELEGRAM_REQUIRED_GROUP_COUNT = 3
export const TELEGRAM_MAX_TEXT_LENGTH = 4096

export type TelegramAccountPhase =
  | 'unavailable'
  | 'disconnected'
  | 'awaiting-code'
  | 'awaiting-password'
  | 'connected'
  | 'paused'
  | 'error'

export const TELEGRAM_SAFE_ERRORS = [
  'client-unavailable',
  'secure-storage-unavailable',
  'invalid-input',
  'authorization-failed',
  'account-mismatch',
  'group-selection-required',
  'consent-required',
  'stale-operation',
  'draft-stale',
  'delivery-unknown',
  'delivery-failed',
  'storage-failed'
] as const

export type TelegramSafeError = (typeof TELEGRAM_SAFE_ERRORS)[number]

export type TelegramGroupKind = 'group' | 'supergroup'

export type TelegramGroupSummary = {
  /** Canonical identifier returned and verified by the main-owned client adapter. */
  id: string
  title: string
  kind: TelegramGroupKind
}

export type TelegramDraftState = 'awaiting-approval' | 'approved' | 'sending' | 'sent' | 'unknown'

export type TelegramReplyDraft = {
  id: string
  revision: number
  groupId: string
  groupTitle: string
  body: string
  state: TelegramDraftState
  createdAt: number
  /** Main verifies the current source participant consent; missing means disabled. */
  consentAllowed?: boolean
}

export type TelegramAuditCode =
  | 'connected'
  | 'disconnected'
  | 'paused'
  | 'groups-updated'
  | 'message-filtered'
  | 'draft-created'
  | 'draft-approved'
  | 'send-started'
  | 'send-confirmed'
  | 'send-unknown'
  | 'operation-refused'

/** Audits carry no phone, chat, sender, message text, session, OTP, or exception data. */
export type TelegramAuditEntry = {
  at: number
  code: TelegramAuditCode
}

export type TelegramAccountSnapshot = {
  phase: TelegramAccountPhase
  connected: boolean
  paused: boolean
  /** A bound account and encrypted session exist; retry does not require a new sign-in. */
  canResume?: boolean
  selectedGroups: TelegramGroupSummary[]
  drafts: TelegramReplyDraft[]
  lastError: TelegramSafeError | null
  /** Monotonic process-local epoch; invalidates stale UI approvals/callbacks. */
  revision: number
}

export type TelegramAccountResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: TelegramSafeError }

/** Transient authentication input. Implementations must never persist or return these values. */
export type TelegramAuthorizationInput =
  | { kind: 'phone'; phoneNumber: string }
  | { kind: 'code'; code: string }
  | { kind: 'password'; password: string }

export type TelegramSelectGroupsInput = { groupIds: string[] }

export type TelegramApproveDraftInput = { draftId: string; expectedRevision: number }

export type TelegramSendDraftInput = { draftId: string; expectedRevision: number }
