import type {
  TelegramAccountView,
  TelegramHistoryPage,
  TelegramTerminalSendResult
} from '../../shared/telegram-account-api'

export type TelegramTerminalAccess = {
  view: () => Promise<TelegramAccountView>
  history: (group: string, beforeId: number, limit: number) => Promise<TelegramHistoryPage>
  /** Sends only after Carson confirms the exact draft in a Dobius+ dialog. */
  send: (draftId: string) => Promise<TelegramTerminalSendResult>
}

// The terminal CLI reads the same live account the Settings page owns; it never creates a second one.
let active: TelegramTerminalAccess | null = null

export function setTelegramTerminalAccess(next: TelegramTerminalAccess | null): void {
  active = next
}

export function telegramTerminalAccess(): TelegramTerminalAccess {
  if (!active) {
    throw new Error('telegram-unavailable')
  }
  return active
}
