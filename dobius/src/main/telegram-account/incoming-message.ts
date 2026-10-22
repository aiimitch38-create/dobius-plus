import { telegramListenerDiagnostic } from '../telegram-account-mtproto/listener-diagnostics'
import { TELEGRAM_ASSIGNED_AGENT, type TelegramAuditCode } from '../../shared/telegram-account'
import type {
  AdamTelegramReplyPort,
  ChatConsentProof,
  TelegramVaultPort,
  TelegramVaultState
} from './types'
import { TELEGRAM_INBOUND_EVENT_LIMIT } from './types'
import { currentConsent, hasDuplicateDraft } from './consent-policy'
import { boundedTelegramInference } from './incoming-operation'
import { validIncomingText, validReplyText } from './validation'

export type TelegramIncomingProcessorOptions = {
  vault: TelegramVaultPort
  readState: () => TelegramVaultState
  writeState: (state: TelegramVaultState) => void
  isCurrent: (generation: number) => boolean
  getSelectionRevision: () => bigint
  signal: () => AbortSignal
  cancelOperation: () => void
  readConsent: ((groupId: string, senderId: string) => ChatConsentProof) | null
  replyToAdam: AdamTelegramReplyPort | null
  now: () => number
  record: (code: TelegramAuditCode) => void
}

/** Reserves encrypted update identities before inference; unknown completion stays manual-review. */
export class TelegramIncomingMessageProcessor {
  private readonly admissionsInProgress = new Set<string>()

  constructor(private readonly options: TelegramIncomingProcessorOptions) {}

  async handle(message: unknown, generation: number): Promise<void> {
    telegramListenerDiagnostic('delivered')
    if (!this.options.isCurrent(generation) || !validIncomingText(message)) {
      telegramListenerDiagnostic('filtered', { reason: 'stale-or-invalid' })
      this.options.record('message-filtered')
      return
    }
    const initial = this.options.readState()
    const accountId = initial.account?.userId
    const group = initial.groups.find(
      (item) => item.id === message.groupId && item.kind === message.groupKind
    )
    if (!accountId || !group || !this.options.readConsent || !this.options.replyToAdam) {
      telegramListenerDiagnostic('filtered', {
        reason: !group ? 'group-not-selected' : 'not-ready',
        groupId: message.groupId,
        groupKind: message.groupKind,
        selected: initial.groups.map((item) => `${item.id}:${item.kind}`).join(',')
      })
      this.options.record('message-filtered')
      return
    }
    const consent = currentConsent(this.options.readConsent, message.groupId, message.senderId)
    if (!consent) {
      telegramListenerDiagnostic('filtered', { reason: 'no-consent', senderId: message.senderId })
      this.options.record('message-filtered')
      return
    }
    const admissionState = this.options.readState()
    const admissionGroup = admissionState.groups.find(
      (item) => item.id === message.groupId && item.kind === message.groupKind
    )
    if (
      admissionState.account?.userId !== accountId ||
      !admissionGroup ||
      admissionGroup.title !== group.title
    ) {
      this.options.record('message-filtered')
      return
    }
    const selectionRevision = this.options.getSelectionRevision()
    const signal = this.options.signal()
    if (!this.reserve(admissionState, accountId, message)) {
      return
    }
    try {
      const body = await boundedTelegramInference(
        this.options.replyToAdam({
          agentId: TELEGRAM_ASSIGNED_AGENT,
          group,
          senderId: message.senderId,
          messageId: message.messageId,
          text: message.text,
          context: message.context,
          signal
        }),
        signal,
        this.options.cancelOperation
      )
      this.publish({
        accountId,
        body,
        consentRevision: consent.revision,
        generation,
        group,
        message,
        selectionRevision,
        signal
      })
    } catch {
      this.finish(accountId, message.groupId, message.messageId, 'manual-review')
      this.options.record('operation-refused')
    }
  }

  private reserve(
    state: TelegramVaultState,
    accountId: string,
    message: { groupId: string; messageId: string }
  ): boolean {
    const key = JSON.stringify([accountId, message.groupId, message.messageId])
    if (this.admissionsInProgress.has(key)) {
      this.options.record('message-filtered')
      return false
    }
    const existing = state.inboundEvents.find(
      (event) =>
        event.accountId === accountId &&
        event.groupId === message.groupId &&
        event.messageId === message.messageId
    )
    if (existing) {
      this.options.record('message-filtered')
      return false
    }
    this.admissionsInProgress.add(key)
    try {
      if (hasDuplicateDraft(state, message.groupId, message.messageId)) {
        return this.persistReceipt(state, accountId, message, 'draft-created')
      }
      if (state.inboundEvents.length >= TELEGRAM_INBOUND_EVENT_LIMIT) {
        this.options.record('operation-refused')
        return false
      }
      return this.persistReceipt(state, accountId, message, 'processing')
    } finally {
      this.admissionsInProgress.delete(key)
    }
  }

  private persistReceipt(
    state: TelegramVaultState,
    accountId: string,
    message: { groupId: string; messageId: string },
    status: 'processing' | 'draft-created'
  ): boolean {
    const next: TelegramVaultState = {
      ...state,
      inboundEvents: [
        ...state.inboundEvents,
        {
          accountId,
          groupId: message.groupId,
          messageId: message.messageId,
          admittedAt: this.options.now(),
          state: status
        }
      ]
    }
    try {
      this.options.vault.save(next)
      this.options.writeState(next)
      return status === 'processing'
    } catch {
      this.options.record('operation-refused')
      return false
    }
  }

  private publish(input: {
    accountId: string
    body: string
    consentRevision: string
    generation: number
    group: TelegramVaultState['groups'][number]
    message: { groupId: string; groupKind: string; senderId: string; messageId: string }
    selectionRevision: bigint
    signal: AbortSignal
  }): void {
    const state = this.options.readState()
    const currentGroup = state.groups.find((group) => group.id === input.message.groupId)
    const consent = currentConsent(
      this.options.readConsent,
      input.message.groupId,
      input.message.senderId
    )
    if (
      input.signal.aborted ||
      !this.options.isCurrent(input.generation) ||
      this.options.getSelectionRevision() !== input.selectionRevision ||
      state.account?.userId !== input.accountId ||
      !currentGroup ||
      currentGroup.kind !== input.message.groupKind ||
      currentGroup.title !== input.group.title ||
      consent?.revision !== input.consentRevision
    ) {
      this.finish(input.accountId, input.message.groupId, input.message.messageId, 'manual-review')
      this.options.record('message-filtered')
      return
    }
    if (!validReplyText(input.body)) {
      this.finish(input.accountId, input.message.groupId, input.message.messageId, 'manual-review')
      this.options.record('operation-refused')
      return
    }
    const receipt = this.findReceipt(
      state,
      input.accountId,
      input.message.groupId,
      input.message.messageId
    )
    if (!receipt || receipt.state !== 'processing') {
      this.options.record('operation-refused')
      return
    }
    if (hasDuplicateDraft(state, input.message.groupId, input.message.messageId)) {
      this.finish(input.accountId, input.message.groupId, input.message.messageId, 'draft-created')
      return
    }
    const next: TelegramVaultState = {
      ...state,
      drafts: [
        ...state.drafts,
        {
          id: `${input.message.groupId}.${input.message.messageId}`,
          revision: 1,
          groupId: input.group.id,
          groupTitle: input.group.title,
          senderId: input.message.senderId,
          sourceMessageId: input.message.messageId,
          consentRevision: input.consentRevision,
          body: input.body,
          state: 'awaiting-approval' as const,
          createdAt: this.options.now()
        }
      ].slice(-100),
      inboundEvents: state.inboundEvents.map((event) =>
        this.matches(event, input.accountId, input.message.groupId, input.message.messageId)
          ? { ...event, state: 'draft-created' as const }
          : event
      )
    }
    this.saveCurrent(next)
  }

  private finish(
    accountId: string,
    groupId: string,
    messageId: string,
    status: 'manual-review' | 'draft-created'
  ): void {
    const state = this.options.readState()
    const receipt = this.findReceipt(state, accountId, groupId, messageId)
    if (!receipt || receipt.state !== 'processing') {
      return
    }
    const next = {
      ...state,
      inboundEvents: state.inboundEvents.map((event) =>
        this.matches(event, accountId, groupId, messageId) ? { ...event, state: status } : event
      )
    }
    this.saveCurrent(next)
  }

  private saveCurrent(state: TelegramVaultState): void {
    try {
      this.options.vault.save(state)
      this.options.writeState(state)
    } catch {
      // The prior durable processing receipt prevents replay after a failed publish.
      this.options.record('operation-refused')
    }
  }

  private findReceipt(
    state: TelegramVaultState,
    accountId: string,
    groupId: string,
    messageId: string
  ) {
    return state.inboundEvents.find((event) => this.matches(event, accountId, groupId, messageId))
  }

  private matches(
    event: TelegramVaultState['inboundEvents'][number],
    accountId: string,
    groupId: string,
    messageId: string
  ): boolean {
    return (
      event.accountId === accountId && event.groupId === groupId && event.messageId === messageId
    )
  }
}
