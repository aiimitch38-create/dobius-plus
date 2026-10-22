import type {
  TelegramAccountResult,
  TelegramAccountPhase,
  TelegramAuditCode,
  TelegramSafeError
} from '../../shared/telegram-account'
import { TelegramVaultError } from './vault'
import type {
  PersonalTelegramClient,
  PersonalTelegramClientFactory,
  TelegramVaultPort,
  TelegramVaultState
} from './types'
import { validAccountIdentity, validAuthCode, validPassword, validPhoneNumber } from './validation'

const OPERATION_TIMEOUT_MS = 60_000
const AUTH_ATTEMPT_LIMIT = 5
const AUTH_FLOW_TTL_MS = 10 * 60_000

export type TelegramAuthorizationContext = {
  vault: TelegramVaultPort
  createClient: PersonalTelegramClientFactory | null
  enabled: boolean
  beginOperation: () => number
  isCurrent: (generation: number) => boolean
  getGeneration: () => number
  getPhase: () => TelegramAccountPhase
  signal: () => AbortSignal
  getClient: () => PersonalTelegramClient | null
  setClient: (client: PersonalTelegramClient | null) => void
  getState: () => TelegramVaultState
  setState: (state: TelegramVaultState) => void
  setPhase: (phase: TelegramAccountPhase) => void
  setPaused: (paused: boolean) => void
  now: () => number
  bump: () => void
  record: (code: TelegramAuditCode) => void
  refuse: (error: TelegramSafeError) => TelegramAccountResult
  fail: (error: TelegramSafeError) => TelegramAccountResult
}

/** Holds OTP handles only in memory and commits MTProto sessions through the OS-encrypted vault. */
export class TelegramAuthorizationFlow {
  private codeHandle: string | null = null
  private expiresAt = 0
  private attempts = 0

  constructor(private readonly context: TelegramAuthorizationContext) {}

  async begin(phone: unknown): Promise<TelegramAccountResult> {
    if (!this.context.enabled || !this.context.createClient) {
      return this.context.refuse('client-unavailable')
    }
    if (!this.context.vault.isSecureStorageAvailable()) {
      return this.context.refuse('secure-storage-unavailable')
    }
    if (!validPhoneNumber(phone)) {
      return this.context.refuse('invalid-input')
    }
    const generation = this.context.beginOperation()
    let client: PersonalTelegramClient | null = null
    try {
      client = this.context.createClient(null)
      const result = await bounded(
        client.requestCode(phone, this.context.signal()),
        this.context.signal()
      )
      if (!this.context.isCurrent(generation) || !isOpaqueHandle(result.codeHandle)) {
        await client.disconnect()
        return this.context.refuse('stale-operation')
      }
      this.context.setClient(client)
      this.codeHandle = result.codeHandle
      this.expiresAt = this.context.now() + AUTH_FLOW_TTL_MS
      this.attempts = 0
      this.context.setPhase('awaiting-code')
      this.context.bump()
      return { ok: true, value: undefined }
    } catch (error) {
      if (client) {
        await client.disconnect().catch(() => undefined)
      }
      if (!this.context.isCurrent(generation)) {
        return this.context.refuse('stale-operation')
      }
      return this.context.fail(mapError(error))
    }
  }

  async submitCode(code: unknown): Promise<TelegramAccountResult> {
    const client = this.context.getClient()
    if (!this.valid('awaiting-code') || !client || !this.codeHandle || !validAuthCode(code)) {
      return this.context.refuse('invalid-input')
    }
    this.attempts += 1
    const generation = this.currentGeneration()
    try {
      const outcome = await bounded(
        client.submitCode(this.codeHandle, code, this.context.signal()),
        this.context.signal()
      )
      return this.accept(outcome, generation)
    } catch (error) {
      if (!this.context.isCurrent(generation)) {
        return this.context.refuse('stale-operation')
      }
      return this.context.fail(mapError(error))
    }
  }

  async submitPassword(password: unknown): Promise<TelegramAccountResult> {
    const client = this.context.getClient()
    if (!this.valid('awaiting-password') || !client || !validPassword(password)) {
      return this.context.refuse('invalid-input')
    }
    this.attempts += 1
    const generation = this.currentGeneration()
    try {
      const outcome = await bounded(
        client.submitPassword(password, this.context.signal()),
        this.context.signal()
      )
      return this.accept(outcome, generation)
    } catch (error) {
      if (!this.context.isCurrent(generation)) {
        return this.context.refuse('stale-operation')
      }
      return this.context.fail(mapError(error))
    }
  }

  cancel(): void {
    this.codeHandle = null
    this.expiresAt = 0
    this.attempts = 0
  }

  private async accept(
    result:
      | { kind: 'password-required' }
      | { kind: 'authorized'; identity: { userId: string }; session: string },
    generation: number
  ): Promise<TelegramAccountResult> {
    if (!this.context.isCurrent(generation)) {
      return this.context.refuse('stale-operation')
    }
    if (result.kind === 'password-required') {
      this.context.setPhase('awaiting-password')
      this.context.bump()
      return { ok: true, value: undefined }
    }
    if (
      !validAccountIdentity(result.identity) ||
      typeof result.session !== 'string' ||
      result.session.length > 32_000
    ) {
      return this.context.fail('authorization-failed')
    }
    const previous = this.context.vault.load()
    if (previous.account && previous.account.userId !== result.identity.userId) {
      return this.context.fail('account-mismatch')
    }
    const client = this.context.getClient()
    if (!client) {
      return this.context.refuse('stale-operation')
    }
    const identity = await bounded(
      client.connect(result.session, this.context.signal()),
      this.context.signal()
    )
    if (!this.context.isCurrent(generation) || identity.userId !== result.identity.userId) {
      return this.context.fail('account-mismatch')
    }
    this.context.setState({
      ...this.context.getState(),
      account: result.identity,
      session: result.session,
      groups: previous.groups,
      drafts: previous.drafts,
      outbox: previous.outbox
    })
    this.context.vault.save(this.context.getState())
    this.context.setPhase('connected')
    this.context.setPaused(false)
    this.cancel()
    this.context.record('connected')
    this.context.bump()
    return { ok: true, value: undefined }
  }

  private valid(phase: 'awaiting-code' | 'awaiting-password'): boolean {
    if (
      this.context.getPhase() === phase &&
      this.expiresAt > this.context.now() &&
      this.attempts < AUTH_ATTEMPT_LIMIT
    ) {
      return true
    }
    this.cancel()
    return false
  }

  private currentGeneration(): number {
    return this.context.getGeneration()
  }
}

function isOpaqueHandle(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}

function mapError(error: unknown): TelegramSafeError {
  if (error instanceof TelegramVaultError) {
    return error.code === 'unavailable' ? 'secure-storage-unavailable' : 'storage-failed'
  }
  return 'authorization-failed'
}

function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      return reject(new Error('operation-cancelled'))
    }
    const clear = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      clear()
      reject(new Error('operation-timeout'))
    }, OPERATION_TIMEOUT_MS)
    const onAbort = () => {
      clear()
      reject(new Error('operation-cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        clear()
        resolve(value)
      },
      (error: unknown) => {
        clear()
        reject(error)
      }
    )
  })
}
