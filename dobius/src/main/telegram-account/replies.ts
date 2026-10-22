import { boundedTelegramSend as bounded } from './send-operation'
import { randomBytes } from 'node:crypto'
import {
  TELEGRAM_REQUIRED_GROUP_COUNT,
  type TelegramAccountResult,
  type TelegramAuditCode,
  type TelegramSafeError
} from '../../shared/telegram-account'
import type {
  AdamTelegramReplyPort,
  ChatConsentProof,
  PersonalTelegramClient,
  TelegramVaultPort,
  TelegramVaultState
} from './types'
import { hasCurrentConsent } from './consent-policy'
import { findTelegramDraft } from './draft-state'
import { TelegramIncomingMessageProcessor } from './incoming-message'

export type TelegramReplyCoordinatorOptions = {
  vault: TelegramVaultPort
  readState: () => TelegramVaultState
  writeState: (state: TelegramVaultState) => void
  getClient: () => PersonalTelegramClient | null
  getGeneration: () => number
  getSelectionRevision: () => bigint
  isCurrent: (generation: number) => boolean
  signal: () => AbortSignal
  cancelOperation: () => void
  readConsent: ((groupId: string, senderId: string) => ChatConsentProof) | null
  replyToAdam: AdamTelegramReplyPort | null
  now: () => number
  record: (code: TelegramAuditCode) => void
  bump: () => void
}

/** Keeps inbound filtering, explicit human approval, and idempotent outbox separate from auth. */
export class TelegramReplyCoordinator {
  private unsubscribe: (() => Promise<void>) | null = null
  private readonly inFlightSends = new Set<Promise<TelegramAccountResult<'sent' | 'unknown'>>>()
  private readonly incoming: TelegramIncomingMessageProcessor
  private inferenceController = new AbortController()
  private listeningEpoch = 0

  constructor(private readonly options: TelegramReplyCoordinatorOptions) {
    this.incoming = new TelegramIncomingMessageProcessor({
      readState: options.readState,
      writeState: options.writeState,
      vault: options.vault,
      isCurrent: options.isCurrent,
      getSelectionRevision: options.getSelectionRevision,
      signal: () => AbortSignal.any([options.signal(), this.inferenceController.signal]),
      cancelOperation: () => {
        void this.stop()
      },
      readConsent: options.readConsent,
      replyToAdam: options.replyToAdam,
      now: options.now,
      record: options.record
    })
  }

  async start(generation: number): Promise<TelegramAccountResult> {
    const state = this.options.readState()
    const client = this.options.getClient()
    if (!client || state.groups.length !== TELEGRAM_REQUIRED_GROUP_COUNT) {
      return this.refuse('group-selection-required')
    }
    if (!this.options.readConsent || !this.options.replyToAdam) {
      return this.refuse('consent-required')
    }
    if (this.unsubscribe) {
      return { ok: true, value: undefined }
    }
    this.inferenceController = new AbortController()
    const listeningEpoch = ++this.listeningEpoch
    try {
      const unsubscribe = await bounded(
        client.subscribe((message) => {
          if (this.listeningEpoch !== listeningEpoch) {
            return
          }
          void this.incoming
            .handle(message, generation)
            .catch(() => this.options.record('operation-refused'))
        }),
        this.options.signal(),
        this.options.cancelOperation
      )
      if (!this.options.isCurrent(generation) || this.listeningEpoch !== listeningEpoch) {
        await unsubscribe()
        return this.refuse('stale-operation')
      }
      this.unsubscribe = unsubscribe
      return { ok: true, value: undefined }
    } catch {
      return this.refuse('delivery-failed')
    }
  }

  async stop(): Promise<void> {
    this.listeningEpoch += 1
    this.inferenceController.abort()
    const unsubscribe = this.unsubscribe
    this.unsubscribe = null
    if (unsubscribe) {
      await unsubscribe().catch(() => undefined)
    }
  }

  isListening(): boolean {
    return this.unsubscribe !== null
  }

  async drainSends(): Promise<void> {
    await Promise.allSettled(this.inFlightSends)
  }

  approveDraft(id: unknown, expectedRevision: unknown): TelegramAccountResult {
    const draft = findTelegramDraft(
      this.options.readState(),
      id,
      expectedRevision,
      'awaiting-approval'
    )
    if (!draft) {
      return this.refuse('draft-stale')
    }
    if (
      !hasCurrentConsent(
        this.options.readConsent,
        draft.groupId,
        draft.senderId,
        draft.consentRevision
      )
    ) {
      return this.refuse('consent-required')
    }
    draft.state = 'approved'
    draft.revision += 1
    return this.persist('draft-approved')
  }

  sendDraft(
    id: unknown,
    expectedRevision: unknown,
    active: boolean
  ): Promise<TelegramAccountResult<'sent' | 'unknown'>> {
    const operation = this.performSendDraft(id, expectedRevision, active)
    this.inFlightSends.add(operation)
    void operation.then(
      () => this.inFlightSends.delete(operation),
      () => this.inFlightSends.delete(operation)
    )
    return operation
  }

  private async performSendDraft(
    id: unknown,
    expectedRevision: unknown,
    active: boolean
  ): Promise<TelegramAccountResult<'sent' | 'unknown'>> {
    const client = this.options.getClient()
    if (!active || !client) {
      return this.refuse<'sent' | 'unknown'>('client-unavailable')
    }
    const draft = findTelegramDraft(this.options.readState(), id, expectedRevision, [
      'approved',
      'unknown'
    ])
    if (!draft) {
      return this.refuse<'sent' | 'unknown'>('draft-stale')
    }
    if (!this.options.readState().groups.some((group) => group.id === draft.groupId)) {
      return this.refuse<'sent' | 'unknown'>('group-selection-required')
    }
    if (
      !hasCurrentConsent(
        this.options.readConsent,
        draft.groupId,
        draft.senderId,
        draft.consentRevision
      )
    ) {
      return this.refuse<'sent' | 'unknown'>('consent-required')
    }
    const state = this.options.readState()
    const key = `${state.account?.userId}:${draft.groupId}:${draft.id}`
    const existing = state.outbox.find((entry) => entry.key === key)
    const entry = existing ?? {
      key,
      draftId: draft.id,
      groupId: draft.groupId,
      body: draft.body,
      randomId: randomBytes(8).readBigInt64BE().toString(),
      state: 'prepared' as const
    }
    const initialDraftState = draft.state
    draft.state = 'sending'
    draft.revision += 1
    if (!existing) {
      state.outbox.push(entry)
    }
    const persisted = this.persist('send-started')
    if (!persisted.ok) {
      return this.refuse<'sent' | 'unknown'>('storage-failed')
    }
    const generation = this.options.getGeneration()
    try {
      let outcome = existing
        ? await bounded(
            client.lookupRandomId(entry.randomId, this.options.signal()),
            this.options.signal(),
            this.options.cancelOperation
          )
        : 'not-sent'
      if (outcome === 'not-sent') {
        outcome =
          !this.options.isCurrent(generation) ||
          !hasCurrentConsent(
            this.options.readConsent,
            draft.groupId,
            draft.senderId,
            draft.consentRevision
          )
            ? 'unknown'
            : await bounded(
                client.sendText({
                  groupId: draft.groupId,
                  text: entry.body,
                  randomId: entry.randomId,
                  signal: this.options.signal(),
                  canSend: () =>
                    this.options.isCurrent(generation) &&
                    this.options.readState().groups.some((group) => group.id === draft.groupId) &&
                    hasCurrentConsent(
                      this.options.readConsent,
                      draft.groupId,
                      draft.senderId,
                      draft.consentRevision
                    )
                }),
                this.options.signal(),
                this.options.cancelOperation
              )
      }
      if (outcome === 'confirmed') {
        entry.state = 'sent'
        draft.state = 'sent'
        this.options.record('send-confirmed')
      } else if (outcome === 'unknown' || !this.options.isCurrent(generation)) {
        entry.state = 'unknown'
        draft.state = 'unknown'
        this.options.record('send-unknown')
      } else {
        draft.state = initialDraftState
        this.options.record('operation-refused')
      }
      this.options.vault.save(this.options.readState())
      return outcome === 'confirmed'
        ? { ok: true, value: 'sent' }
        : outcome === 'unknown'
          ? { ok: true, value: 'unknown' }
          : this.refuse<'sent' | 'unknown'>('delivery-failed')
    } catch {
      entry.state = 'unknown'
      draft.state = 'unknown'
      try {
        this.options.vault.save(this.options.readState())
      } catch {
        /* prepared receipt remains if disk is unavailable */
      }
      this.options.record('send-unknown')
      return this.refuse<'sent' | 'unknown'>('delivery-unknown')
    }
  }

  private persist(code: TelegramAuditCode): TelegramAccountResult {
    try {
      this.options.vault.save(this.options.readState())
      this.options.record(code)
      this.options.bump()
      return { ok: true, value: undefined }
    } catch {
      return this.refuse('storage-failed')
    }
  }

  private refuse<T = undefined>(error: TelegramSafeError): TelegramAccountResult<T> {
    this.options.record('operation-refused')
    return { ok: false, error }
  }
}
