import {
  TELEGRAM_REQUIRED_GROUP_COUNT,
  TELEGRAM_SAFE_ERRORS,
  type TelegramAccountSnapshot,
  type TelegramAuditEntry as SharedTelegramAuditEntry,
  type TelegramGroupSummary,
  type TelegramSafeError
} from '../../../../shared/telegram-account'
import type {
  TelegramAccountApi,
  TelegramAccountView
} from '../../../../shared/telegram-account-api'

export type TelegramGroupOption = TelegramGroupSummary
export type TelegramAccountUiStatus = TelegramAccountSnapshot['phase']

export type TelegramAuditEntry = SharedTelegramAuditEntry

export type TelegramAccountUiSnapshot = TelegramAccountView
export type TelegramAccountUiApi = TelegramAccountApi

export const TELEGRAM_GROUP_SELECTION_COUNT = TELEGRAM_REQUIRED_GROUP_COUNT
export const TELEGRAM_AUDIT_LIMIT = 8

export function isValidTelegramGroupSelection(
  groupIds: readonly string[],
  options: readonly TelegramGroupOption[]
): boolean {
  const selected = new Set(groupIds)
  if (groupIds.length !== TELEGRAM_GROUP_SELECTION_COUNT || selected.size !== groupIds.length) {
    return false
  }

  const validIds = new Set(
    options
      .filter((option) => option.kind === 'group' || option.kind === 'supergroup')
      .map((option) => option.id)
  )
  return [...selected].every((id) => validIds.has(id))
}

export function getTelegramUiErrorMessage(
  error?: TelegramSafeError | null,
  canResume = false
): string {
  switch (error) {
    case 'secure-storage-unavailable':
      return 'Secure Telegram storage is unavailable on this device.'
    case 'authorization-failed':
      if (canResume) {
        return 'Telegram could not restore the saved connection. Retry the saved connection without signing in again.'
      }
      return 'Telegram sign-in was not accepted. Check the code or password and try again.'
    case 'group-selection-required':
      return 'Select exactly three verified Telegram groups.'
    case 'consent-required':
      return 'Telegram handling is unavailable until required chat consent is verified.'
    case 'stale-operation':
    case 'draft-stale':
      return 'Telegram state changed. Refresh the account view and try again.'
    case 'delivery-unknown':
      return 'Telegram delivery status is unknown. Check the draft state before retrying.'
    case 'delivery-failed':
      return 'Telegram could not deliver this reply.'
    case 'account-mismatch':
      return 'The signed-in Telegram account does not match the current account state.'
    case 'invalid-input':
      return 'Check the Telegram details and try again.'
    case 'storage-failed':
      return 'Telegram account state could not be saved securely.'
    case 'client-unavailable':
    case null:
    case undefined:
      return 'Telegram could not complete that request. Check the connection state and try again.'
  }
}

const safeErrorCodes = new Set<string>(TELEGRAM_SAFE_ERRORS)

export function getTelegramRequestErrorMessage(error: unknown, canResume = false): string {
  try {
    const message = error instanceof Error ? error.message : ''
    // Electron wraps IPC rejections. Only closed error codes can become UI text;
    // SDK exception messages can contain authentication material.
    const wrapped =
      /^Error invoking remote method 'telegramAccount:[A-Za-z]+': Error: ([a-z-]+)$/.exec(message)
    const code = wrapped?.[1] ?? message
    return safeErrorCodes.has(code)
      ? getTelegramUiErrorMessage(code as TelegramSafeError, canResume)
      : getTelegramUiErrorMessage()
  } catch {
    return getTelegramUiErrorMessage()
  }
}

export function formatTelegramActivity(at: number | null): string {
  if (at === null || !Number.isFinite(at)) {
    return 'No activity recorded'
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at)
}

export function getTelegramAccountStatusLabel(status: TelegramAccountUiStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected'
    case 'paused':
      return 'Paused'
    case 'awaiting-code':
      return 'Code required'
    case 'awaiting-password':
      return 'Password required'
    case 'disconnected':
      return 'Disconnected'
    case 'error':
      return 'Needs attention'
    case 'unavailable':
      return 'Unavailable'
  }
}
