import { readTelegramParticipants } from './telegram-participants'
import type { Api } from 'teleproto/tl'
import type {
  PersonalTelegramClient,
  TelegramAccountIdentity,
  TelegramAuthOutcome,
  TelegramDeliveryOutcome,
  TelegramIncomingText,
  VerifiedTelegramDialog
} from '../telegram-account/types'
import type { TeleprotoClient, TeleprotoRuntime } from './teleproto-runtime'
import { parseRandomId } from './teleproto-runtime'
import { TelegramAuthSession } from './telegram-auth-session'
import { TelegramAdapterError, TelegramPreSendError } from './telegram-errors'
import { dialogSummary, MAX_DIALOGS, peerKind, validGroupId, validText } from './telegram-peer'
import { isPlainMessage, readIncomingText } from './telegram-events'
import { readGroupHistory } from './telegram-group-history'
import { telegramListenerDiagnostic, telegramListenerError } from './listener-diagnostics'
import type { TelegramParticipantSummary } from '../../shared/telegram-account-api'

const MAX_CONFIRMED_RECEIPTS = 512

export class TeleprotoPersonalTelegramClient implements PersonalTelegramClient {
  private generation = 0
  private closed = false
  private connected = false
  private readonly auth: TelegramAuthSession
  private readonly confirmed = new Map<string, true>()
  private subscriptions = new Set<() => void>()

  constructor(
    private readonly client: TeleprotoClient,
    saveSession: (client: TeleprotoClient) => string,
    private readonly runtime: TeleprotoRuntime,
    credentials: { apiId: number; apiHash: string }
  ) {
    this.auth = new TelegramAuthSession(
      client,
      runtime,
      credentials,
      saveSession,
      () => this.ensureSocket(),
      (signal, work) => this.operation(signal, async () => work())
    )
  }

  async requestCode(phoneNumber: string, signal: AbortSignal): Promise<{ codeHandle: string }> {
    return this.auth.requestCode(phoneNumber, signal)
  }

  async submitCode(
    codeHandle: string,
    code: string,
    signal: AbortSignal
  ): Promise<TelegramAuthOutcome> {
    return this.auth.submitCode(codeHandle, code, signal)
  }

  async submitPassword(password: string, signal: AbortSignal): Promise<TelegramAuthOutcome> {
    return this.auth.submitPassword(password, signal)
  }

  async connect(session: string, signal: AbortSignal): Promise<TelegramAccountIdentity> {
    return this.auth.connect(session, signal)
  }

  async listDialogs(signal: AbortSignal): Promise<VerifiedTelegramDialog[]> {
    return this.operation(signal, async (generation) => {
      await this.ensureSocket()
      const output: VerifiedTelegramDialog[] = []
      for await (const dialog of this.client.iterDialogs({ limit: MAX_DIALOGS })) {
        this.assertCurrent(generation, signal)
        if (!dialog.entity) {
          continue
        }
        const id = await this.client.getPeerId(dialog.entity, true)
        const item = dialogSummary(dialog, id)
        if (item) {
          output.push(item)
        }
      }
      return output
    })
  }

  async subscribe(
    onMessage: (message: TelegramIncomingText) => void
  ): Promise<() => Promise<void>> {
    const generation = this.generation
    if (this.closed || !this.connected) {
      throw new TelegramAdapterError()
    }
    let active = true
    const eventBuilder = this.runtime.makeIncomingEvent()
    const handler = (event: { message: unknown }): void => {
      const message = event?.message
      telegramListenerDiagnostic('event-received', { active, plain: isPlainMessage(message) })
      if (!active || !this.isCurrent(generation) || !isPlainMessage(message)) {
        return
      }
      void this.processEvent(message, onMessage, generation).catch(telegramListenerError)
    }
    try {
      this.client.addEventHandler(handler, eventBuilder)
    } catch {
      throw new TelegramAdapterError()
    }
    telegramListenerDiagnostic('subscribed')
    let removed = false
    const remove = (): void => {
      if (removed) {
        return
      }
      removed = true
      active = false
      try {
        this.client.removeEventHandler(handler, eventBuilder)
      } catch {
        /* A removed callback is still generation-fenced even if the SDK rejects removal. */
      }
      this.subscriptions.delete(remove)
    }
    this.subscriptions.add(remove)
    return async () => {
      remove()
    }
  }

  async listParticipants(
    groupId: string,
    signal: AbortSignal
  ): Promise<TelegramParticipantSummary[]> {
    if (!validGroupId(groupId)) {
      throw new TelegramAdapterError()
    }
    return this.operation(signal, async (generation) => {
      await this.ensureSocket()
      return readTelegramParticipants(this.client, groupId, () =>
        this.assertCurrent(generation, signal)
      )
    })
  }

  /** Callers must pass a selected group id; the service enforces that before reaching here. */
  async readHistory(groupId: string, beforeId: number, limit: number, signal: AbortSignal) {
    return this.operation(signal, async () => {
      await this.ensureSocket()
      return readGroupHistory(this.client, await this.client.getEntity(groupId), beforeId, limit)
    })
  }

  async sendText(args: {
    groupId: string
    text: string
    randomId: string
    signal: AbortSignal
    canSend: () => boolean
  }): Promise<TelegramDeliveryOutcome> {
    let groupId: string
    let text: string
    let suppliedRandomId: string
    let signal: AbortSignal
    let canSend: () => boolean
    try {
      ;({ groupId, text, randomId: suppliedRandomId, signal, canSend } = args)
    } catch {
      return 'not-sent'
    }
    let randomId
    try {
      randomId = parseRandomId(suppliedRandomId)
    } catch {
      return 'not-sent'
    }
    if (!validGroupId(groupId) || !validText(text) || !randomId) {
      return 'not-sent'
    }
    let invoked = false
    try {
      const result = await this.operation(signal, async (generation) => {
        await this.ensureSocket()
        const inputPeer = await this.client.getInputEntity(groupId)
        const entity = await this.client.getEntity(inputPeer)
        const kind = peerKind(entity)
        if (kind !== 'group' && kind !== 'supergroup') {
          throw new TelegramPreSendError()
        }
        this.assertCurrent(generation, signal)
        // Consent can change during peer resolution; this is the final synchronous send gate.
        if (typeof canSend !== 'function' || !canSend()) {
          throw new TelegramPreSendError()
        }
        invoked = true
        await this.client.invoke(this.runtime.makeSendMessage(inputPeer, text, randomId))
        return true
      })
      if (!result) {
        return 'unknown'
      }
      this.confirmed.set(suppliedRandomId, true)
      while (this.confirmed.size > MAX_CONFIRMED_RECEIPTS) {
        const oldest = this.confirmed.keys().next().value
        if (oldest) {
          this.confirmed.delete(oldest)
        }
      }
      return 'confirmed'
    } catch (error) {
      if (error instanceof TelegramPreSendError) {
        return 'not-sent'
      }
      return invoked ? 'unknown' : 'not-sent'
    }
  }

  async lookupRandomId(randomId: string, signal: AbortSignal): Promise<TelegramDeliveryOutcome> {
    let valid = false
    try {
      valid = Boolean(parseRandomId(randomId))
    } catch {
      return 'unknown'
    }
    if (!valid || signal.aborted || this.closed) {
      return 'unknown'
    }
    if (this.confirmed.has(randomId)) {
      return 'confirmed'
    }
    return 'unknown'
  }

  async disconnect(): Promise<void> {
    this.generation += 1
    this.closed = true
    this.auth.clear()
    for (const remove of this.subscriptions) {
      remove()
    }
    this.confirmed.clear()
    try {
      await this.client.disconnect()
    } catch {
      /* SDK errors may contain session material. */
    }
  }

  /** Local disconnect is not treated as revoked; only auth.LogOut's typed result proves revocation. */
  async revokeAuthorization(): Promise<boolean> {
    if (this.closed || !this.connected) {
      return false
    }
    try {
      const result = await this.client.invoke(this.runtime.makeLogOut())
      if (!this.runtime.isLoggedOut(result)) {
        return false
      }
      await this.disconnect()
      return true
    } catch {
      return false
    }
  }

  private async processEvent(
    message: Api.Message,
    onMessage: (message: TelegramIncomingText) => void,
    generation: number
  ): Promise<void> {
    const result = await readIncomingText(message as never, (entity, addMark) =>
      this.client.getPeerId(entity as never, addMark)
    )
    if (result && this.isCurrent(generation)) {
      onMessage(result)
    }
  }

  private async ensureSocket(): Promise<void> {
    if (this.closed) {
      throw new TelegramAdapterError()
    }
    if (!this.connected) {
      if (!(await this.client.connect())) {
        throw new TelegramAdapterError()
      }
      this.connected = true
    }
  }

  private async operation<T>(
    signal: AbortSignal,
    work: (generation: number) => Promise<T>
  ): Promise<T> {
    if (signal.aborted || this.closed) {
      throw new TelegramAdapterError()
    }
    const generation = this.generation
    const onAbort = (): void => {
      void this.disconnect()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const result = await work(generation)
      this.assertCurrent(generation, signal)
      return result
    } catch {
      if (signal.aborted || !this.isCurrent(generation)) {
        throw new TelegramAdapterError()
      }
      throw new TelegramAdapterError()
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private assertCurrent(generation: number, signal: AbortSignal): void {
    if (signal.aborted || !this.isCurrent(generation)) {
      throw new TelegramAdapterError()
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.closed && this.generation === generation
  }
}

export { createGramJsPersonalTelegramClientFactory } from './telegram-factory'
