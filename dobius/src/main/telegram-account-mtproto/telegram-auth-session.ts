import { randomUUID } from 'node:crypto'
import type { TelegramAccountIdentity, TelegramAuthOutcome } from '../telegram-account/types'
import type { TeleprotoClient, TeleprotoRuntime } from './teleproto-runtime'
import { TelegramAdapterError } from './telegram-errors'

const MAX_AUTH_HANDLES = 4

type AuthRequest = { phoneNumber: string; phoneCodeHash: string }
type Operation = <T>(signal: AbortSignal, work: () => Promise<T>) => Promise<T>

export class TelegramAuthSession {
  private readonly requests = new Map<string, AuthRequest>()
  private passwordPending = false

  constructor(
    private readonly client: TeleprotoClient,
    private readonly runtime: TeleprotoRuntime,
    private readonly credentials: { apiId: number; apiHash: string },
    private readonly saveSession: (client: TeleprotoClient) => string,
    private readonly ensureSocket: () => Promise<void>,
    private readonly operation: Operation
  ) {}

  requestCode(phoneNumber: string, signal: AbortSignal): Promise<{ codeHandle: string }> {
    if (typeof phoneNumber !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
      throw new TelegramAdapterError()
    }
    return this.operation(signal, async () => {
      await this.ensureSocket()
      const sent = await this.client.sendCode(this.credentials, phoneNumber)
      if (
        typeof sent.phoneCodeHash !== 'string' ||
        sent.phoneCodeHash.length === 0 ||
        sent.phoneCodeHash.length > 512
      ) {
        throw new TelegramAdapterError()
      }
      const codeHandle = randomUUID()
      this.requests.set(codeHandle, { phoneNumber, phoneCodeHash: sent.phoneCodeHash })
      while (this.requests.size > MAX_AUTH_HANDLES) {
        const oldest = this.requests.keys().next().value
        if (oldest) {
          this.requests.delete(oldest)
        }
      }
      return { codeHandle }
    })
  }

  submitCode(codeHandle: string, code: string, signal: AbortSignal): Promise<TelegramAuthOutcome> {
    if (typeof code !== 'string' || !/^\d{4,8}$/.test(code) || typeof codeHandle !== 'string') {
      throw new TelegramAdapterError()
    }
    const auth = this.requests.get(codeHandle)
    if (!auth) {
      throw new TelegramAdapterError()
    }
    return this.operation(signal, async () => {
      try {
        const result = await this.client.invoke(
          this.runtime.makeSignIn(auth.phoneNumber, auth.phoneCodeHash, code)
        )
        if (this.runtime.isSignupRequired(result)) {
          throw new TelegramAdapterError()
        }
        this.requests.delete(codeHandle)
        return this.authorizedOutcome()
      } catch (error) {
        if (this.runtime.isPasswordRequired(error)) {
          this.passwordPending = true
          return { kind: 'password-required' }
        }
        throw new TelegramAdapterError()
      }
    })
  }

  submitPassword(password: string, signal: AbortSignal): Promise<TelegramAuthOutcome> {
    if (
      !this.passwordPending ||
      typeof password !== 'string' ||
      password.length < 1 ||
      password.length > 1024
    ) {
      throw new TelegramAdapterError()
    }
    return this.operation(signal, async () => {
      try {
        await this.client.signInWithPassword(this.credentials, {
          password: async () => password,
          onError: async () => true
        })
        this.passwordPending = false
        this.requests.clear()
        return this.authorizedOutcome()
      } catch {
        throw new TelegramAdapterError()
      }
    })
  }

  connect(session: string, signal: AbortSignal): Promise<TelegramAccountIdentity> {
    if (typeof session !== 'string' || !session) {
      throw new TelegramAdapterError()
    }
    return this.operation(signal, async () => {
      // StringSession hydrates its auth key asynchronously; save() is empty until load().
      await this.client.session.load()
      if (signal.aborted || this.saveSession(this.client) !== session) {
        throw new TelegramAdapterError()
      }
      await this.ensureSocket()
      if (!(await this.client.checkAuthorization())) {
        throw new TelegramAdapterError()
      }
      return this.readIdentity()
    })
  }

  clear(): void {
    this.requests.clear()
    this.passwordPending = false
  }

  private async authorizedOutcome(): Promise<TelegramAuthOutcome> {
    if (!(await this.client.checkAuthorization())) {
      throw new TelegramAdapterError()
    }
    const identity = await this.readIdentity()
    const session = this.saveSession(this.client)
    if (session.length === 0 || session.length > 32_000) {
      throw new TelegramAdapterError()
    }
    return { kind: 'authorized', identity, session }
  }

  private async readIdentity(): Promise<TelegramAccountIdentity> {
    const me = await this.client.getMe()
    const userId = String(me.id)
    if (!/^\d{1,20}$/.test(userId)) {
      throw new TelegramAdapterError()
    }
    return { userId }
  }
}
