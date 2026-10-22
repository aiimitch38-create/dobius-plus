import { readSelectedGroupHistory } from './selected-group-history'
import { telegramAccountSnapshot, telegramManualReview, telegramDraftConsent } from './account-view'
import type {
  TelegramAccountResult,
  TelegramAccountSnapshot,
  TelegramAuditEntry,
  TelegramAuditCode,
  TelegramSafeError,
  TelegramGroupSummary
} from '../../shared/telegram-account'
import { TelegramAuthorizationFlow } from './authorization'
import { TelegramConnectionController } from './connection'
import type {
  TelegramHistoryPage,
  TelegramParticipantSummary,
  TelegramManualReviewReceipt
} from '../../shared/telegram-account-api'
import { bounded } from './connection-operation'
import { TelegramReplyCoordinator } from './replies'
import type {
  PersonalTelegramClient,
  TelegramVaultState,
  TelegramAccountServiceOptions
} from './types'

const AUDIT_LIMIT = 100

/** Main-process-only personal-account controller. It is not the Hermes Bot API hook. */
export class TelegramAccountService {
  private readonly enabled: boolean
  private readonly now: () => number
  private phase: TelegramAccountSnapshot['phase'] = 'disconnected'
  private lastError: TelegramSafeError | null = null
  private revision = 0
  private epoch = 0
  private selectionEpoch = 0n
  private paused = false
  private authOperations = 0
  private state: TelegramVaultState = {
    schemaVersion: 2,
    account: null,
    session: null,
    groups: [],
    drafts: [],
    outbox: [],
    inboundEvents: []
  }
  private client: PersonalTelegramClient | null = null
  private controller: AbortController | null = null
  private readonly audit: TelegramAuditEntry[] = []
  private readonly replies: TelegramReplyCoordinator
  private readonly authorization: TelegramAuthorizationFlow
  private readonly connection: TelegramConnectionController

  constructor(private readonly options: TelegramAccountServiceOptions) {
    this.enabled = options.enabled === true
    this.now = options.now ?? Date.now
    if (!this.enabled || !options.createClient) {
      this.phase = 'unavailable'
    }
    this.authorization = new TelegramAuthorizationFlow({
      vault: options.vault,
      createClient: options.createClient,
      enabled: this.enabled,
      beginOperation: () => this.beginOperation(),
      isCurrent: (generation) => this.isCurrent(generation),
      getGeneration: () => this.epoch,
      getPhase: () => this.phase,
      signal: () => this.signal(),
      getClient: () => this.client,
      setClient: (client) => {
        this.client = client
      },
      getState: () => this.state,
      setState: (state) => {
        this.state = state
      },
      setPhase: (phase) => {
        this.phase = phase
      },
      setPaused: (paused) => {
        this.paused = paused
      },
      now: this.now,
      bump: () => this.bump(),
      record: (code) => this.record(code),
      refuse: (error) => this.refuse(error),
      fail: (error) => this.fail(error)
    })
    this.replies = new TelegramReplyCoordinator({
      vault: options.vault,
      readState: () => this.state,
      writeState: (state) => {
        this.state = state
      },
      getClient: () => this.client,
      getGeneration: () => this.epoch,
      getSelectionRevision: () => this.selectionEpoch,
      isCurrent: (generation) => this.isCurrent(generation),
      signal: () => this.signal(),
      cancelOperation: () => this.controller?.abort(),
      readConsent: options.readConsent,
      replyToAdam: options.replyToAdam,
      now: this.now,
      record: (code) => this.record(code),
      bump: () => this.bump()
    })
    this.connection = new TelegramConnectionController({
      enabled: this.enabled,
      createClient: options.createClient,
      vault: options.vault,
      replies: this.replies,
      usable: () => this.usable(),
      isCurrent: (generation) => this.isCurrent(generation),
      isGenerationCurrent: (generation) => generation === this.epoch,
      getGeneration: () => this.epoch,
      beginOperation: () => this.beginOperation(),
      signal: () => this.signal(),
      getPhase: () => this.phase,
      setPhase: (phase) => {
        this.phase = phase
      },
      setPaused: (paused) => {
        this.paused = paused
      },
      getState: () => this.state,
      setState: (state) => {
        this.state = state
      },
      getClient: () => this.client,
      setClient: (client) => {
        this.client = client
      },
      cancelAuthorization: () => this.authorization.cancel(),
      authPending: () => this.authOperations > 0,
      bump: () => this.bump(),
      selectionChanged: () => {
        this.selectionEpoch += 1n
      },
      record: (code) => this.record(code),
      refuse: <T = undefined>(error: TelegramSafeError) => this.refuse<T>(error),
      fail: <T = undefined>(error: TelegramSafeError) => this.fail<T>(error)
    })
  }

  snapshot(): TelegramAccountSnapshot {
    return telegramAccountSnapshot({
      state: this.state,
      phase: this.phase,
      paused: this.paused,
      lastError: this.lastError,
      revision: this.revision
    })
  }

  auditSnapshot(): TelegramAuditEntry[] {
    return this.audit.map((entry) => ({ ...entry }))
  }

  getAccountId(): string | null {
    return this.state.account?.userId ?? null
  }

  getManualReview(): TelegramManualReviewReceipt[] {
    return telegramManualReview(this.state)
  }

  isListening(): boolean {
    return this.replies.isListening()
  }

  stopReplies(): Promise<void> {
    return this.replies.stop()
  }

  canApproveDraft(id: string, revision: number): boolean {
    return telegramDraftConsent(this.state, this.options.readConsent, id, revision)
  }

  beginSignIn(phone: unknown): Promise<TelegramAccountResult> {
    return this.trackAuth(this.authorization.begin(phone))
  }

  submitCode(code: unknown): Promise<TelegramAccountResult> {
    return this.trackAuth(this.authorization.submitCode(code))
  }

  submitPassword(password: unknown): Promise<TelegramAccountResult> {
    return this.trackAuth(this.authorization.submitPassword(password))
  }

  async cancelSignIn(): Promise<void> {
    await this.connection.cancelSignIn()
  }

  listGroups(): Promise<TelegramAccountResult<TelegramGroupSummary[]>> {
    return this.connection.listGroups()
  }

  async listParticipants(groupId: string): Promise<TelegramParticipantSummary[]> {
    if (
      !this.usable() ||
      !this.state.groups.some((group) => group.id === groupId) ||
      !this.client?.listParticipants
    ) {
      throw new Error('group-selection-required')
    }
    const generation = this.epoch
    const participants = await bounded(
      this.client.listParticipants(groupId, this.signal()),
      this.signal()
    )
    if (!this.isCurrent(generation) || !this.state.groups.some((group) => group.id === groupId)) {
      throw new Error('stale-operation')
    }
    return participants
  }

  readHistory(group: string, beforeId: number, limit: number): Promise<TelegramHistoryPage> {
    const request = { group, beforeId, limit, signal: this.signal() }
    return readSelectedGroupHistory(this.state.groups, this.usable() ? this.client : null, request)
  }

  resume(): Promise<TelegramAccountResult> {
    return this.connection.resume()
  }

  revoke(): Promise<TelegramAccountResult> {
    return this.connection.revoke()
  }

  revokeFromPaused(): Promise<TelegramAccountResult> {
    return this.connection.revokeFromPaused()
  }

  restore(): Promise<TelegramAccountResult> {
    return this.connection.restore()
  }

  selectGroups(ids: unknown): Promise<TelegramAccountResult> {
    return this.connection.selectGroups(ids)
  }

  startReplies(): Promise<TelegramAccountResult> {
    if (!this.usable()) {
      return Promise.resolve(this.refuse('client-unavailable'))
    }
    return this.replies.start(this.epoch)
  }

  approveDraft(id: unknown, expectedRevision: unknown): TelegramAccountResult {
    if (!this.usable()) {
      return this.refuse('client-unavailable')
    }
    return this.replies.approveDraft(id, expectedRevision)
  }

  sendDraft(
    id: unknown,
    expectedRevision: unknown
  ): Promise<TelegramAccountResult<'sent' | 'unknown'>> {
    return this.replies.sendDraft(id, expectedRevision, this.usable())
  }

  async pause(): Promise<void> {
    await this.connection.pause()
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect()
  }

  private beginOperation(): number {
    this.epoch += 1
    this.controller?.abort()
    this.controller = new AbortController()
    this.lastError = null
    this.bump()
    return this.epoch
  }

  private async trackAuth<T>(operation: Promise<T>): Promise<T> {
    this.authOperations += 1
    try {
      return await operation
    } finally {
      this.authOperations = Math.max(0, this.authOperations - 1)
    }
  }

  private signal(): AbortSignal {
    if (!this.controller || this.controller.signal.aborted) {
      this.controller = new AbortController()
    }
    return this.controller.signal
  }

  private isCurrent(generation: number): boolean {
    return generation === this.epoch && !this.paused
  }

  private usable(): boolean {
    return (
      this.enabled &&
      this.options.createClient !== null &&
      this.options.vault.isSecureStorageAvailable() &&
      this.phase === 'connected' &&
      !this.paused
    )
  }

  private refuse<T = undefined>(error: TelegramSafeError): TelegramAccountResult<T> {
    this.record('operation-refused')
    return { ok: false, error }
  }

  private fail<T = undefined>(error: TelegramSafeError): TelegramAccountResult<T> {
    this.lastError = error
    this.phase = 'error'
    this.record('operation-refused')
    this.bump()
    return { ok: false, error }
  }

  private record(code: TelegramAuditCode): void {
    this.audit.push({ at: this.now(), code })
    if (this.audit.length > AUDIT_LIMIT) {
      this.audit.splice(0, this.audit.length - AUDIT_LIMIT)
    }
  }

  private bump(): void {
    this.revision = this.revision >= Number.MAX_SAFE_INTEGER ? 1 : this.revision + 1
  }
}
