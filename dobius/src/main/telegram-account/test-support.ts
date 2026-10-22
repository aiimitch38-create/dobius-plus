import { vi } from 'vitest'
import { TelegramAccountService } from './service'
import type {
  AdamTelegramReplyPort,
  ChatConsentProof,
  PersonalTelegramClient,
  TelegramAccountIdentity,
  TelegramAuthOutcome,
  TelegramDeliveryOutcome,
  TelegramIncomingText,
  TelegramVaultPort,
  TelegramVaultState,
  VerifiedTelegramDialog
} from './types'
import { selectedGroupFromDialog } from './validation'

export const TEST_SESSION = 'fake-session-secret'
export const TEST_CODE = '123456'
export const TEST_PASSWORD = 'fake-2fa-secret'
export const GROUPS: VerifiedTelegramDialog[] = [
  { id: '-1001', title: 'Build', kind: 'supergroup' },
  { id: '-1002', title: 'Design', kind: 'group' },
  { id: '-1003', title: 'Support', kind: 'supergroup' },
  { id: '44', title: 'Direct message', kind: 'user' },
  { id: '-1004', title: 'Broadcast', kind: 'channel' }
]

export function emptyState(): TelegramVaultState {
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

export class MemoryTelegramVault implements TelegramVaultPort {
  state = emptyState()
  available = true
  saves = 0

  isSecureStorageAvailable(): boolean {
    return this.available
  }
  load(): TelegramVaultState {
    return structuredClone(this.state)
  }
  save(state: TelegramVaultState): void {
    if (!this.available) {
      throw new Error('secure storage unavailable')
    }
    this.state = structuredClone(state)
    this.saves += 1
  }
}

export class FakeTelegramClient implements PersonalTelegramClient {
  identity: TelegramAccountIdentity = { userId: '77' }
  authOutcome: TelegramAuthOutcome = {
    kind: 'authorized',
    identity: this.identity,
    session: TEST_SESSION
  }
  dialogs: VerifiedTelegramDialog[] = GROUPS
  sendOutcome: TelegramDeliveryOutcome = 'confirmed'
  lookupOutcome: TelegramDeliveryOutcome = 'not-sent'
  revokeOutcome = true
  sent: { groupId: string; text: string; randomId: string }[] = []
  onMessage: ((message: TelegramIncomingText) => void) | null = null
  disconnected = 0
  requestCode = vi.fn(async () => ({ codeHandle: 'ephemeral-handle' }))
  submitCode = vi.fn(async () => this.authOutcome)
  submitPassword = vi.fn(async () => this.authOutcome)
  connect = vi.fn(async () => this.identity)
  listDialogs = vi.fn(async () => this.dialogs)
  subscribe = vi.fn(async (onMessage: (message: TelegramIncomingText) => void) => {
    this.onMessage = onMessage
    return async () => {
      this.onMessage = null
    }
  })
  sendText = vi.fn(async (args: { groupId: string; text: string; randomId: string }) => {
    this.sent.push(args)
    return this.sendOutcome
  })
  lookupRandomId = vi.fn(async () => this.lookupOutcome)
  revokeAuthorization = vi.fn(async () => this.revokeOutcome)
  disconnect = vi.fn(async () => {
    this.disconnected += 1
  })

  emit(message: TelegramIncomingText): void {
    this.onMessage?.(message)
  }
}

export function consenting(): ChatConsentProof {
  return { allowed: true, revision: 'consent-v1' }
}

export function incoming(overrides: Partial<TelegramIncomingText> = {}): TelegramIncomingText {
  return {
    groupId: '-1001',
    groupKind: 'supergroup',
    senderId: '88',
    messageId: '991',
    text: 'hello',
    ...overrides
  }
}

export function makeConnectedService(
  args: {
    vault?: MemoryTelegramVault
    client?: FakeTelegramClient
    consent?: (groupId: string, senderId: string) => ChatConsentProof
    reply?: AdamTelegramReplyPort
    enabled?: boolean
  } = {}
): { service: TelegramAccountService; vault: MemoryTelegramVault; client: FakeTelegramClient } {
  const vault = args.vault ?? new MemoryTelegramVault()
  const client = args.client ?? new FakeTelegramClient()
  vault.state = {
    schemaVersion: 2,
    account: { userId: client.identity.userId },
    session: TEST_SESSION,
    groups: GROUPS.slice(0, 3).flatMap((dialog) => {
      const group = selectedGroupFromDialog(dialog)
      return group ? [group] : []
    }),
    drafts: [],
    outbox: [],
    inboundEvents: []
  }
  const service = new TelegramAccountService({
    vault,
    createClient: () => client,
    replyToAdam: args.reply ?? vi.fn(async () => 'A proposed reply'),
    readConsent: args.consent ?? (() => consenting()),
    enabled: args.enabled ?? true
  })
  return { service, vault, client }
}
