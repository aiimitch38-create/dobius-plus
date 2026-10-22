import { Api } from 'teleproto/tl'
import type { VerifiedTelegramDialog } from '../telegram-account/types'

export const MAX_DIALOGS = 500
export const MAX_DIALOG_TITLE = 256
export const MAX_TEXT_BYTES = 4096

export function peerKind(entity: unknown): VerifiedTelegramDialog['kind'] | null {
  if (entity instanceof Api.Chat) {
    return 'group'
  }
  if (entity instanceof Api.Channel) {
    return entity.megagroup ? 'supergroup' : 'channel'
  }
  if (entity instanceof Api.User || entity instanceof Api.UserEmpty) {
    return 'user'
  }
  return null
}

export function validPeerId(value: unknown): value is string {
  return typeof value === 'string' && /^-?[1-9]\d{0,19}$/.test(value) && value !== '-0'
}

export function validGroupId(value: unknown): value is string {
  return validPeerId(value) && value.startsWith('-')
}

export function validText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES
  )
}

export function dialogSummary(
  dialog: {
    entity?: unknown
    title?: unknown
  },
  id: unknown
): VerifiedTelegramDialog | null {
  const kind = peerKind(dialog.entity)
  if (!kind || !validPeerId(id) || typeof dialog.title !== 'string' || !dialog.title.trim()) {
    return null
  }
  return { id, title: dialog.title.slice(0, MAX_DIALOG_TITLE), kind }
}
