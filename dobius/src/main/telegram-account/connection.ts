import type {
  TelegramAccountPhase,
  TelegramAccountResult,
  TelegramGroupSummary,
  TelegramSafeError
} from '../../shared/telegram-account'
import { bounded, mapError } from './connection-operation'
import type {
  PersonalTelegramClient,
  PersonalTelegramClientFactory,
  TelegramVaultPort,
  TelegramVaultState
} from './types'
import {
  selectedGroupFromDialog,
  validAccountIdentity,
  validTelegramId,
  verifyDialog
} from './validation'
import type { TelegramReplyCoordinator } from './replies'
import { recoverTelegramVaultState } from './recover-state'
import { revokeTelegramAuthorizationFromPaused } from './connection-revocation'
import { stopTelegramClient } from './connection-stop'

export type TelegramConnectionContext = {
  enabled: boolean
  createClient: PersonalTelegramClientFactory | null
  vault: TelegramVaultPort
  replies: TelegramReplyCoordinator
  usable(): boolean
  isCurrent(generation: number): boolean
  isGenerationCurrent(generation: number): boolean
  getGeneration(): number
  beginOperation(): number
  signal(): AbortSignal
  getPhase(): TelegramAccountPhase
  setPhase(phase: TelegramAccountPhase): void
  setPaused(paused: boolean): void
  getState(): TelegramVaultState
  setState(state: TelegramVaultState): void
  getClient(): PersonalTelegramClient | null
  setClient(client: PersonalTelegramClient | null): void
  cancelAuthorization(): void
  authPending(): boolean
  bump(): void
  selectionChanged(): void
  record(
    code: 'connected' | 'disconnected' | 'paused' | 'groups-updated' | 'operation-refused'
  ): void
  refuse<T = undefined>(error: TelegramSafeError): TelegramAccountResult<T>
  fail<T = undefined>(error: TelegramSafeError): TelegramAccountResult<T>
}

/** Owns connect, group discovery and disconnect lifecycles for the personal account. */
export class TelegramConnectionController {
  constructor(private readonly context: TelegramConnectionContext) {}

  async cancelSignIn(): Promise<void> {
    const active =
      this.context.authPending() ||
      this.context.getPhase() === 'error' ||
      this.context.getPhase() === 'awaiting-code' ||
      this.context.getPhase() === 'awaiting-password'
    this.context.cancelAuthorization()
    if (!active) {
      return
    }
    this.context.setPaused(false)
    const generation = await stopTelegramClient(this.context)
    if (!this.context.isGenerationCurrent(generation)) {
      return
    }
    this.context.setPhase('disconnected')
    this.context.bump()
  }

  async listGroups(): Promise<TelegramAccountResult<TelegramGroupSummary[]>> {
    const client = this.context.getClient()
    if (!this.context.usable() || !client) {
      return this.context.refuse('client-unavailable')
    }
    const generation = this.context.getGeneration()
    try {
      const dialogs: unknown = await bounded(
        client.listDialogs(this.context.signal()),
        this.context.signal()
      )
      if (
        !this.context.isCurrent(generation) ||
        !Array.isArray(dialogs) ||
        !dialogs.every(verifyDialog)
      ) {
        return this.context.refuse('stale-operation')
      }
      const groups = dialogs.flatMap((dialog) => {
        const group = selectedGroupFromDialog(dialog)
        return group ? [group] : []
      })
      return { ok: true, value: groups }
    } catch (error) {
      return this.context.isCurrent(generation)
        ? this.context.fail(mapError(error))
        : this.context.refuse('stale-operation')
    }
  }

  async resume(): Promise<TelegramAccountResult> {
    this.context.setPaused(false)
    return this.restore()
  }

  async restore(): Promise<TelegramAccountResult> {
    if (!this.context.enabled || !this.context.createClient) {
      return this.context.refuse('client-unavailable')
    }
    if (!this.context.vault.isSecureStorageAvailable()) {
      return this.context.refuse('secure-storage-unavailable')
    }
    const generation = this.context.beginOperation()
    let client: PersonalTelegramClient | null = null
    try {
      this.recoverOutbox()
      const state = this.context.getState()
      if (!state.session || !state.account) {
        this.context.setPhase('disconnected')
        return { ok: true, value: undefined }
      }
      client = this.context.createClient!(state.session)
      const identity = await bounded(
        client.connect(state.session, this.context.signal()),
        this.context.signal()
      )
      if (!this.context.isCurrent(generation)) {
        await client.disconnect()
        return this.context.refuse('stale-operation')
      }
      if (!validAccountIdentity(identity) || identity.userId !== state.account.userId) {
        await client.disconnect()
        const next = { ...state, session: null, account: null, groups: [] }
        this.context.vault.save(next)
        this.context.setState(next)
        return this.context.fail('account-mismatch')
      }
      this.context.setClient(client)
      this.context.setPhase('connected')
      this.context.setPaused(false)
      this.context.record('connected')
      return { ok: true, value: undefined }
    } catch (error) {
      if (client) {
        await client.disconnect().catch(() => undefined)
      }
      return this.context.isCurrent(generation)
        ? this.context.fail(mapError(error))
        : this.context.refuse('stale-operation')
    }
  }

  async selectGroups(ids: unknown): Promise<TelegramAccountResult> {
    const client = this.context.getClient()
    if (!this.context.usable() || !client || !Array.isArray(ids) || ids.length !== 3) {
      return this.context.refuse('group-selection-required')
    }
    const selectedIds = ids.filter(validTelegramId)
    if (selectedIds.length !== 3 || new Set(selectedIds).size !== 3) {
      return this.context.refuse('invalid-input')
    }
    const generation = this.context.getGeneration()
    try {
      const dialogs: unknown = await bounded(
        client.listDialogs(this.context.signal()),
        this.context.signal()
      )
      if (
        !this.context.isCurrent(generation) ||
        !Array.isArray(dialogs) ||
        !dialogs.every(verifyDialog)
      ) {
        return this.context.refuse('stale-operation')
      }
      const selected = dialogs
        .filter((dialog) => selectedIds.includes(dialog.id))
        .map(selectedGroupFromDialog)
      if (selected.length !== 3 || selected.some((group) => group === null)) {
        return this.context.refuse('group-selection-required')
      }
      const next = {
        ...this.context.getState(),
        groups: selected.filter((group) => group !== null)
      }
      this.context.vault.save(next)
      this.context.setState(next)
      this.context.selectionChanged()
      this.context.record('groups-updated')
      this.context.bump()
      return { ok: true, value: undefined }
    } catch (error) {
      return this.context.isCurrent(generation)
        ? this.context.fail(mapError(error))
        : this.context.refuse('stale-operation')
    }
  }

  async pause(): Promise<void> {
    this.context.setPaused(true)
    const generation = await stopTelegramClient(this.context)
    if (!this.context.isGenerationCurrent(generation)) {
      return
    }
    this.context.setPhase(this.context.getState().session ? 'paused' : 'disconnected')
    this.context.record('paused')
  }

  async disconnect(): Promise<void> {
    const generation = await stopTelegramClient(this.context)
    if (!this.context.isGenerationCurrent(generation)) {
      return
    }
    const state = this.context.getState()
    const uncertain = state.outbox.filter((entry) => entry.state !== 'sent')
    const uncertainIds = new Set(uncertain.map((entry) => entry.draftId))
    const next =
      uncertain.length > 0
        ? {
            ...state,
            session: null,
            groups: [],
            drafts: state.drafts
              .filter((draft) => uncertainIds.has(draft.id))
              .map((draft) => ({ ...draft, state: 'unknown' as const })),
            outbox: uncertain.map((entry) => ({ ...entry, state: 'unknown' as const }))
          }
        : {
            schemaVersion: 2 as const,
            account: null,
            session: null,
            groups: [],
            drafts: [],
            outbox: [],
            inboundEvents: state.inboundEvents
          }
    this.context.vault.save(next)
    this.context.setState(next)
    this.context.setPhase('disconnected')
    this.context.setPaused(false)
    this.context.record('disconnected')
  }

  async revoke(): Promise<TelegramAccountResult> {
    const client = this.context.getClient()
    const revoke = client?.revokeAuthorization
    if (!this.context.usable() || !client || !revoke) {
      return this.context.refuse('client-unavailable')
    }
    const generation = this.context.beginOperation()
    let stopGeneration = generation
    try {
      await this.context.replies.stop()
      await this.context.replies.drainSends()
      if (!this.context.isCurrent(generation)) {
        return this.context.refuse('stale-operation')
      }
      if ((await bounded(revoke.call(client), this.context.signal())) !== true) {
        return this.context.fail('authorization-failed')
      }
      if (!this.context.isCurrent(generation)) {
        return this.context.refuse('stale-operation')
      }
      stopGeneration = await stopTelegramClient(this.context)
      if (!this.context.isGenerationCurrent(stopGeneration)) {
        return this.context.refuse('stale-operation')
      }
      const empty: TelegramVaultState = {
        schemaVersion: 2,
        account: null,
        session: null,
        groups: [],
        drafts: [],
        outbox: [],
        inboundEvents: this.context.getState().inboundEvents
      }
      this.context.vault.save(empty)
      this.context.setState(empty)
      this.context.setPhase('disconnected')
      this.context.setPaused(false)
      this.context.record('disconnected')
      return { ok: true, value: undefined }
    } catch (error) {
      return this.context.isGenerationCurrent(stopGeneration)
        ? this.context.fail(mapError(error))
        : this.context.refuse('stale-operation')
    }
  }

  async revokeFromPaused(): Promise<TelegramAccountResult> {
    return revokeTelegramAuthorizationFromPaused(this.context)
  }

  private recoverOutbox(): void {
    const state = this.context.vault.load()
    const recovered = recoverTelegramVaultState(state)
    if (recovered !== state) {
      this.context.vault.save(recovered)
      this.context.setState(recovered)
    } else {
      this.context.setState(state)
    }
  }
}
