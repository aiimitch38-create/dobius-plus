import {
  TELEGRAM_MAX_TEXT_LENGTH,
  type TelegramGroupKind,
  type TelegramGroupSummary
} from '../../shared/telegram-account'
import type { TelegramIncomingText, VerifiedTelegramDialog } from './types'

const ID_PATTERN = /^-?\d{1,20}$/

export function validPhoneNumber(value: unknown): value is string {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value)
}

export function validAuthCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4,8}$/.test(value)
}

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024
}

export function validTelegramId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value) && value !== '0'
}

export function validGroupKind(value: unknown): value is TelegramGroupKind {
  return value === 'group' || value === 'supergroup'
}

export function verifyDialog(value: unknown): value is VerifiedTelegramDialog {
  if (!isRecord(value)) {
    return false
  }
  return (
    validTelegramId(value.id) &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    value.title.length <= 200 &&
    (validGroupKind(value.kind) || value.kind === 'user' || value.kind === 'channel')
  )
}

export function selectedGroupFromDialog(
  value: VerifiedTelegramDialog
): TelegramGroupSummary | null {
  if (!validGroupKind(value.kind)) {
    return null
  }
  return { id: value.id, title: value.title, kind: value.kind }
}

export function validIncomingText(value: unknown): value is TelegramIncomingText {
  if (!isRecord(value)) {
    return false
  }
  return (
    validTelegramId(value.groupId) &&
    validTelegramId(value.senderId) &&
    validTelegramId(value.messageId) &&
    validGroupKind(value.groupKind) &&
    typeof value.text === 'string' &&
    value.text.length > 0 &&
    value.text.length <= TELEGRAM_MAX_TEXT_LENGTH
  )
}

export function validReplyText(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= TELEGRAM_MAX_TEXT_LENGTH
  )
}

export function validAccountIdentity(value: unknown): value is { userId: string } {
  return isRecord(value) && validTelegramId(value.userId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
