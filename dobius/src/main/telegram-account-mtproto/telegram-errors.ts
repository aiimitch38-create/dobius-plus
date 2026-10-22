export class TelegramAdapterError extends Error {
  constructor() {
    super('Telegram operation unavailable')
    this.name = 'TelegramAdapterError'
  }
}

export class TelegramPreSendError extends Error {}
