import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { TelegramAccountApi } from '../../shared/telegram-account-api'
import { TELEGRAM_SAFE_ERRORS } from '../../shared/telegram-account'
import { TelegramAccountRendererTrust } from './telegram-account-trust'

const trust = new TelegramAccountRendererTrust()
const SAFE_ERRORS = new Set<string>(TELEGRAM_SAFE_ERRORS)

export function setTrustedTelegramAccountRenderer(id: number | null): void {
  trust.setRenderer(id)
}

/** Intentionally absent from the CLI/RPC surface: account auth is desktop-only. */
export function registerTelegramAccountHandlers(api: TelegramAccountApi): void {
  function register(name: keyof TelegramAccountApi, handler: (input: unknown) => unknown): void {
    ipcMain.handle(`telegramAccount:${name}`, async (event: IpcMainInvokeEvent, input: unknown) => {
      const assertCurrent = trust.capture(event)
      try {
        const result = await handler(input)
        assertCurrent()
        return result
      } catch (error) {
        assertCurrent()
        // SDK/crypto errors can contain credentials; expose only closed error codes.
        const code =
          error instanceof Error && SAFE_ERRORS.has(error.message)
            ? error.message
            : 'authorization-failed'
        throw new Error(code)
      }
    })
  }

  register('getSnapshot', () => api.getSnapshot())
  register('beginSignIn', (input) => {
    const value = objectInput(input, ['phoneNumber', 'apiId', 'apiHash'], ['phoneNumber'])
    if (typeof value.phoneNumber !== 'string') {
      throw new Error('invalid-input')
    }
    if (value.apiId !== undefined && typeof value.apiId !== 'number') {
      throw new Error('invalid-input')
    }
    if (value.apiHash !== undefined && typeof value.apiHash !== 'string') {
      throw new Error('invalid-input')
    }
    return api.beginSignIn({
      phoneNumber: value.phoneNumber,
      apiId: value.apiId as number | undefined,
      apiHash: value.apiHash as string | undefined
    })
  })
  register('submitCode', (input) => {
    const value = objectInput(input, ['code'], ['code'])
    if (typeof value.code !== 'string') {
      throw new Error('invalid-input')
    }
    return api.submitCode({ code: value.code })
  })
  register('submitPassword', (input) => {
    const value = objectInput(input, ['password'], ['password'])
    if (typeof value.password !== 'string') {
      throw new Error('invalid-input')
    }
    return api.submitPassword({ password: value.password })
  })
  register('refreshGroups', () => api.refreshGroups())
  register('saveGroups', (input) => {
    const value = objectInput(input, ['groupIds'], ['groupIds'])
    if (
      !Array.isArray(value.groupIds) ||
      value.groupIds.length !== 3 ||
      !value.groupIds.every((id) => typeof id === 'string' && id.length <= 128)
    ) {
      throw new Error('group-selection-required')
    }
    return api.saveGroups({ groupIds: value.groupIds as string[] })
  })
  register('getParticipants', (input) => {
    const value = objectInput(input, ['groupId'], ['groupId'])
    assertId(value.groupId, true)
    return api.getParticipants({ groupId: value.groupId as string })
  })
  register('grantConsent', (input) => {
    const value = objectInput(
      input,
      ['groupId', 'senderId', 'evidence', 'expiresAt'],
      ['groupId', 'senderId', 'evidence', 'expiresAt']
    )
    assertId(value.groupId, true)
    assertId(value.senderId)
    if (
      typeof value.evidence !== 'string' ||
      value.evidence.trim().length < 10 ||
      value.evidence.length > 1000 ||
      !Number.isSafeInteger(value.expiresAt) ||
      (value.expiresAt as number) <= Date.now()
    ) {
      throw new Error('invalid-input')
    }
    return api.grantConsent({
      groupId: value.groupId as string,
      senderId: value.senderId as string,
      evidence: value.evidence.trim(),
      expiresAt: value.expiresAt as number
    })
  })
  register('revokeConsent', (input) => {
    const value = objectInput(input, ['groupId', 'senderId'], ['groupId', 'senderId'])
    assertId(value.groupId, true)
    assertId(value.senderId)
    return api.revokeConsent({
      groupId: value.groupId as string,
      senderId: value.senderId as string
    })
  })
  for (const name of ['approveDraft', 'sendDraft'] as const) {
    register(name, (input) => {
      const value = objectInput(
        input,
        ['draftId', 'expectedRevision'],
        ['draftId', 'expectedRevision']
      )
      if (
        typeof value.draftId !== 'string' ||
        value.draftId.length > 256 ||
        !Number.isSafeInteger(value.expectedRevision) ||
        (value.expectedRevision as number) < 1
      ) {
        throw new Error('invalid-input')
      }
      return api[name]({
        draftId: value.draftId,
        expectedRevision: value.expectedRevision as number
      })
    })
  }
  for (const name of [
    'cancelSignIn',
    'pause',
    'resume',
    'disconnect',
    'revoke',
    'startReplies',
    'stopReplies'
  ] as const) {
    register(name, () => api[name]())
  }
}

function objectInput(
  input: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[]
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('invalid-input')
  }
  const value = input as Record<string, unknown>
  if (
    Object.keys(value).some((key) => !allowedKeys.includes(key)) ||
    requiredKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error('invalid-input')
  }
  return value
}

function assertId(value: unknown, signed = false): void {
  if (
    typeof value !== 'string' ||
    !(signed ? /^-?[1-9]\d{0,19}$/ : /^[1-9]\d{0,19}$/).test(value)
  ) {
    throw new Error('invalid-input')
  }
}
